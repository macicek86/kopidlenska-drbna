// Redakce: fotbal z webu FK Kopidlno. Nastavení, stav poslední kontroly a co Koza Drběna s aktualitami udělala.
import { MODEL } from "../claude.js";
import { DEFAULT_FOOTBALL_VOICE, KIND_LABEL } from "../fotbal/ai.js";
import { DEFAULT_CLUB_URL } from "../fotbal/club.js";
import { footballRunning, INTERVALS } from "../fotbal/store.js";
import { STATUS } from "../munipolis/store.js";
import { esc } from "../view.js";
import { rubricOptions } from "./articles.js";
import { refLink, stamp, textBlock, TONE, waitingCount, workingNote } from "./munipolis.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, field, formFoot, icon, input, item, list, modal, modalLink, pageHead, panel } from "./ui.js";

const BASE = "/redakce/fotbal";

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
  return `${badge(STATUS[entry.status] ?? entry.status, TONE[entry.status] ?? "")}${badge(KIND_LABEL[entry.kind] ?? entry.kind)}${
    made.length ? `<span class="item-sub">${made.join(" · ")}</span>` : ""
  }${duplicate ? `<span class="item-sub">Stejné jako ${duplicate}</span>` : ""}`;
}

function entryItem(entry) {
  return item({
    title: entry.title,
    meta: [day(entry.publishedOn), entry.reason ? esc(entry.reason) : ""].filter(Boolean).join(" · "),
    badges: statusBadges(entry),
    actions: modalLink(`${BASE}?zprava=${entry.id}`, "Detail"),
    search: `${entry.title} ${entry.reason}`,
  });
}

function processButton(entry) {
  if (entry.status === "hotovo") return "";
  const label = entry.status === "preskoceno" || entry.status === "duplicita" ? "Přesto zpracovat" : "Zpracovat teď";
  return `<form method="post" action="${BASE}/zpracovat"><input type="hidden" name="id" value="${entry.id}"><button class="btn btn-primary" type="submit" data-busy="Drběna čte…">${label}</button></form>`;
}

function entryDetail(entry) {
  const source = entry.link ? `<a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Aktualita na webu klubu</a>` : "";
  return `<div class="import-detail">
    <p class="item-badges">${statusBadges(entry)}<span class="item-sub">${esc(day(entry.publishedOn))}</span></p>
    ${entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : ""}
    <div class="import-source">${textBlock(entry.text)}</div>
    ${entry.extra ? `<p class="item-sub">Doplněno z rozpisu a tabulky:</p><div class="import-source">${textBlock(entry.extra)}</div>` : ""}
    ${source ? `<p class="item-sub">${source}</p>` : ""}
    <div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${processButton(entry)}</div>
  </div>`;
}

function intervalOptions(current) {
  return INTERVALS.map(([hours, label]) => `<option value="${hours}"${hours === current ? " selected" : ""}>${esc(label)}</option>`).join("");
}

function settingsForm(settings, rubrics) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Kontrolovat web klubu", "Při prvním zapnutí vezme jen aktuality z posledního týdne.")}
    ${field("Jak často", `<select class="${input}" name="intervalHours">${intervalOptions(settings.intervalHours)}</select>`)}
    ${check("autoPublish", "1", settings.autoPublish, "Rovnou zveřejňovat", "Bez zaškrtnutí čeká každý článek jako návrh na schválení.")}
    ${field("Rubrika", `<select class="${input}" name="rubric_id">${rubricOptions(rubrics, { rubricId: settings.rubricId })}</select>`)}
    ${check("previews", "1", settings.previews, "Psát pozvánky na zápasy", "Když klub ohlásí zápas, který se teprve hraje.")}
    ${check("clubNews", "1", settings.clubNews, "Psát i o ostatních zprávách klubu", "Dotace, brigády, kroniky… Drběna sama vynechá, co čtenáře nezajímá.")}
    ${check("useCrest", "1", settings.useCrest, "Bez fotky dát ke článku znak klubu", "Když aktualita nemá vlastní fotku.")}
    ${field("Web klubu", `<input class="${input}" type="url" name="clubUrl" required maxlength="300" value="${esc(settings.clubUrl || DEFAULT_CLUB_URL)}">`)}
    ${field("Jak Drběna píše o fotbale", `<textarea class="${input}" name="voice" rows="8" maxlength="3000">${esc(settings.voice || DEFAULT_FOOTBALL_VOICE)}</textarea>`, "Pokyny pro styl textů. Pravidla o faktech a duplicitách platí vždy.")}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function statusPanel(data, settings, entries, here) {
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
    ${workingNote({ running: footballRunning(settings), waiting: waitingCount(entries), enabled: settings.enabled, here, busy: "Drběna právě píše. Jeden článek jí trvá asi půl minuty, stránka se sama obnoví." })}
    ${keyWarn}
  </section>`;
}

export function adminFootball(ctx, data, message, query = {}) {
  const settings = data.footballSettings ?? { clubUrl: DEFAULT_CLUB_URL, voice: "", enabled: false, autoPublish: false, previews: true, clubNews: false, useCrest: true, intervalHours: 24, rubricId: null };
  const entries = data.footballItems ?? [];
  const open = entries.find((entry) => entry.id === query.importId) ?? null;
  const dialogs = [
    modal({ id: "nastaveni", title: "Nastavení fotbalu", size: "wide", close: BASE, open: Boolean(query.importSettings) && !open, body: settingsForm(settings, data.rubrics) }),
  ];
  if (open) dialogs.push(modal({ id: "okno", title: open.title, size: "wide", close: BASE, open: true, body: entryDetail(open) }));
  const body = `${pageHead(
    "Fotbal",
    "Koza Drběna čte aktuality na webu FK Kopidlno. Po zápase napíše, jak to dopadlo, před zápasem pozve sousedy na hřiště. Výsledky, góly a tabulku si doplní z rozpisu klubu.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(data, settings, entries, open ? `${BASE}?zprava=${open.id}` : BASE)}
    ${panel({ id: "aktuality-klubu", title: "Aktuality klubu", count: entries.length, filter: entries.length > 6 ? "Hledat v aktualitách…" : "", body: list(entries.map(entryItem), "Zatím žádná aktualita. Klikněte na Zkontrolovat teď.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "fotbal", message, body, { title: "Fotbal" });
}
