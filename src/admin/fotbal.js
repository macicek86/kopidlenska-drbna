// Redakce: fotbal z webu FK Kopidlno. Nastavení, stav poslední kontroly a co Koza Drběna s aktualitami udělala.
import { MODEL } from "../claude.js";
import { KIND_LABEL } from "../fotbal/ai.js";
import { DEFAULT_CLUB_URL } from "../fotbal/club.js";
import { DEFAULT_FRESH_DAYS, footballRunning, INTERVALS } from "../fotbal/store.js";
import { esc } from "../view.js";
import { rubricOptions } from "./articles.js";
import { pickBox, pickForm, processButton, refLink, stamp, statusBadge, textBlock, VOICE_NOTE, workingNote } from "./imports.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, field, formFoot, icon, input, item, list, modal, modalLink, pageHead, panel } from "./ui.js";

const BASE = "/redakce/fotbal";
const PICK = "vyber-aktualit";

function day(date) {
  const match = String(date ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[3])}. ${Number(match[2])}. ${match[1]}` : "";
}

function results(entry) {
  return [entry.proposalId && refLink(`navrh:${entry.proposalId}`), entry.articleId && refLink(`zprava:${entry.articleId}`)].filter(Boolean);
}

function statusBadges(entry) {
  const made = results(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  return `${statusBadge(entry)}${badge(KIND_LABEL[entry.kind] ?? entry.kind)}${
    made.length ? `<span class="item-sub">${made.join(" · ")}</span>` : ""
  }${duplicate ? `<span class="item-sub">Stejné jako ${duplicate}</span>` : ""}`;
}

function entryItem(entry) {
  return item({
    title: entry.title,
    meta: [day(entry.publishedOn), entry.reason ? esc(entry.reason) : ""].filter(Boolean).join(" · "),
    badges: statusBadges(entry),
    actions: `${pickBox(entry, PICK)}${modalLink(`${BASE}?zprava=${entry.id}`, "Detail")}`,
    search: `${entry.title} ${entry.reason}`,
  });
}

function entryDetail(entry) {
  const source = entry.link ? `<a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Aktualita na webu klubu</a>` : "";
  return `<div class="import-detail">
    <p class="item-badges">${statusBadges(entry)}<span class="item-sub">${esc(day(entry.publishedOn))}</span></p>
    ${entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : ""}
    <div class="import-source">${textBlock(entry.text)}</div>
    ${entry.extra ? `<p class="item-sub">Doplněno z rozpisu a tabulky:</p><div class="import-source">${textBlock(entry.extra)}</div>` : ""}
    ${source ? `<p class="item-sub">${source}</p>` : ""}
    <div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${processButton(BASE, entry)}</div>
  </div>`;
}

function intervalOptions(current) {
  return INTERVALS.map(([hours, label]) => `<option value="${hours}"${hours === current ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function settingsForm(settings, rubrics) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Kontrolovat web klubu automaticky", "Nové aktuality rovnou zpracuje s dnešním datem. Tlačítko Zkontrolovat teď aktuality jen načte a zpracuje se, co vyberete.")}
    ${field("Jak často", `<select class="${input}" name="intervalHours">${intervalOptions(settings.intervalHours)}</select>`)}
    ${field("Automaticky jen aktuality z posledních", `<input class="${input}" type="number" name="freshDays" min="1" max="60" required value="${settings.freshDays ?? DEFAULT_FRESH_DAYS}">`, "Dní podle data na webu klubu, u zápasu podle dne, kdy se hrál. Starší (třeba po prvním zapnutí nebo dlouhé pauze) automatika nechá být a počkají, až je vyberete. Ručně vybrané dostanou datum ze zdroje.")}
    ${check("autoPublish", "1", settings.autoPublish, "Rovnou zveřejňovat", "Bez zaškrtnutí čeká každý článek jako návrh na schválení.")}
    ${field("Rubrika", `<select class="${input}" name="rubric_id">${rubricOptions(rubrics, { rubricId: settings.rubricId })}</select>`)}
    ${check("previews", "1", settings.previews, "Psát pozvánky na zápasy", "Když klub ohlásí zápas, který se teprve hraje.")}
    ${check("clubNews", "1", settings.clubNews, "Psát i o ostatních zprávách klubu", "Dotace, brigády, kroniky… Drběna sama vynechá, co čtenáře nezajímá.")}
    ${check("useCrest", "1", settings.useCrest, "Bez fotky dát ke článku znak klubu", "Když aktualita nemá vlastní fotku.")}
    ${field("Web klubu", `<input class="${input}" type="url" name="clubUrl" required maxlength="300" value="${esc(settings.clubUrl || DEFAULT_CLUB_URL)}">`)}
    ${VOICE_NOTE}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function statusPanel(data, settings, entries) {
  const checked = settings.checkedAt ? `Naposledy zkontrolováno ${stamp(settings.checkedAt)}.` : "Ještě se nekontrolovalo.";
  const often = (INTERVALS.find(([hours]) => hours === settings.intervalHours)?.[1] ?? "").toLocaleLowerCase("cs");
  const mode = settings.enabled
    ? `Zapnuto, ${often}, ${settings.autoPublish ? "rovnou zveřejňuje." : "články čekají na schválení."}`
    : "Vypnuto. Kontrolovat jde jen ručně.";
  const keyWarn = data.hasApiKey
    ? ""
    : callout("Chybí klíč pro Claude. Nastavíte ho příkazem <code>npx wrangler secret put ANTHROPIC_API_KEY</code>. Do té doby se aktuality jen stáhnou a počkají.", "warn");
  const tone = settings.status === "error" ? "bad" : "warn";
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("ball")}</span>
      <div>
        <p class="status-main">${esc(checked)}</p>
        <p class="status-sub">${esc(mode)} Model ${esc(MODEL)}.</p>
      </div>
      <form method="post" action="${BASE}/zkontrolovat"><button class="btn btn-line" type="submit" data-busy="Stahuji aktuality…">Zkontrolovat teď</button></form>
    </div>
    ${settings.note && settings.status !== "ok" ? callout(esc(settings.note), tone) : settings.note ? `<p class="status-sub">${esc(settings.note)}</p>` : ""}
    ${workingNote({ running: footballRunning(settings), entries, enabled: settings.enabled, busy: "Drběna právě píše vybrané aktuality. Jeden článek jí trvá asi půl minuty." })}
    ${keyWarn}
  </section>`;
}

export function adminFootball(ctx, data, message, query = {}) {
  const settings = data.footballSettings ?? { clubUrl: DEFAULT_CLUB_URL, enabled: false, autoPublish: false, previews: true, clubNews: false, useCrest: true, intervalHours: 24, rubricId: null };
  const entries = data.footballItems ?? [];
  const open = entries.find((entry) => entry.id === query.importId) ?? null;
  const dialogs = [
    modal({ id: "nastaveni", title: "Nastavení fotbalu", size: "wide", close: BASE, open: Boolean(query.importSettings) && !open, body: settingsForm(settings, data.rubrics) }),
  ];
  if (open) dialogs.push(modal({ id: "okno", title: open.title, size: "wide", close: BASE, open: true, body: entryDetail(open) }));
  const body = `${pageHead(
    "Fotbal",
    "Koza Drběna čte aktuality na webu FK Kopidlno. Po zápase napíše, jak to dopadlo, před zápasem pozve sousedy na hřiště. Výsledky, góly a tabulku si doplní z rozpisu klubu. Po ručním načtení zpracuje jen to, co zaškrtnete.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(data, settings, entries)}
    ${panel({ id: "aktuality-klubu", title: "Aktuality klubu", count: entries.length, tools: entries.some((entry) => pickBox(entry, PICK)) ? pickForm(BASE, PICK) : "", filter: entries.length > 6 ? "Hledat v aktualitách…" : "", body: list(entries.map(entryItem), "Zatím žádná aktualita. Klikněte na Zkontrolovat teď.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "fotbal", message, body, { title: "Fotbal" });
}
