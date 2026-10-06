// Weby obcí na Galileu (Rožďalovice, Dymokury…): přehled akcí má u každé akce název, „Kdy“ („24. 10. 2026
// začátek od 15:00“, „26. 10. 2026 18:00“, vícedenní s druhým datem), „Kde“ a někde krátký popis. Galileo má dva
// vzhledy (`event event-…` a novější `event-action__item`), čtou se oba. Model ani stránka akce nejsou potřeba.
// Přehled ukazuje jen budoucí akce, takže co z něj zmizí, je zrušené nebo proběhlé.
import { decodeEntities, htmlToText, USER_AGENT } from "../munipolis/feed.js";

// Stránek přehledu nejvýš tolik (Galileo stránkuje po desíti až dvaceti akcích).
const MAX_LIST_PAGES = 5;
// Delší akce (výstava na dva měsíce) se neberou, jako u jicin.org.
const MAX_SPAN_DAYS = 31;

// Obce do kalendáře akcí dávají i oznámení; ta se podle názvu vynechají.
const NOT_EVENT = /svoz|odpad|jízdní řád|\bJŘ\b|nábor|uzavírk|odstávk/i;

const text = (html, max) => htmlToText(String(html ?? "")).replace(/\s+/g, " ").trim().slice(0, max);

// „24. 10. 2026 začátek od 15:00“, „1. 11. 2026 – 3. 11. 2026“: první den, poslední den, čas.
export function parseGalileoWhen(value) {
  const days = [...String(value ?? "").matchAll(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/g)].map(
    ([, day, month, year]) => `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
  if (!days.length) return null;
  const clock = /(?:od|v)\s*(\d{1,2})[:.](\d{2})/.exec(String(value)) ?? /\d{4}\s+(\d{1,2})[:.](\d{2})/.exec(String(value));
  const last = days[days.length - 1];
  return { startsOn: days[0], endsOn: last > days[0] ? last : "", startsTime: clock ? `${clock[1].padStart(2, "0")}:${clock[2]}` : "" };
}

function spanDays(when) {
  return when.endsOn ? (Date.parse(`${when.endsOn}T12:00:00Z`) - Date.parse(`${when.startsOn}T12:00:00Z`)) / 86_400_000 : 0;
}

// Akce ze stránky přehledu. `base` je adresa webu (odkazy jsou relativní).
export function parseGalileoList(html, base) {
  const events = [];
  for (const block of String(html ?? "").split(/class="event event-|class="event-action__item /).slice(1)) {
    const id = /id="event-(\d+)"/.exec(block)?.[1];
    const href = /<a\b[^>]*\bhref="([^"]+)"/.exec(block)?.[1];
    const title = text(/class="(?:event-name|event-action__heading)">([\s\S]*?)<\/h3>/.exec(block)?.[1], 200);
    const whenHtml = /class="action_date[^"]*">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? /row-body--date-start">([\s\S]*?)<\/span>/.exec(block)?.[1];
    const when = parseGalileoWhen(text(whenHtml, 200));
    if (!id || !href || !title || !when || spanDays(when) > MAX_SPAN_DAYS || NOT_EVENT.test(title)) continue;
    let link;
    try {
      link = new URL(decodeEntities(href), base).toString();
    } catch {
      continue;
    }
    const venueHtml = /class="venues[^"]*">([\s\S]*?)<\/div>/.exec(block)?.[1] ?? /row-body--venue">([\s\S]*?)<\/span>/.exec(block)?.[1];
    const place = text(venueHtml, 160).replace(/^Kde:\s*/, "");
    const description = text(/class="(?:event-perex|event-action__perex)[^"]*">([\s\S]*?)<\/(?:p|div)>/.exec(block)?.[1], 700);
    events.push({ id, link, title, place, description, ...when });
  }
  return events;
}

// Čtečka pro zdroj v sources.js (`list` je adresa přehledu akcí). Stránku akce nečte, takže `known` nepotřebuje.
export function galileoReader(source) {
  return async function fetchGalileoEvents({ fetchImpl = fetch } = {}) {
    const found = [];
    let complete = true;
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
      const url = page === 1 ? source.list : `${source.list}?page=${page}`;
      let html;
      try {
        const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(`${response.status}`);
        html = await response.text();
      } catch (error) {
        if (page === 1) return { ok: false, error: `Web obce neodpověděl${error instanceof Error && /^\d+$/.test(error.message) ? ` (${error.message})` : ""}.`, items: [], listed: [], complete: false };
        // Další stránka nejde: co na ní je, se nesmí brát jako zrušené.
        complete = false;
        break;
      }
      const events = parseGalileoList(html, source.list).filter((event) => !found.some((other) => other.id === event.id));
      if (!events.length) break;
      found.push(...events);
      // Bez odkazu na další stránku je přehled celý.
      if (!/[?&]page=\d+/.test(html)) break;
    }
    const items = found.map((event) => ({
      guid: `${source.tag}:${event.id}`,
      stamp: `${event.startsOn} ${event.startsTime} ${event.endsOn} ${event.place}`.trim(),
      link: event.link,
      title: event.title,
      kind: "akce",
      startsOn: event.startsOn,
      endsOn: event.endsOn,
      startsTime: event.startsTime,
      endsTime: "",
      place: event.place || source.town,
      description: event.description,
      soldOut: false,
    }));
    return { ok: true, items, listed: items.map((item) => item.guid), complete, warning: complete ? "" : "Přehled akcí se nepřečetl celý." };
  };
}
