// Web na WordPressu (Střední škola zahradnická Kopidlno): příspěvky z REST API s rubrikou a hlavní fotkou.
// RSS WordPressu dává jen náhledy 150 × 150, API i větší velikost fotky. Bez sítě, ať jde testovat.
import { decodeEntities, htmlToText, imagesIn, USER_AGENT } from "../munipolis/feed.js";
import { schoolKey } from "./feed.js";

const MAX_ITEMS = 20;
// Hlavní fotka v rozumné velikosti (originály z mobilu mají přes 4 MB).
const SIZES = ["large", "entry-fullwidth", "entry", "medium_large", "medium", "full"];

// Web posílá v textu adresy s http://, fotky i články ale jdou i přes https.
function secure(url) {
  try {
    const parsed = new URL(decodeEntities(String(url ?? "")).trim());
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    if (parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function featuredImage(post) {
  const media = post?._embedded?.["wp:featuredmedia"]?.[0];
  const sizes = media?.media_details?.sizes ?? {};
  for (const size of SIZES) {
    if (sizes[size]?.source_url) return secure(sizes[size].source_url);
  }
  return media?.source_url ? secure(media.source_url) : "";
}

function categories(post) {
  return (post?._embedded?.["wp:term"] ?? [])
    .flat()
    .filter((term) => term?.taxonomy === "category")
    .map((term) => htmlToText(String(term.name ?? "")))
    .filter(Boolean);
}

function isoStamp(post) {
  const gmt = String(post?.date_gmt ?? "");
  const parsed = Date.parse(gmt ? `${gmt}Z` : String(post?.date ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

// Příspěvky jen z rubrik `skip` (třeba Projekty: povinné texty k dotacím) se vůbec neberou.
export function parseWordpressPosts(json, { maxItems = MAX_ITEMS, skip = [] } = {}) {
  if (!Array.isArray(json)) return { ok: false, items: [] };
  const items = [];
  for (const post of json) {
    const link = secure(post?.link);
    const guid = schoolKey(link);
    const title = htmlToText(String(post?.title?.rendered ?? "")).replace(/\s+/g, " ").slice(0, 300);
    if (!guid || !title) continue;
    const sections = categories(post);
    if (sections.length && sections.every((section) => skip.includes(section))) continue;
    const html = String(post?.content?.rendered ?? "").replace(/(src=["'])http:\/\//gi, "$1https://");
    const images = [...new Set([featuredImage(post), ...imagesIn(html)].filter(Boolean))];
    items.push({
      guid: guid.slice(0, 300),
      link: link.slice(0, 300),
      title,
      text: htmlToText(html),
      images: images.slice(0, 3),
      section: sections.join(", ").slice(0, 80),
      term: "",
      publishedAt: isoStamp(post),
    });
    if (items.length >= maxItems) break;
  }
  return { ok: true, items };
}

export async function fetchWordpressPosts(urls, { fetchImpl = fetch, skip = [] } = {}) {
  const [url] = urls;
  if (!url) return { ok: false, error: "Není nastavená adresa webu.", items: [] };
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
  } catch {
    return { ok: false, error: "Web školy neodpověděl.", items: [] };
  }
  if (!response.ok) return { ok: false, error: `Web školy odpověděl ${response.status}.`, items: [] };
  const parsed = parseWordpressPosts(await response.json().catch(() => null), { skip });
  return parsed.ok ? { ...parsed, warning: "" } : { ok: false, error: "Web školy neposlal seznam článků.", items: [] };
}
