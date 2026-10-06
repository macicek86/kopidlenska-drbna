// Redakce: import zpráv z Munipolisu. Nastavení, stav poslední kontroly a co Koza Drběna se zprávami udělala.
import { MODEL } from "../munipolis/ai.js";
import { DEFAULT_FEED_URL } from "../munipolis/feed.js";
import { DEFAULT_FRESH_DAYS, importRunning } from "../munipolis/store.js";
import { esc } from "../view.js";
import { entryDatesLine, importEntryItem, madeLinks, processButton, refLink, stamp, statusBadge, textBlock, VOICE_NOTE, workingNote } from "./imports.js";
import { adminShell } from "./shell.js";
import { callout, cancelLink, check, field, formFoot, icon, input, list, modal, pageHead, panel } from "./ui.js";

const BASE = "/redakce/munipolis";

function entryDetail(entry) {
  const made = madeLinks(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  const images = entry.images.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Obrázek ${index + 1}</a>`).join(" · ");
  const source = entry.link ? `<a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Původní zpráva</a>` : "";
  return `<div class="import-detail">
    <p class="item-badges">${statusBadge(entry)}${entryDatesLine(entry)}</p>
    ${entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : ""}
    ${made.length ? `<p>Vzniklo: ${made.join(" · ")}</p>` : ""}
    ${duplicate ? `<p>Stejná věc už je tady: ${duplicate}</p>` : ""}
    <div class="import-source">${textBlock(entry.text)}</div>
    ${source || images ? `<p class="item-sub">${[source, images].filter(Boolean).join(" · ")}</p>` : ""}
    <div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${processButton(BASE, entry)}</div>
  </div>`;
}

function settingsForm(settings) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Kontrolovat Munipolis automaticky", "Drbna se podívá každé čtyři hodiny a nové zprávy rovnou zpracuje s dnešním datem. Tlačítko Zkontrolovat teď udělá totéž hned.")}
    ${field("Automaticky jen zprávy z posledních", `<input class="${input}" type="number" name="freshDays" min="1" max="60" required value="${settings.freshDays ?? DEFAULT_FRESH_DAYS}">`, "Dní podle data na Munipolisu. Starší zprávy (třeba po prvním zapnutí nebo dlouhé pauze) automatika nechá být a počkají, až je pustíte ručně v detailu. Ty pak dostanou datum ze zdroje.")}
    ${check("autoPublish", "1", settings.autoPublish, "Rovnou zveřejňovat", "Bez zaškrtnutí čeká všechno na schválení: zprávy jako návrhy, akce a odstávky jako skryté.")}
    ${field("Adresa RSS", `<input class="${input}" type="url" name="feedUrl" required maxlength="300" value="${esc(settings.feedUrl || DEFAULT_FEED_URL)}">`)}
    ${VOICE_NOTE}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function statusPanel(data, settings, entries) {
  const checked = settings.checkedAt ? `Naposledy zkontrolováno ${stamp(settings.checkedAt)}.` : "Ještě se nekontrolovalo.";
  const mode = settings.enabled ? (settings.autoPublish ? "Zapnuto, rovnou zveřejňuje." : "Zapnuto, všechno čeká na schválení.") : "Vypnuto. Kontrolovat jde jen ručně.";
  const keyWarn = data.hasApiKey
    ? ""
    : callout("Chybí klíč pro Claude. Nastavíte ho příkazem <code>npx wrangler secret put ANTHROPIC_API_KEY</code>. Do té doby se zprávy jen stáhnou a počkají.", "warn");
  const tone = settings.status === "error" ? "bad" : "warn";
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("clock")}</span>
      <div>
        <p class="status-main">${esc(checked)}</p>
        <p class="status-sub">${esc(mode)} Model ${esc(MODEL)}.</p>
      </div>
      <form method="post" action="${BASE}/zkontrolovat"><button class="btn btn-line" type="submit" data-busy="Stahuji zprávy…">Zkontrolovat teď</button></form>
    </div>
    ${settings.note && settings.status !== "ok" ? callout(esc(settings.note), tone) : settings.note ? `<p class="status-sub">${esc(settings.note)}</p>` : ""}
    ${workingNote({ running: importRunning(settings), entries, enabled: settings.enabled, busy: "Drběna právě čte zprávy města. Jedna jí trvá asi půl minuty." })}
    ${keyWarn}
  </section>`;
}

export function adminMunipolis(ctx, data, message, query = {}) {
  const settings = data.importSettings ?? { feedUrl: DEFAULT_FEED_URL, enabled: false, autoPublish: false };
  const entries = data.importItems ?? [];
  const open = entries.find((entry) => entry.id === query.importId) ?? null;
  const dialogs = [
    modal({ id: "nastaveni", title: "Nastavení importu", size: "wide", close: BASE, open: Boolean(query.importSettings) && !open, body: settingsForm(settings) }),
  ];
  if (open) dialogs.push(modal({ id: "okno", title: open.title, size: "wide", close: BASE, open: true, body: entryDetail(open) }));
  const body = `${pageHead(
    "Munipolis",
    "Koza Drběna čte zprávy města z Munipolisu, třídí je do rubrik, akcí a odstávek, zavření a změny otevírací doby propíše rovnou a ostatní přepíše po svém. Když už stejná věc na drbně je, nechá ji být.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(data, settings, entries)}
    ${panel({ id: "zpravy-mesta", title: "Zprávy města", count: entries.length, filter: entries.length > 6 ? "Hledat ve zprávách…" : "", body: list(entries.map((entry) => importEntryItem(entry, BASE)), "Zatím žádná zpráva. Klikněte na Zkontrolovat teď.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "munipolis", message, body, { title: "Munipolis" });
}
