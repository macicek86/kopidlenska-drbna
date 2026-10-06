// Společné kousky redakce pro importy (Munipolis, fotbal): stav položky, výběr ke zpracování a pruh s tím, co Drběna dělá.
import { formatShort } from "../format.js";
import { MAX_ATTEMPTS, STATUS } from "../munipolis/store.js";
import { esc } from "../view.js";
import { pragueNow } from "../waste.js";
import { badge, callout, item, modalLink } from "./ui.js";

export const TONE = { nacteno: "warn", nove: "info", stare: "off", hotovo: "ok", preskoceno: "off", duplicita: "warn", chyba: "bad", smazano: "off", odlozeno: "info" };

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

// Vybraná redakcí a ještě nenapsaná.
export function picked(entry) {
  return Boolean(entry.manual) && queued(entry);
}

export function statusBadge(entry) {
  if (picked(entry)) return badge("Vybráno, Drběna se k tomu dostane", "info");
  if (entry.status === "odlozeno" && entry.writeOn) return badge(`Akce v kalendáři, pozvánku napíše ${formatShort(entry.writeOn)}`, "info");
  return badge(STATUS[entry.status] ?? entry.status, TONE[entry.status] ?? "");
}

// Zaškrtávátko u položky v seznamu. Patří k formuláři `pickForm` přes atribut form, ať se formuláře nevnořují.
export function pickBox(entry, formId) {
  if (entry.status === "hotovo" || picked(entry)) return "";
  return `<label class="pick"><input type="checkbox" name="ids" value="${entry.id}" form="${formId}"> <span>Vybrat</span></label>`;
}

export function pickForm(base, formId) {
  return `<form id="${formId}" method="post" action="${base}/vybrat"><button class="btn btn-sm btn-primary" type="submit" data-busy="Posílám Drběně…">Zpracovat vybrané</button></form>`;
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

export const SOURCE_DATE_NOTE = "Ručně vybrané dostanou datum ze zdroje, ať se starší věci neobjeví na drbně jako nové.";

// Co importu zbývá. Dokud Drběna píše vybrané, stránka se po chvíli sama obnoví (public/admin.js, data-refresh)
// a každé otevření stránky pošle další dávku (src/index.js).
export function workingNote({ running, entries, enabled, busy }) {
  const pickedCount = entries.filter(picked).length;
  if (running || pickedCount) {
    const left = pickedCount ? ` Vybraných zbývá ${pickedCount}.` : "";
    return `<div class="callout callout-info" data-refresh="8">${esc(busy)}${left} Stránka se sama obnoví.</div>`;
  }
  const notes = [];
  const loaded = entries.filter((entry) => entry.status === "nacteno").length;
  if (loaded) notes.push(`Načteno a čeká na výběr: ${loaded}. Zaškrtněte, co má Drběna zpracovat. ${SOURCE_DATE_NOTE}`);
  const waiting = entries.filter(queued).length;
  if (waiting) {
    notes.push(
      enabled
        ? `Na automatické zpracování čeká ${waiting}. Dopíše je cron (běží každé čtyři hodiny).`
        : `Na zpracování čeká ${waiting}. Kontrola je vypnutá, zaškrtněte je, pokud je chcete zpracovat.`,
    );
  }
  return notes.map((note) => callout(esc(note), "info")).join("");
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
export function entryDates(entry, source = stamp(entry.publishedAt)) {
  const fetched = stamp(entry.fetchedAt);
  return [fetched && `staženo ${fetched}`, source && `ve zdroji ${source}`].filter(Boolean);
}

export function entryDatesLine(entry, source) {
  const dates = entryDates(entry, source);
  return dates.length ? `<span class="item-sub">${esc(dates.join(" · "))}</span>` : "";
}

// Řádek převzaté zprávy v seznamu (Munipolis, Deník).
export function importEntryItem(entry, base, formId) {
  const made = madeLinks(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  return item({
    title: entry.title,
    meta: [...entryDates(entry).map(esc), entry.reason ? esc(entry.reason) : ""].filter(Boolean).join(" · "),
    badges: `${statusBadge(entry)}${made.length ? `<span class="item-sub">${made.join(" · ")}</span>` : ""}${duplicate ? `<span class="item-sub">Stejné jako ${duplicate}</span>` : ""}`,
    actions: `${pickBox(entry, formId)}${modalLink(`${base}?zprava=${entry.id}`, "Detail")}`,
    search: `${entry.title} ${entry.reason}`,
  });
}
