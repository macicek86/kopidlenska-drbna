// Redakce: články z webu ZŠ a MŠ Kopidlno. Nastavení, stav poslední kontroly a co s nimi Koza Drběna udělala.
import { MODEL } from "../claude.js";
import { DEFAULT_FEEDS } from "../skola/feed.js";
import { DEFAULT_FRESH_DAYS, skolaRunning } from "../skola/store.js";
import { esc } from "../view.js";
import { importEntryItem, madeLinks, pickBox, pickForm, processButton, refLink, stamp, statusBadge, textBlock, VOICE_NOTE, workingNote } from "./imports.js";
import { adminShell } from "./shell.js";
import { callout, cancelLink, check, field, formFoot, icon, input, list, modal, pageHead, panel } from "./ui.js";

const BASE = "/redakce/skola";
const PICK = "vyber-skola";

function entryDetail(entry) {
  const made = madeLinks(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  const source = entry.link ? `<a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Článek na webu školy</a>` : "";
  const facts = [entry.section, entry.term && `termín ${entry.term}`].filter(Boolean).join(" · ");
  return `<div class="import-detail">
    <p class="item-badges">${statusBadge(entry)}<span class="item-sub">${esc(stamp(entry.publishedAt))}</span>${facts ? `<span class="item-sub">${esc(facts)}</span>` : ""}</p>
    ${entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : ""}
    ${made.length ? `<p>Vzniklo: ${made.join(" · ")}</p>` : ""}
    ${duplicate ? `<p>Stejná věc už je tady: ${duplicate}</p>` : ""}
    <div class="import-source">${textBlock(entry.text)}</div>
    ${source ? `<p class="item-sub">${source}</p>` : ""}
    <div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${processButton(BASE, entry)}</div>
  </div>`;
}

function settingsForm(settings) {
  const urls = (settings.feedUrls?.length ? settings.feedUrls : DEFAULT_FEEDS).join("\n");
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Kontrolovat web školy automaticky", "Drbna se podívá každé čtyři hodiny a nové články rovnou zpracuje s dnešním datem. Tlačítko Zkontrolovat teď články jen načte a zpracuje se, co vyberete.")}
    ${field("Automaticky jen články z posledních", `<input class="${input}" type="number" name="freshDays" min="1" max="60" required value="${settings.freshDays ?? DEFAULT_FRESH_DAYS}">`, "Dní podle data na webu školy. Starší články automatika nechá být a počkají, až je vyberete. Ručně vybrané dostanou datum ze zdroje.")}
    ${check("autoPublish", "1", settings.autoPublish, "Rovnou zveřejňovat", "Bez zaškrtnutí čeká všechno na schválení: zprávy jako návrhy, akce jako skryté.")}
    ${check("ownPhotos", "1", settings.ownPhotos, "Brát fotky ze školního webu", "Drběna vezme fotku od článku, když je pěkná (plakát ne), a pod ni napíše, že je od školy. Bez zaškrtnutí dává vždy ilustrační fotku z knihovny obrázků.")}
    ${field("Adresy RSS", `<textarea class="${input}" name="feedUrls" rows="3" maxlength="2000">${esc(urls)}</textarea>`, "Jedna na řádek. Článek, který škola dá do aktualit ZŠ i MŠ, se vezme jen jednou. Prázdné pole vrátí aktuality ZŠ a MŠ.")}
    ${VOICE_NOTE}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function statusPanel(data, settings, entries) {
  const checked = settings.checkedAt ? `Naposledy zkontrolováno ${stamp(settings.checkedAt)}.` : "Ještě se nekontrolovalo.";
  const mode = settings.enabled ? (settings.autoPublish ? "Zapnuto, rovnou zveřejňuje." : "Zapnuto, všechno čeká na schválení.") : "Vypnuto. Kontrolovat jde jen ručně.";
  const photos = settings.ownPhotos ? "Fotky bere ze školy." : "Fotky jen z knihovny.";
  const keyWarn = data.hasApiKey
    ? ""
    : callout("Chybí klíč pro Claude. Nastavíte ho příkazem <code>npx wrangler secret put ANTHROPIC_API_KEY</code>. Do té doby se články jen stáhnou a počkají.", "warn");
  const tone = settings.status === "error" ? "bad" : "warn";
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("clock")}</span>
      <div>
        <p class="status-main">${esc(checked)}</p>
        <p class="status-sub">${esc(mode)} ${esc(photos)} Model ${esc(MODEL)}.</p>
      </div>
      <form method="post" action="${BASE}/zkontrolovat"><button class="btn btn-line" type="submit" data-busy="Stahuji články…">Zkontrolovat teď</button></form>
    </div>
    ${settings.note && settings.status !== "ok" ? callout(esc(settings.note), tone) : settings.note ? `<p class="status-sub">${esc(settings.note)}</p>` : ""}
    ${workingNote({ running: skolaRunning(settings), entries, enabled: settings.enabled, busy: "Drběna právě čte vybrané články. Jeden jí trvá asi půl minuty." })}
    ${keyWarn}
  </section>`;
}

export function adminSkola(ctx, data, message, query = {}) {
  const settings = data.skolaSettings ?? { feedUrls: DEFAULT_FEEDS, enabled: false, autoPublish: false, ownPhotos: false };
  const entries = data.skolaItems ?? [];
  const open = entries.find((entry) => entry.id === query.importId) ?? null;
  const dialogs = [
    modal({ id: "nastaveni", title: "Nastavení školy", size: "wide", close: BASE, open: Boolean(query.importSettings) && !open, body: settingsForm(settings) }),
  ];
  if (open) dialogs.push(modal({ id: "okno", title: open.title, size: "wide", close: BASE, open: true, body: entryDetail(open) }));
  const body = `${pageHead(
    "Škola",
    "Koza Drběna čte aktuality na webu ZŠ a MŠ Kopidlno. Úspěchy žáků, akce a novinky pro rodiče napíše po svém, s odkazem na článek školy. Věci jen pro žáky a to, co už na drbně je, nechá být.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(data, settings, entries)}
    ${panel({ id: "clanky-skoly", title: "Články školy", count: entries.length, tools: entries.some((entry) => pickBox(entry, PICK)) ? pickForm(BASE, PICK) : "", filter: entries.length > 6 ? "Hledat v článcích…" : "", body: list(entries.map((entry) => importEntryItem(entry, BASE, PICK)), "Zatím žádný článek. Klikněte na Zkontrolovat teď.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "skola", message, body, { title: "Škola" });
}
