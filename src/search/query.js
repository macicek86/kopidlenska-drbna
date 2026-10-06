// Hledání v celém archivu zpráv: fulltext podle slov a otisky podle významu, výsledky sloučené (RRF).
// Fulltext najde jména, místa a čísla, otisky i zprávu, která stejnou věc říká jinými slovy.
// Používá chat (hledat_zpravy), importy (Možná souvisí) i pomocník při psaní.
import { liveArticle } from "../db-core.js";
import { shownKeywords } from "../keywords.js";
import { indexText } from "./store.js";
import { nearestArticles } from "./vectors.js";

// Bez diakritiky a malými písmeny, ať „knihovně“ najde „knihovna“.
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Slova, která v dotazu nic neříkají a fulltextem by našla půl archivu (i Kopidlno, to je skoro v každé zprávě).
const STOP = new Set(
  "kdy kde kdo jak jaky jaka jake jakou jaci proc kolik ktery ktera ktere kterou bude budou byl byla bylo byly jsou jste jsem mate vite neni nebo pro pri tak tam ten tuto tento tohle tady uz jeste taky take prosim dnes zitra vcera kopidlno kopidlna kopidlnu kopidlne kopidlnem".split(
    " ",
  ),
);

// České koncovky se mění: krátké slovo celé, delší bez posledního písmene, dlouhé bez dvou
// (hasiči → hasic najde hasičů, knihovna → knihov najde knihovně). Pohyblivé e (zámek, zámku) nezvládne,
// proto Drběna k dotazu přidává tvary a synonyma.
export function stem(word) {
  if (word.length <= 4) return word;
  if (word.length <= 6) return word.slice(0, -1);
  return word.slice(0, -2);
}

export function searchStems(text, max = 12) {
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP.has(word));
  return [...new Set(words.map(stem))].slice(0, max);
}

// Dotaz pro FTS5: každý kmen jako začátek slova, stačí kterýkoli (pořadí podle bm25).
export function ftsQuery(stems) {
  return stems.map((value) => `"${value}"*`).join(" OR ");
}

const FTS_LIMIT = 30;
// Váhy sloupců pro bm25: nadpis, perex, klíčová slova, text.
const WEIGHTS = "8.0, 4.0, 8.0, 1.0";

function yearFilter(year) {
  return Number.isInteger(year) ? ` and substr(a.created_at, 1, 4) = '${year}'` : "";
}

async function textHits(env, stems, year) {
  if (!stems.length) return [];
  try {
    const rows = await env.DB.prepare(
      `select s.rowid as id from article_search s join articles a on a.id = s.rowid
       where article_search match ? and ${liveArticle()}${yearFilter(year)}
       order by bm25(article_search, ${WEIGHTS}) limit ?`,
    )
      .bind(ftsQuery(stems), FTS_LIMIT)
      .all();
    return (rows.results ?? []).map((row) => Number(row.id));
  } catch {
    return [];
  }
}

// Reciprocal rank fusion: zpráva vysoko v obou seznamech jde nahoru, pořadí stačí, skóre se nesrovnávají.
export function mergeRanks(lists, k = 60) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((id, index) => score.set(id, (score.get(id) ?? 0) + 1 / (k + index + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

async function articleRows(env, ids, year) {
  if (!ids.length) return new Map();
  const rows = await env.DB.prepare(
    `select a.id, a.slug, a.title, a.excerpt, a.keywords, a.created_at, coalesce(r.name, a.category) as rubric
     from articles a left join rubrics r on r.id = a.rubric_id
     where a.id in (${ids.map(() => "?").join(", ")}) and ${liveArticle()}${yearFilter(year)}`,
  )
    .bind(...ids)
    .all();
  return new Map(
    (rows.results ?? []).map((row) => [
      Number(row.id),
      {
        id: Number(row.id),
        slug: String(row.slug),
        title: String(row.title),
        excerpt: String(row.excerpt),
        keywords: shownKeywords(row.keywords),
        createdOn: String(row.created_at ?? "").slice(0, 10),
        rubric: String(row.rubric ?? ""),
      },
    ]),
  );
}

// query: o čem, pár slov nebo věta (jde do obou hledání); words: další tvary a synonyma jen pro fulltext;
// about: delší text jen pro hledání podle významu (jinak query); year: jen zprávy z toho roku;
// skip: id zpráv, které hledající už zná.
export async function searchNews(env, { query = "", words = [], about = "", year = null, limit = 8, skip = [] } = {}) {
  const stems = searchStems([query, ...words].join(" "));
  const meaning = String(about || query).trim();
  if (!stems.length && !meaning) return [];
  // Nové a upravené zprávy dostanou fulltext hned, ne až v cronu.
  await indexText(env).catch(() => 0);
  const [text, near] = await Promise.all([textHits(env, stems, year), meaning ? nearestArticles(env, meaning) : []]);
  const known = new Set(skip.map(Number));
  const ids = mergeRanks([text, near.map((hit) => hit.id)]).filter((id) => !known.has(id));
  // Otisky neznají rok ani to, co je na webu: z kandidátů se vezme víc a profiltruje se v D1.
  const rows = await articleRows(env, ids.slice(0, limit * 3), year);
  return ids.map((id) => rows.get(id)).filter(Boolean).slice(0, limit);
}
