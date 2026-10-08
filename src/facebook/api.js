// Facebook Pages přes Graph API: token v hlavičce, jen veřejné příspěvky vybraných Pages. Bez stahování webu Facebooku.
// `fetchFacebookPages` vrací položky ve tvaru zdrojů v src/skola/sources.js (guid, link, title, text, images, section…).
import { pastedTitle } from "../skola/paste.js";

export const GRAPH_VERSION = "v26.0";
// Z alba jen pár fotek, víc jich import nebere (`MAX_IMAGES`). Kratší odpověď od Mety.
export const POST_FIELDS = "id,message,created_time,permalink_url,is_published,attachments.limit(3){media,subattachments.limit(3){media}}";
const GRAPH = "https://graph.facebook.com";
const MAX_PAGES = 2;
const PAGE_SIZE = 25;
const MAX_IMAGES = 3;
// Starší příspěvky automatika nebere (nejvýš 60 dní, `readFreshDays`), další stránku už nestahovat.
const MAX_AGE_DAYS = 60;
const FACEBOOK_HOSTS = ["facebook.com", "www.facebook.com", "m.facebook.com"];

// Adresa Page: alias (/JicinevesCZ), /profile.php?id=…, nebo s číselným ID na konci (/people/Jmeno/615…, /p/Jmeno-615…, /Jmeno-123…).
function pagePath(url) {
  if (url.pathname === "/profile.php") return url.searchParams.get("id") ?? "";
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const people = path.match(/^people\/[^/]+\/(\d+)$/);
  if (people) return people[1];
  const named = path.match(/^(?:p\/)?[^/]+-(\d{5,})$/);
  return named ? named[1] : path;
}

export function pageIdentifier(value) {
  let text = String(value ?? "").trim();
  if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { return ""; }
    if (url.protocol !== "https:" || !FACEBOOK_HOSTS.includes(url.hostname) || url.username || url.password || url.port) return "";
    text = pagePath(url);
  }
  if (!/^[a-z\d](?:[a-z\d.]{0,78}[a-z\d])?$/i.test(text) || /^(me|feed|posts|groups|reel|watch|search|pages|events)$/i.test(text)) return "";
  return text;
}

function errorText(code) {
  if (code === 190) return "Facebook nepřijal přístupový token. Správce musí zkontrolovat jeho platnost.";
  if ([4, 17, 32, 613].includes(code)) return "Facebook omezil počet požadavků. Zkuste načtení později.";
  if ([10, 100, 200].includes(code)) return "Facebook nepovolil čtení této Page. Zkontrolujte její ID, token a schválení Page Public Content Access. Před schválením testujte Page, kterou spravuje správce aplikace.";
  return "Facebook data neposkytl. Zkuste načtení později nebo zkontrolujte nastavení aplikace.";
}

