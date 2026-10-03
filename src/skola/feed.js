// Web ZŠ a MŠ Kopidlno (Antee): RSS rubrik s celým textem, fotkou a termínem akce. Bez sítě, ať jde testovat.
import { decodeEntities, htmlToText, imagesIn, readFeedUrl, tag, USER_AGENT } from "../munipolis/feed.js";

export const SCHOOL_NAME = "ZŠ a MŠ Kopidlno";
export const DEFAULT_FEEDS = ["https://www.zskopidlno.cz/aktuality-zs?action=atom", "https://www.zskopidlno.cz/aktuality-ms?action=atom"];
const MAX_FEEDS = 6;
const MAX_ITEMS = 30;

// Bez sledovacích parametrů (utm_…), ať je stejný článek vždy jedna položka.
function cleanLink(link) {
  try {
    const url = new URL(decodeEntities(link));
    if (url.protocol !== "https:") return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

// Škola dává stejný článek do aktualit ZŠ i MŠ pod stejným jménem v adrese. Klíčem je proto jen to jméno.
export function schoolKey(link) {
  try {
    const url = new URL(link);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return slug ? `${url.hostname}/${slug}` : "";
  } catch {
    return "";
  }
}

function isoStamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

// Termín akce tak, jak ho škola zadala („3. 10. 2026“, případně do „10. 10. 2026“).
function termOf(block) {
  const from = tag(block, "dueDate").trim();
  const to = tag(block, "endDate").trim();
  if (!from) return "";
  return to && to !== from ? `${from} až ${to}` : from;
}

export function parseSchoolFeed(xml, { maxItems = MAX_ITEMS } = {}) {
  const text = String(xml ?? "");
  if (!/<rss[\s>]/i.test(text) && !/<channel[\s>]/i.test(text)) return { ok: false, items: [] };
  const channel = text.split(/<item[\s>]/i)[0];
  const section = htmlToText(tag(channel, "description") || tag(channel, "title").split("|")[0]).slice(0, 80);
  const items = [];
  for (const match of text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const link = cleanLink(tag(block, "link").trim() || tag(block, "guid").trim());
    const guid = schoolKey(link);
    const title = htmlToText(tag(block, "title")).replace(/\s+/g, " ").slice(0, 300);
    if (!guid || !title) continue;
    const html = tag(block, "content:encoded") || tag(block, "description");
    const enclosure = decodeEntities(block.match(/<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i)?.[1] ?? "").trim();
    const images = [...new Set([enclosure, ...imagesIn(html)].filter((url) => /^https:\/\//i.test(url)))];
    items.push({
      guid: guid.slice(0, 300),
      link: link.slice(0, 300),
      title,
      text: htmlToText(html),
      images: images.slice(0, 3),
      section,
      term: termOf(block).slice(0, 60),
      publishedAt: isoStamp(tag(block, "pubDate")),
    });
    if (items.length >= maxItems) break;
  }
  return { ok: true, items };
}

async function fetchOne(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: "Web školy neodpověděl.", items: [] };
  }
  if (!response.ok) return { ok: false, error: `Web školy odpověděl ${response.status}.`, items: [] };
  const parsed = parseSchoolFeed(await response.text());
  return parsed.ok ? parsed : { ok: false, error: "Na adrese není RSS.", items: [] };
}

// Stáhne všechny kanály. Stačí, když odpoví aspoň jeden; článek, který je ve dvou, se vezme jednou.
export async function fetchSchoolFeeds(urls, { fetchImpl = fetch } = {}) {
  const results = [];
  for (const url of urls) results.push(await fetchOne(url, fetchImpl));
  const working = results.filter((result) => result.ok);
  if (!working.length) return { ok: false, error: results[0]?.error ?? "Není nastavený žádný kanál.", items: [] };
  const seen = new Set();
  const items = [];
  for (const item of working.flatMap((result) => result.items)) {
    if (seen.has(item.guid)) continue;
    seen.add(item.guid);
    items.push(item);
  }
  const failed = results.find((result) => !result.ok);
  return { ok: true, error: "", warning: failed ? failed.error : "", items };
}

// Adresy kanálů z nastavení, jedna na řádek. Vrací null, když některá nesedí.
export function readFeedUrls(value) {
  const lines = String(value ?? "")
    .split(/\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return DEFAULT_FEEDS;
  const urls = lines.map((line) => readFeedUrl(line, ""));
  if (urls.some((url) => !url)) return null;
  return [...new Set(urls)].slice(0, MAX_FEEDS);
}
