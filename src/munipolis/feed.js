// RSS z Munipolisu: rozebrání kanálu na zprávy s textem a obrázky. Bez sítě, ať jde testovat.

export const DEFAULT_FEED_URL = "https://kopidlno.munipolis.cz/rss";
export const USER_AGENT = "KopidlenskaDrbna/1.0 (+https://www.kopidlenskadrbna.org)";
const MAX_ITEMS = 40;
const MAX_TEXT = 12000;

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(value) {
  return String(value ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[body.toLowerCase()] ?? all;
  });
}

function unwrap(value) {
  const text = String(value ?? "").trim();
  const cdata = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(text);
}

export function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? unwrap(match[1]) : "";
}

// Odkaz zůstane v textu jako „popis (adresa)“, ať ho Drběna může dát do článku. Relativní adresu doplní podle `base`
// (adresa článku), jiné než https, http a mailto zahodí, stejně jako odkazy na obrázky. Když je popis sám adresou, zůstane jen on.
function keepLinks(html, base) {
  return html.replace(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (all, href, inner) => {
    let url = "";
    try {
      url = new URL(decodeEntities(href).trim(), base || undefined).href;
    } catch {
      return inner;
    }
    if (!/^(https?:|mailto:)/i.test(url)) return inner;
    const label = decodeEntities(inner.replace(/<[^>]+>/g, "")).trim();
    // Odkaz bez popisu bývá fotka v galerii, ta Drběně nic neřekne.
    if (!label || /\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url)) return inner;
    if (label.includes(url.replace(/^mailto:/i, "").replace(/\/$/, ""))) return inner;
    return `${inner} (${url})`;
  });
}

// Text zprávy pro AI i pro náhled v redakci: odstavce oddělené prázdným řádkem, bez značek.
// `links` nechá u odkazů adresu (true, nebo adresa článku pro doplnění relativních odkazů).
export function htmlToText(html, { links = false } = {}) {
  const source = links ? keepLinks(String(html ?? ""), typeof links === "string" ? links : "") : String(html ?? "");
  const text = source
    .replace(/\r\n?/g, "\n")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

export function imagesIn(html) {
  const found = [];
  for (const match of String(html ?? "").matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const url = decodeEntities(match[1]).trim();
    if (/^https:\/\//i.test(url) && !found.includes(url)) found.push(url);
  }
  return found;
}

function isoStamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function parseFeed(xml, { maxItems = MAX_ITEMS } = {}) {
  const text = String(xml ?? "");
  if (!/<rss[\s>]/i.test(text) && !/<channel[\s>]/i.test(text)) return { ok: false, items: [] };
  const items = [];
  for (const match of text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const link = tag(block, "link").trim();
    const guid = tag(block, "guid").trim() || link;
    const title = htmlToText(tag(block, "title")).replace(/\s+/g, " ").slice(0, 300);
    if (!guid || !title) continue;
    const html = tag(block, "description");
    items.push({
      guid: guid.slice(0, 300),
      link: /^https:\/\//i.test(link) ? link.slice(0, 300) : "",
      title,
      text: htmlToText(html, { links: link || true }),
      images: imagesIn(html).slice(0, 3),
      publishedAt: isoStamp(tag(block, "pubDate")),
    });
    if (items.length >= maxItems) break;
  }
  return { ok: true, items };
}

export async function fetchFeed(url, { fetchImpl = fetch, source = "Munipolis", maxItems = MAX_ITEMS } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: `${source} neodpověděl.`, items: [] };
  }
  if (!response.ok) return { ok: false, error: `${source} odpověděl ${response.status}.`, items: [] };
  const parsed = parseFeed(await response.text(), { maxItems });
  if (!parsed.ok) return { ok: false, error: "Na adrese není RSS.", items: [] };
  return { ok: true, error: "", items: parsed.items };
}

export function readFeedUrl(value, fallback = DEFAULT_FEED_URL) {
  const url = String(value ?? "").trim();
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    return parsed.toString().slice(0, 300);
  } catch {
    return "";
  }
}