async function graph(env, node, params, fetchImpl) {
  if (!env.FACEBOOK_ACCESS_TOKEN) return { ok: false, error: "Správce ještě nenastavil přístup k Facebooku." };
  const version = env.FACEBOOK_GRAPH_VERSION || GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) return { ok: false, error: "Verze Graph API není správně nastavená." };
  const url = new URL(`${GRAPH}/${version}/${node}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetchImpl(url.href, {
      headers: { Authorization: `Bearer ${env.FACEBOOK_ACCESS_TOKEN}` },
      // Workers neumí redirect: "error". Přesměrování se nesleduje a bere se jako chyba, ať token neodejde jinam.
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) return { ok: false, error: errorText(0) };
    const data = await response.json();
    // Zpráva Meta může obsahovat citlivé údaje. Do UI a logů jde jen naše vlastní vysvětlení.
    if (!response.ok || data?.error) return { ok: false, error: errorText(Number(data?.error?.code)) };
    return { ok: true, data };
  } catch (error) {
    // Do logu Workeru jen naše výjimka (síť, timeout, špatná volba fetch). Token je v hlavičce, v adrese ani zprávě není.
    console.error(`Facebook ${node}: ${error?.name ?? "Error"}: ${error?.message ?? error}`);
    return { ok: false, error: "Facebook se nepodařilo načíst. Zkuste to později." };
  }
}

// Fotky z příspěvku (jedna nebo album). Stahuje je až zpracování přes fetchImage, adresy z CDN Facebooku po pár dnech vyprší.
function postImages(row) {
  const media = [];
  for (const attachment of row.attachments?.data ?? []) {
    media.push(attachment?.media);
    for (const sub of attachment?.subattachments?.data ?? []) media.push(sub?.media);
  }
  const urls = media.map((item) => String(item?.image?.src ?? "")).filter((src) => /^https:\/\/[^/\s]+\/\S+$/i.test(src) && src.length <= 2000);
  return [...new Set(urls)].slice(0, MAX_IMAGES);
}

function secureLink(value) {
  let link;
  try { link = new URL(value); } catch { return ""; }
  if (link.protocol !== "https:" || !FACEBOOK_HOSTS.includes(link.hostname) || link.username || link.password || link.port) return "";
  // Token nikdy nesmí skončit v uloženém odkazu.
  if (link.searchParams.has("access_token") || link.href.length > 300) return "";
  return link.href;
}

// Jen zveřejněný příspěvek té Page s textem a veřejným odkazem.
export function publicPost(row, page) {
  if (!row || row.is_published !== true || !new RegExp(`^${page.id}_\\d+$`).test(String(row.id))) return null;
  const text = typeof row.message === "string" ? row.message.replace(/\r\n?/g, "\n").trim().slice(0, 10_000) : "";
  const at = Date.parse(row.created_time);
  const link = secureLink(row.permalink_url);
  if (!text || !Number.isFinite(at) || !link) return null;
  return {
    guid: String(row.id),
    link,
    title: pastedTitle(text),
    text,
    images: postImages(row),
    section: page.name,
    term: "",
    publishedAt: new Date(at).toISOString(),
  };
}

// Špatná adresa v nastavení (`saveSkolaSettings` přes `feedProblem` ve zdroji).
export function pageProblem(url) {
  return pageIdentifier(url) ? "" : `${url} není odkaz na facebookovou stránku (Page).`;
}

async function fetchPage(env, identifier, fetchImpl) {
  const key = pageIdentifier(identifier);
  if (!key) return { ok: false, error: pageProblem(identifier) };
  // Údaje Page i první stránka příspěvků jedním dotazem.
  const page = await graph(env, key, { fields: `id,name,category,posts.limit(${PAGE_SIZE}){${POST_FIELDS}}` }, fetchImpl);
  if (!page.ok) return page;
  // category má jen Page; osobní profil ani /me zdrojem být nesmí.
  if (!/^\d+$/.test(String(page.data?.id)) || !page.data?.name || typeof page.data.category !== "string") return { ok: false, error: `${key} není Facebook Page.` };
  const info = { id: String(page.data.id), name: String(page.data.name).replace(/\s+/g, " ").trim().slice(0, 80) };
  const items = [];
  const oldest = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const cursors = new Set();
  // Page bez příspěvků (nebo bez práva je číst) pole posts vůbec nemá.
  let list = page.data.posts ?? { data: [] };
  for (let n = 0; ; n++) {
    if (!Array.isArray(list?.data)) return { ok: false, error: "Facebook vrátil neúplný seznam příspěvků." };
    for (const row of list.data) {
      const item = publicPost(row, info);
      if (item) items.push(item);
    }
    // paging.next se neotevírá, mohl by nést token jinam. Jen kurzor na stejném Graph API.
    const next = list.paging?.cursors?.after;
    const last = Date.parse(list.data.at(-1)?.created_time);
    if (n + 1 >= MAX_PAGES || !list.paging?.next || typeof next !== "string" || !next || next.length > 1000 || cursors.has(next) || !(last >= oldest)) break;
    cursors.add(next);
    const response = await graph(env, `${info.id}/posts`, { fields: POST_FIELDS, limit: String(PAGE_SIZE), after: next }, fetchImpl);
    if (!response.ok) return response;
    list = response.data;
  }
  return { ok: true, items };
}

// `urls` jsou adresy Pages z nastavení zdroje. Jedna nefunkční Page ostatní nezastaví (warning jako u RSS).
export async function fetchFacebookPages(urls, { env = {}, fetchImpl = fetch } = {}) {
  if (!env.FACEBOOK_ACCESS_TOKEN) return { ok: false, error: "Chybí přístup k Facebooku (tajemství FACEBOOK_ACCESS_TOKEN).", items: [] };
  // Pages souběžně, každá má nejvýš dva dotazy.
  const results = await Promise.all(urls.map((url) => fetchPage(env, url, fetchImpl)));
  const working = results.filter((result) => result.ok);
  if (!working.length) return { ok: false, error: results[0]?.error ?? "Není nastavená žádná Page.", items: [] };
  const seen = new Set();
  const items = working.flatMap((result) => result.items).filter((item) => !seen.has(item.guid) && seen.add(item.guid));
  const failed = results.find((result) => !result.ok);
  return { ok: true, error: "", warning: failed ? failed.error : "", items };
}
