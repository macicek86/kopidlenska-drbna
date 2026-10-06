// Úřední deska města Kopidlna (Antee): z RSS bere jen usnesení a zápisy rady a zastupitelstva a pozvánky na zasedání.
// RSS nese jen nadpis a odkazy na přílohy; text je v PDF, které Drběna dostane celé (`fetchDocuments`).
import { decodeEntities, htmlToText, tag, USER_AGENT } from "../munipolis/feed.js";
import { fetchSchoolFeeds } from "./feed.js";

export const DESK_FEED = "https://www.kopidlno.cz/uredni-deska?action=atom";
export const DESK_SECTION = "Úřední deska";
// Ostatní (dražby, rozpočtová opatření, výběrová řízení, katastr…) se ani neukládá.
const DESK_TOPICS = /usnesení|zápis\s+(ze|z)\s|zasedání\s+zastupitelstv/i;
const MAX_ITEMS = 20;
const MAX_DOCUMENTS = 2;
// Zápis ze zastupitelstva mívá desítky stran; větší soubor je nejspíš sken. Dva takové i s base64 se vejdou do stropu API (32 MB).
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

// Přílohy bez sledovacích parametrů (utm_…), ostatní parametry (oid) zůstávají.
function cleanFileUrl(raw) {
  try {
    const url = new URL(decodeEntities(raw));
    if (url.protocol !== "https:") return "";
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

// Všechny dokumenty desky mají stejnou cestu, liší se jen `id`. Klíčem je proto id.
function deskEntry(raw) {
  try {
    const url = new URL(decodeEntities(raw));
    const id = url.searchParams.get("id");
    if (url.protocol !== "https:" || !/^\d+$/.test(id ?? "")) return null;
    return { guid: `${url.hostname}/uredni-deska/${id}`, link: `${url.origin}${url.pathname}?id=${id}&action=detail` };
  } catch {
    return null;
  }
}

function isoStamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function parseDeskFeed(xml, { maxItems = MAX_ITEMS } = {}) {
  const text = String(xml ?? "");
  if (!/<rss[\s>]/i.test(text) && !/<channel[\s>]/i.test(text)) return { ok: false, items: [] };
  const items = [];
  for (const match of text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = htmlToText(tag(block, "title")).replace(/\s+/g, " ").slice(0, 300);
    if (!DESK_TOPICS.test(title)) continue;
    const entry = deskEntry(tag(block, "guid").trim() || tag(block, "link").trim());
    if (!entry) continue;
    const files = decodeEntities(tag(block, "description")).match(/https:\/\/\S+/g) ?? [];
    const documents = [...new Set(files.map(cleanFileUrl).filter(Boolean))].slice(0, MAX_DOCUMENTS);
    if (!documents.length) continue;
    items.push({
      ...entry,
      title,
      text: "",
      images: [],
      documents,
      section: DESK_SECTION,
      term: "",
      publishedAt: isoStamp(tag(block, "pubDate")),
    });
    if (items.length >= maxItems) break;
  }
  return { ok: true, items };
}

async function fetchDesk(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: "Úřední deska neodpověděla.", items: [] };
  }
  if (!response.ok) return { ok: false, error: `Úřední deska odpověděla ${response.status}.`, items: [] };
  const parsed = parseDeskFeed(await response.text());
  return parsed.ok ? parsed : { ok: false, error: "Na adrese úřední desky není RSS.", items: [] };
}

// Aktuality (adresy z nastavení) a k nim úřední deska. Stačí, když odpoví jedno z toho.
export async function fetchCityItems(urls, { fetchImpl = fetch } = {}) {
  const news = await fetchSchoolFeeds(urls, { fetchImpl });
  const desk = await fetchDesk(DESK_FEED, fetchImpl);
  if (!news.ok && !desk.ok) return news;
  const warning = [news.ok ? news.warning : news.error, desk.ok ? "" : desk.error].filter(Boolean).join(" ");
  return { ok: true, error: "", warning, items: [...news.items, ...desk.items] };
}

// PDF z přílohy pro Claude (bajty a typ). Co není PDF nebo je moc velké, vynechá.
export async function fetchDocuments(urls, { fetchImpl = fetch } = {}) {
  const documents = [];
  for (const url of urls.slice(0, MAX_DOCUMENTS)) {
    try {
      const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000), redirect: "follow" });
      if (!response.ok) continue;
      const size = Number(response.headers.get("content-length") ?? 0);
      if (size > MAX_DOCUMENT_BYTES) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const isPdf = bytes.length > 4 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
      if (isPdf && bytes.length <= MAX_DOCUMENT_BYTES) documents.push({ type: "application/pdf", bytes });
    } catch {
      // Příloha nejde stáhnout: Drběna dostane jen to, co jde.
    }
  }
  return documents;
}
