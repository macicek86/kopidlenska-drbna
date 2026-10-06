// Program Kulturního zařízení města Jičína (kzmj.cz, WordPress). RSS nese jen jeden starý příspěvek, akce jsou
// ve vlastních typech v REST API. Biograf má v `date` začátek promítání; divadlo a nefilmové akce tam mají den
// zadání, termín a místo jsou jen na stránce akce (tlačítko „do kalendáře“), proto se ta stáhne, když je akce nová
// nebo se změnila (`modified_gmt`). Typ `repriza` (přihlášky k upozornění, i s e-maily lidí) se nebere.
import { decodeEntities, htmlToText, USER_AGENT } from "../munipolis/feed.js";

const API = "https://kzmj.cz/wp-json/wp/v2/";
const FIELDS = "id,date,modified_gmt,link,title,content,meta_box";
const TYPES = [
  { type: "divadlo_akce", kind: "divadlo", page: true },
  { type: "nefilmove_akce", kind: "akce", page: true },
  { type: "biograf_akce", kind: "kino", page: false, place: "Biograf Český ráj" },
];
// Stránek akcí za jeden průchod nejvýš tolik (Worker má omezený počet požadavků), zbytek příště.
export const MAX_PAGES = 25;
const MAX_API_PAGES = 3;

const clean = (value, max) => htmlToText(String(value ?? "")).replace(/\s+/g, " ").trim().slice(0, max);

function secure(url) {
  try {
    const parsed = new URL(decodeEntities(String(url ?? "")).trim());
    if (parsed.hostname !== "kzmj.cz" && !parsed.hostname.endsWith(".kzmj.cz")) return "";
    parsed.protocol = "https:";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

// Termín a místo z tlačítka „do kalendáře“ na stránce akce.
export function parseEventPage(html) {
  const tag = /<add-to-calendar-button\b([^>]*)>/i.exec(String(html ?? ""));
  if (!tag) return null;
  const attrs = {};
  for (const [, name, value] of tag[1].matchAll(/([a-zA-Z]+)="([^"]*)"/g)) attrs[name] = decodeEntities(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attrs.startDate ?? "")) return null;
  const time = (value) => (/^\d{2}:\d{2}$/.test(value ?? "") ? value : "");
  return { startsOn: attrs.startDate, startsTime: time(attrs.startTime), endsTime: time(attrs.endTime), place: clean(attrs.location, 160) };
}

// Jedna akce z REST API. Bez stránky (biograf) termín z `date`, jinak ho doplní `page`.
export function parseKzmjPost(post, spec, page = null) {
  const link = secure(post?.link);
  const id = Number(post?.id);
  const title = clean(post?.title?.rendered, 200);
  if (!link || !Number.isInteger(id) || !title) return null;
  const base = {
    guid: `kzmj:${spec.type}:${id}`,
    stamp: String(post?.modified_gmt ?? ""),
    link,
    title,
    kind: spec.kind,
    description: clean(post?.content?.rendered, 700),
    soldOut: String(post?.meta_box?.vyprodano ?? "") === "1" || /vyprodáno/i.test(title),
  };
  if (spec.page) {
    if (!page) return null;
    return { ...base, startsOn: page.startsOn, startsTime: page.startsTime, endsTime: page.endsTime, place: page.place };
  }
  const date = String(post?.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(date)) return null;
  return { ...base, startsOn: date.slice(0, 10), startsTime: date.slice(11, 16), endsTime: "", place: spec.place };
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`KZMJ odpověděl ${response.status}.`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error("KZMJ neposlal seznam akcí.");
  return { json, pages: Number(response.headers.get("x-wp-totalpages")) || 1 };
}

async function listType(spec, fetchImpl) {
  const posts = [];
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const { json, pages } = await getJson(`${API}${spec.type}?per_page=100&page=${page}&_fields=${FIELDS}`, fetchImpl);
    posts.push(...json);
    if (page >= pages) break;
  }
  return posts;
}

async function readPage(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    return response.ok ? parseEventPage(await response.text()) : null;
  } catch {
    return null;
  }
}

// `known` (guid → stamp) říká, co už drbna má: nezměněnou akci vrátí jen jako { guid, stamp, unchanged }.
// `listed` jsou všechny akce, které na webu jsou (co v něm chybí, KZMJ zrušilo); `complete` jen když se přečetly všechny typy.
export async function fetchKzmj({ fetchImpl = fetch, known = new Map() } = {}) {
  const items = [];
  const listed = [];
  const errors = [];
  let pagesLeft = MAX_PAGES;
  for (const spec of TYPES) {
    let posts;
    try {
      posts = await listType(spec, fetchImpl);
    } catch (error) {
      errors.push(error instanceof Error && error.message.startsWith("KZMJ") ? error.message : "KZMJ neodpověděl.");
      continue;
    }
    for (const post of posts) {
      const guid = `kzmj:${spec.type}:${Number(post?.id)}`;
      listed.push(guid);
      const stamp = String(post?.modified_gmt ?? "");
      if (spec.page && known.has(guid) && known.get(guid) === stamp) {
        items.push({ guid, stamp, unchanged: true });
        continue;
      }
      let page = null;
      if (spec.page) {
        if (pagesLeft <= 0) continue;
        pagesLeft -= 1;
        page = await readPage(secure(post?.link), fetchImpl);
      }
      const item = parseKzmjPost(post, spec, page);
      if (item) items.push(item);
    }
  }
  if (errors.length === TYPES.length) return { ok: false, error: errors[0], items: [], listed: [], complete: false };
  return { ok: true, items, listed, complete: !errors.length, warning: errors[0] ?? "" };
}
