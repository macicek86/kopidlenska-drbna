// Společné kousky redakce pro importy (Munipolis, fotbal): stav položky, výběr ke zpracování a pruh s tím, co Drběna dělá.
import { formatShort } from "../format.js";
import { MAX_ATTEMPTS, STATUS } from "../munipolis/store.js";
import { esc } from "../view.js";
import { pragueNow } from "../waste.js";
import { badge, callout, item, modalLink } from "./ui.js";

export const TONE = { nacteno: "warn", nove: "info", stare: "off", hotovo: "ok", preskoceno: "off", duplicita: "warn", chyba: "bad", smazano: "off", odlozeno: "info", napsano: "warn", zruseno: "off" };

// Kam vede značka, kterou Claude použil v duplicate_of nebo kterou zpráva vytvořila.
export function refLink(ref) {
  const [kind, id] = String(ref ?? "").split(":");
  const links = {
    zprava: ["/redakce/zpravy?id=", "Zpráva"],
    navrh: ["/redakce/zpravy?navrh=", "Návrh zprávy"],
    akce: ["/redakce/akce?id=", "Akce"],
    odstavka: ["/redakce/odstavky?oznameni=", "Odstávka"],
    munipolis: ["/redakce/munipolis?zprava=", "Zpráva z Munipolisu"],
    denik: ["/redakce/denik?zprava=", "Zpráva z Deníku"],
    skola: ["/redakce/skola?zprava=", "Článek školy"],
    zahradka: ["/redakce/zahradka?zprava=", "Článek zahradnické školy"],
    webmesta: ["/redakce/webmesta?zprava=", "Článek z webu města"],
    vlozene: ["/redakce/vlozene?zprava=", "Vložený příspěvek"],
    misto: ["/redakce/oteviraci-doba?id=", "Místo"],
    lekar: ["/redakce/lekari?id=", "Ordinace"],
  };
  // Změny otevírací doby nemají vlastní okno, vedou na stránku sekce.
  const pages = { doba: ["/redakce/oteviraci-doba", "Otevírací doba"], ordinace: ["/redakce/lekari", "Ordinační hodiny"] };
  if (!/^\d+$/.test(id ?? "")) return "";
  if (pages[kind]) return `<a href="${pages[kind][0]}">${esc(pages[kind][1])} #${id}</a>`;
  if (!links[kind]) return "";
  return `<a href="${links[kind][0]}${id}">${esc(links[kind][1])} #${id}</a>`;
}

export function stamp(iso) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const clock = pragueNow(new Date(parsed));
  return `${formatShort(clock.date)} v ${clock.time}`;
}

export function textBlock(text) {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return paragraphs || `<p class="muted">Zpráva nemá text. Údaje jsou nejspíš jen na obrázku.</p>`;
}

export function queued(entry) {
  return entry.status === "nove" || (entry.status === "chyba" && entry.attempts < MAX_ATTEMPTS);
}

// Puštěná redakcí v detailu a ještě nenapsaná.
export function picked(entry) {
  return Boolean(entry.manual) && queued(entry);
}

export function statusBadge(entry) {
  if (picked(entry)) return badge("Puštěno, Drběna se k tomu dostane", "info");
  if (entry.status === "odlozeno" && entry.writeOn) return badge(`Akce v kalendáři, pozvánku napíše ${formatShort(entry.writeOn)}`, "info");
  return badge(STATUS[entry.status] ?? entry.status, TONE[entry.status] ?? "");
}

export function processButton(base, entry) {
  if (entry.status === "hotovo" || picked(entry)) return "";
  const label =
    entry.status === "odlozeno"
      ? "Napsat pozvánku hned"
      : entry.status === "smazano"
        ? "Zpracovat znovu"
        : entry.status === "preskoceno" || entry.status === "duplicita" ? "Přesto zpracovat" : "Zpracovat teď";
  return `<form method="post" action="${base}/zpracovat"><input type="hidden" name="id" value="${entry.id}"><button class="btn btn-primary" type="submit" data-busy="Posílám Drběně…">${label}</button></form>`;
}

// Co importu zbývá. Když něco čeká, otevřená stránka pošle `base`/pokracovat, počká na dávku a obnoví se
// (public/admin.js, data-continue, src/admin-continue.js). Když jen běží cron, stránka se po chvíli obnoví (data-refresh).
// Bez JS frontu dopíše cron.
export function workingNote({ base, running, entries, enabled, busy }) {
  const waiting = entries.filter(queued).length;
  if (waiting) {
    return `<div class="callout callout-info" data-continue="${esc(base)}/pokracovat">${esc(busy)} Čeká ještě ${waiting}. Nechte stránku otevřenou, sama se obnoví.</div>`;
  }
  if (running) return `<div class="callout callout-info" data-refresh="8">${esc(busy)} Stránka se sama obnoví.</div>`;
  return enabled ? "" : callout("Automatika je vypnutá. Nové věci stáhne a zpracuje jen tlačítko Zkontrolovat teď.", "info");
}

// V nastavení importů místo pole s povahou: ta je společná na stránce Koza Drběna.
export const VOICE_NOTE = `<p class="hint">Jak Drběna píše, se nastavuje na stránce <a href="/redakce/drbena">Koza Drběna</a>.</p>`;

// Co z položky vzniklo (návrh, zpráva, akce, odstávka) jako odkazy do redakce.
export function madeLinks(entry) {
  return [
    entry.proposalId && refLink(`navrh:${entry.proposalId}`),
    entry.articleId && refLink(`zprava:${entry.articleId}`),
    entry.eventId && refLink(`akce:${entry.eventId}`),
    entry.noticeId && refLink(`odstavka:${entry.noticeId}`),
    ...(entry.hoursIds ?? []).map(refLink),
  ].filter(Boolean);
}

// Kdy drbna položku stáhla a kdy vyšla ve zdroji (`source` je už naformátované datum zdroje).
// Vložený příspěvek (`fetchedLabel` „vloženo“) se nestahuje.
export function entryDates(entry, source = stamp(entry.publishedAt), fetchedLabel = "staženo") {
  const fetched = stamp(entry.fetchedAt);
  return [fetched && `${fetchedLabel} ${fetched}`, source && `ve zdroji ${source}`].filter(Boolean);
}

export function entryDatesLine(entry, source, fetchedLabel) {
  const dates = entryDates(entry, source, fetchedLabel);
  return dates.length ? `<span class="item-sub">${esc(dates.join(" · "))}</span>` : "";
}

// Řádek převzaté zprávy v seznamu (Munipolis, Deník).
export function importEntryItem(entry, base, fetchedLabel) {
  const made = madeLinks(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  return item({
    title: entry.title,
    meta: [...entryDates(entry, undefined, fetchedLabel).map(esc), entry.reason ? esc(entry.reason) : ""].filter(Boolean).join(" · "),
    badges: `${statusBadge(entry)}${made.length ? `<span class="item-sub">${made.join(" · ")}</span>` : ""}${duplicate ? `<span class="item-sub">Stejné jako ${duplicate}</span>` : ""}`,
    actions: modalLink(`${base}?zprava=${entry.id}`, "Detail"),
    search: `${entry.title} ${entry.reason}`,
  });
}
