// Jičínský deník: z RSS jen zprávy o Kopidlnu a jeho částech, ze stránky článku jen volně dostupný text. Bez sítě, ať jde testovat.
import { decodeEntities, fetchFeed, htmlToText, USER_AGENT } from "../munipolis/feed.js";

export const DEFAULT_FEED_URL = "https://jicinsky.denik.cz/rss/vse.xml";
const MAX_FEED_ITEMS = 80;

// Kopidlno a jeho části ve všech pádech (Kopidlně, Drahorazi, Mlýnci, Pševsi, Ledkově…).
// Mlýnec jen s velkým písmenem, ať se nechytá obyčejný mlýnek.
const PLACES = [
  /kopidl/i,
  /drahoraz/i,
  /\bMlýn(ec|c[eiů]|cem)(?!\p{L})/u,
  /\bPševes|\bPševs/iu,
  /\bLedkov/iu,
];

function readable(link) {
  try {
    return decodeURIComponent(String(link ?? ""));
  } catch {
    return String(link ?? "");
  }
}

export function aboutKopidlno(item) {
  const haystack = `${item.title}\n${item.text}\n${readable(item.link)}`;
  return PLACES.some((place) => place.test(haystack));
}

// Fotbal má drbna z webu FK Kopidlno, z Deníku ho bere jen na přání.
export function isFootball(item) {
  try {
    return /fotbal/i.test(new URL(item.link).pathname);
  } catch {
    return false;
  }
}

// Bez sledovacích parametrů, ať je stejný článek vždy jedna položka.
export function cleanLink(link) {
  try {
    const url = new URL(decodeEntities(link));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function pickItems(items, { football = false } = {}) {
  return items
    .map((item) => {
      const link = cleanLink(item.link);
      return { ...item, link, guid: link || item.guid, images: [] };
    })
    .filter((item) => aboutKopidlno(item) && (football || !isFootball(item)));
}

export async function fetchDenikFeed(url, { fetchImpl = fetch, football = false } = {}) {
  const feed = await fetchFeed(url, { fetchImpl, source: "Deník", maxItems: MAX_FEED_ITEMS });
  if (!feed.ok) return feed;
  return { ...feed, total: feed.items.length, items: pickItems(feed.items, { football }) };
}

// Perex a text článku až po místo, kde začíná placená část. Reklamy, skripty a odkazy na jiné články pryč.
export function articleText(html) {
  const page = String(html ?? "");
  const perex = page.match(/<p[^>]*\bjs-article-perex\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  const start = page.search(/<div[^>]*\barticle-body-blocks\b/i);
  let body = "";
  if (start >= 0) {
    const rest = page.slice(start);
    const stops = [rest.search(/<div[^>]*id="content_break"/i), rest.search(/<\/section>/i)].filter((index) => index > 0);
    body = rest
      .slice(0, stops.length ? Math.min(...stops) : rest.length)
      .replace(/<(script|style|svg|figure|aside|iframe|noscript)[\s\S]*?<\/\1>/gi, "")
      .replace(/<div[^>]*\bcontent-box[\s\S]*?<\/div>/gi, "");
  }
  return htmlToText(`<p>${perex}</p>${body}`);
}

export async function fetchArticle(url, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "text/html", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: "Stránka článku na Deníku neodpověděla." };
  }
  if (!response.ok) return { ok: false, error: `Deník odpověděl ${response.status}.` };
  return { ok: true, text: articleText(await response.text()) };
}
