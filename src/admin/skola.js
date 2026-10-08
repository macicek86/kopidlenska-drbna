// Redakce: články z webů škol (ZŠ a MŠ, zahradnická) a města. Nastavení, stav poslední kontroly a co s nimi Koza Drběna udělala.
// Vložené příspěvky (`pasted`) mají místo kontroly webu a nastavení okno Vložit příspěvek a okno s konceptem (`paste.js`).
import { MODEL } from "../claude.js";
import { DEFAULT_AHEAD_DAYS } from "../skola/defer.js";
import { SCHOOLS } from "../skola/sources.js";
import { skolaRunning } from "../skola/store.js";
import { esc } from "../view.js";
import { entryDatesLine, importEntryItem, madeLinks, processButton, refLink, stamp, statusBadge, textBlock, VOICE_NOTE, workingNote } from "./imports.js";
import { pastedDetail, pastedStatusPanel, pasteForm } from "./paste.js";
import { adminShell } from "./shell.js";
import { callout, cancelLink, check, field, formFoot, icon, input, list, modal, openButton, pageHead, panel } from "./ui.js";

const baseOf = (source) => `/redakce/${source.tag}`;

function entryDetail(source, entry) {
  const BASE = baseOf(source);
  const made = madeLinks(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  const original = entry.link ? `<a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Článek na ${esc(source.siteOf)}</a>` : "";
  const facts = [entry.section, entry.term && `termín ${entry.term}`].filter(Boolean).join(" · ");
  return `<div class="import-detail">
    <p class="item-badges">${statusBadge(entry)}${entryDatesLine(entry)}${facts ? `<span class="item-sub">${esc(facts)}</span>` : ""}</p>
    ${entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : ""}
    ${made.length ? `<p>Vzniklo: ${made.join(" · ")}</p>` : ""}
    ${duplicate ? `<p>Stejná věc už je tady: ${duplicate}</p>` : ""}
    <div class="import-source">${textBlock(entry.text)}</div>
    ${original ? `<p class="item-sub">${original}</p>` : ""}
    <div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${processButton(BASE, entry)}</div>
  </div>`;
}

function feedField(source, settings) {
  if (!source.feedField) return "";
  const urls = (settings.feedUrls?.length ? settings.feedUrls : source.defaultFeeds).join("\n");
  return field(source.feedLabel ?? "Adresy RSS", `<textarea class="${input}" name="feedUrls" rows="3" maxlength="2000">${esc(urls)}</textarea>`, source.feedHint);
}

function aheadField(source, settings) {
  if (!source.defer) return "";
  return field(
    "Pozvánku na akci psát dní předem",
    `<input class="${input}" type="number" name="aheadDays" min="1" max="60" required value="${settings.aheadDays ?? DEFAULT_AHEAD_DAYS}">`,
    "Akce, která je dál, jde do kalendáře hned (zveřejněná, i když se jinak schvaluje) a pozvánku Drběna napíše až tolik dní před ní. Pozná tak i pozvánku, kterou město mezitím poslalo přes Munipolis. Změna posune i pozvánky, které už čekají. Akce, které už proběhly, automatika přeskočí.",
  );
}

function settingsForm(source, settings) {
  const BASE = baseOf(source);
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, `Kontrolovat ${source.site} automaticky`, "Drbna se podívá každé čtyři hodiny a nové články rovnou zpracuje s dnešním datem. Tlačítko Zkontrolovat teď udělá totéž hned.")}
    ${field("Automaticky jen články z posledních", `<input class="${input}" type="number" name="freshDays" min="1" max="60" required value="${settings.freshDays ?? source.freshDays}">`, `Dní podle data na ${source.siteOf}. Starší články automatika nechá být a počkají, až je pustíte ručně v detailu. Ty pak dostanou datum ze zdroje.`)}
    ${aheadField(source, settings)}
    ${source.draftsOnly ? "" : check("autoPublish", "1", settings.autoPublish, "Rovnou zveřejňovat", "Bez zaškrtnutí čeká všechno na schválení: zprávy jako návrhy, akce jako skryté.")}
    ${check("ownPhotos", "1", settings.ownPhotos, `Brát fotky z ${source.siteOf}`, `Drběna vezme fotku od článku, když je pěkná (plakát ne), a pod ni napíše, odkud je. Bez zaškrtnutí dává vždy ilustrační fotku z knihovny obrázků.`)}
    ${feedField(source, settings)}
    ${VOICE_NOTE}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function statusPanel(source, data, settings, entries) {
  const BASE = baseOf(source);
  const checked = settings.checkedAt ? `Naposledy zkontrolováno ${stamp(settings.checkedAt)}.` : "Ještě se nekontrolovalo.";
  const mode = settings.enabled ? (settings.autoPublish ? "Zapnuto, rovnou zveřejňuje." : "Zapnuto, všechno čeká na schválení.") : "Vypnuto. Kontrolovat jde jen ručně.";
  const photos = settings.ownPhotos ? `Fotky bere z ${source.siteOf}.` : "Fotky jen z knihovny.";
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
    ${workingNote({ base: BASE, running: skolaRunning(settings), entries, enabled: settings.enabled, busy: "Drběna právě čte články. Jeden jí trvá asi půl minuty." })}
    ${keyWarn}
  </section>`;
}

export function adminSkola(ctx, data, message, query = {}, source = SCHOOLS.skola) {
  const BASE = baseOf(source);
  const school = data.schools?.[source.tag] ?? {};
  const settings = school.settings ?? { feedUrls: source.defaultFeeds, enabled: false, autoPublish: false, ownPhotos: false };
  const entries = school.items ?? [];
  const open = entries.find((entry) => entry.id === query.importId) ?? null;
  const dialogs = source.pasted
    ? [modal({ id: "vlozit", title: "Vložit příspěvek", size: "wide", close: BASE, open: Boolean(query.paste) && !open, body: pasteForm(source, entries) })]
    : [modal({ id: "nastaveni", title: "Nastavení", size: "wide", close: BASE, open: Boolean(query.importSettings) && !open, body: settingsForm(source, settings) })];
  if (open) {
    const detail = source.pasted ? pastedDetail(source, open, data) : entryDetail(source, open);
    dialogs.push(modal({ id: "okno", title: open.title, size: "wide", close: BASE, open: true, body: detail }));
  }
  const actions = source.pasted
    ? openButton("vlozit", `${BASE}?vlozit=1`, "Vložit příspěvek")
    : `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`;
  const listTitle = source.pasted ? "Příspěvky" : `Články z ${source.siteOf}`;
  const empty = source.pasted ? "Zatím nic. Klikněte na Vložit příspěvek." : "Zatím žádný článek. Klikněte na Zkontrolovat teď.";
  const body = `${pageHead(
    source.page,
    source.intro,
    actions,
  )}
    ${(source.pasted ? pastedStatusPanel : statusPanel)(source, data, settings, entries)}
    ${panel({ id: `clanky-${source.tag}`, title: listTitle, count: entries.length, filter: entries.length > 6 ? "Hledat…" : "", body: list(entries.map((entry) => importEntryItem(entry, BASE, source.pasted ? "vloženo" : undefined)), empty) })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, source.tag, message, body, { title: source.page });
}
