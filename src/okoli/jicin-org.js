// Kalendář akcí Městského informačního centra Jičín (jicin.org, Drupal). Feed nemá, čte se stránka seznamu:
// u akce je `<time datetime>` se začátkem (vícedenní mají text „1. - 7. 10. 2026“), název, odkaz a krátký popis.
// Místo je jen na stránce akce, ta se stáhne, když je akce nová nebo se jí změnil termín (`stamp`).
// Kalendář obsahuje i program KZMJ; zdvojené akce slučuje víkendový článek (src/okoli/weekend.js).
import { decodeEntities, htmlToText, USER_AGENT } from "../munipolis/feed.js";

const BASE = "https://www.jicin.org";
const LIST = `${BASE}/kalendar-akci?date=&typ=All&page=`;
// Stránek seznamu nejvýš tolik (po osmi akcích, kalendář jich mívá kolem šesti).
const MAX_LIST_PAGES = 12;
// Stránek akcí za průchod nejvýš tolik, zbytek příště.
export const MAX_DETAILS = 20;
// Delší akce (výstava na dva měsíce, advent) se neberou, do víkendového článku se nehodí.
const MAX_SPAN_DAYS = 31;

const text = (html, max) => htmlToText(String(html ?? "")).replace(/\s+/g, " ").trim().slice(0, max);

function iso(day, month, year) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// „6. 10. 2026“, „1. - 7. 10. 2026“, „9. 9. - 27. 10. 2026“, „28. 11. 2026 - 6. 1. 2027“.
export function parseRange(value) {
  const match = /(\d{1,2})\.\s*(?:(\d{1,2})\.\s*)?(?:(\d{4})\s*)?(?:-\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4}))?/.exec(String(value ?? ""));
  if (!match) return null;
  const [, d1, m1, y1, d2, m2, y2] = match;
  if (!d2) return m1 && y1 ? { startsOn: iso(d1, m1, y1), endsOn: "" } : null;
  return { startsOn: iso(d1, m1 ?? m2, y1 ?? y2), endsOn: iso(d2, m2, y2) };
}

function spanDays(range) {
  if (!range.endsOn) return 0;
  return (Date.parse(`${range.endsOn}T12:00:00Z`) - Date.parse(`${range.startsOn}T12:00:00Z`)) / 86_400_000;
}

function absolute(href) {
  const path = decodeEntities(String(href ?? "")).trim();
  return path.startsWith("/") && !path.startsWith("//") ? `${BASE}${path}` : "";
}

// Akce ze stránky seznamu. Testovací a dlouhé akce vynechá.
export function parseJicinList(html) {
  const events = [];
  for (const row of String(html ?? "").split('<div class="views-row">').slice(1)) {
    const link = /field--name-node-title[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    if (!link) continue;
    const url = absolute(link[1]);
    const title = text(link[2], 200);
    if (!url || !title || /^test\b/i.test(title)) continue;
    const start = /field--name-field-datetime-startend[^>]*>\s*<time datetime="(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(row);
    const range = start ? { startsOn: start[1], endsOn: "" } : parseRange(/date-display-range">([^<]+)</.exec(row)?.[1]);
    if (!range || spanDays(range) > MAX_SPAN_DAYS) continue;
    // Čas je zvlášť (start-copy3 „18.00“); u akce bez času má datetime půlnoc.
    const clock = /start-copy3[^>]*>\s*<time[^>]*>\s*(\d{1,2})[.:](\d{2})/.exec(row);
    const startsTime = clock ? `${clock[1].padStart(2, "0")}:${clock[2]}` : "";
    const summary = text(/field--name-body[^>]*>([\s\S]*?)<\/div>/.exec(row)?.[1], 500);
    events.push({ link: url, title, ...range, startsTime, summary });
  }
  return events;
}

// Místo a delší popis ze stránky akce.
export function parseJicinDetail(html) {
  const field = (name) => text(new RegExp(`field--name-${name}[^>]*>([\\s\\S]*?)</div>`).exec(String(html ?? ""))?.[1], 700);
  return { place: field("field-link-mapycz").slice(0, 160), body: field("body"), extra: field("field-ltext") };
}

async function getText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`jicin.org odpověděl ${response.status}.`);
  return response.text();
}

const guidOf = (link) => `jicinorg:${new URL(link).pathname}`;
const stampOf = (event) => `${event.startsOn} ${event.startsTime} ${event.endsOn}`.trim();

export async function fetchJicinOrg({ fetchImpl = fetch, known = new Map() } = {}) {
  const listed = [];
  const found = [];
  let complete = false;
  try {
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const events = parseJicinList(await getText(`${LIST}${page}`, fetchImpl));
      if (!events.length) {
        complete = true;
        break;
      }
      for (const event of events) {
        const guid = guidOf(event.link);
        if (listed.includes(guid)) continue;
        listed.push(guid);
        found.push({ ...event, guid });
      }
    }
  } catch (error) {
    if (!found.length) return { ok: false, error: error instanceof Error ? error.message : "jicin.org neodpověděl.", items: [], listed: [], complete: false };
  }
  const items = [];
  let details = MAX_DETAILS;
  for (const event of found) {
    const stamp = stampOf(event);
    if (known.get(event.guid) === stamp) {
      items.push({ guid: event.guid, stamp, unchanged: true });
      continue;
    }
    if (details <= 0) continue;
    details -= 1;
    let detail = { place: "", body: "", extra: "" };
    try {
      detail = parseJicinDetail(await getText(event.link, fetchImpl));
    } catch {
      continue;
    }
    const description = [detail.body || event.summary, detail.extra].filter(Boolean).join(" ").slice(0, 700);
    items.push({
      guid: event.guid,
      stamp,
      link: event.link,
      title: event.title,
      kind: "akce",
      startsOn: event.startsOn,
      endsOn: event.endsOn,
      startsTime: event.startsTime,
      endsTime: "",
      place: detail.place || "Jičín",
      description,
      soldOut: /vyprodáno/i.test(event.title),
    });
  }
  return { ok: true, items, listed, complete, warning: complete ? "" : "Kalendář se nepřečetl celý." };
}
