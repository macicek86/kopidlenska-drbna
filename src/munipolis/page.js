// Stránka zprávy na Munipolisu: RSS nese jen první obrázek, ostatní (třeba výlukové jízdní řády) jsou jen tady.
// Stránka má zprávu jako JSON v atributu `:item` komponenty feed-item-detail, obrázky v `images.data`.
import { decodeEntities, USER_AGENT } from "./feed.js";

const MAX_PAGE_IMAGES = 10;

export function pageImages(html) {
  const match = String(html ?? "").match(/<feed-item-detail\b[^>]*?\s:item="([^"]*)"/i);
  if (!match) return [];
  let item;
  try {
    item = JSON.parse(decodeEntities(match[1]));
  } catch {
    return [];
  }
  const data = item?.images?.data;
  const list = Array.isArray(data) ? data : Object.values(data ?? {});
  const found = [];
  for (const image of list) {
    const url = String(image?.path ?? "").trim();
    if ((image?.type ?? "image") !== "image" || !/^https:\/\//i.test(url) || found.includes(url)) continue;
    found.push(url);
    if (found.length >= MAX_PAGE_IMAGES) break;
  }
  return found;
}

// Adresy obrázků ze stránky zprávy. Když stránka nejde, prázdný seznam: Drběna vezme, co je v RSS.
export async function fetchPageImages(link, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\/[a-z0-9-]+\.munipolis\.cz\//i.test(String(link ?? ""))) return [];
  try {
    const response = await fetchImpl(link, {
      headers: { Accept: "text/html", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!response.ok) return [];
    return pageImages(await response.text());
  } catch {
    return [];
  }
}

// Obrázky z RSS a ze stránky dohromady, každý jednou a v pořadí: nejdřív ten z RSS (hlavní), pak galerie.
export function mergeImageUrls(feed, page) {
  return [...new Set([...(feed ?? []), ...(page ?? [])])];
}
