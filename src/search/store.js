// Index zpráv pro hledání v celém archivu: fulltext (FTS5 v D1) a otisky významu (Vectorize, src/search/vectors.js).
// Spouště na tabulce articles zapíšou každou novou, upravenou či smazanou zprávu do fronty search_queue.
// Frontu projde syncSearch: nejdřív fulltext (rychlý, jde i při hledání), pak otisky (cron).
// Fulltext bere všechny zprávy, co je na webu (liveArticle), se řeší až při hledání.
import { htmlText } from "../chat/prompt.js";
import { shownKeywords } from "../keywords.js";
import { embedTexts, hasVectors } from "./vectors.js";

export const SEARCH_TABLES = [
  `create table if not exists search_queue (
    article_id integer primary key,
    fts integer not null default 0
  )`,
  "create trigger if not exists articles_search_insert after insert on articles begin insert or replace into search_queue (article_id, fts) values (new.id, 0); end",
  "create trigger if not exists articles_search_update after update of title, excerpt, body, keywords on articles begin insert or replace into search_queue (article_id, fts) values (new.id, 0); end",
  "create trigger if not exists articles_search_delete after delete on articles begin insert or replace into search_queue (article_id, fts) values (old.id, 0); end",
];

const FTS_TABLE =
  "create virtual table if not exists article_search using fts5(title, excerpt, keywords, body, tokenize = 'unicode61 remove_diacritics 2')";

// Volá se, až tabulka articles existuje. Při prvním založení indexu jdou do fronty všechny zprávy.
export async function ensureSearchTables(env) {
  const exists = await env.DB.prepare("select 1 as ok from sqlite_master where name = 'article_search'").first();
  await env.DB.prepare(FTS_TABLE).run();
  for (const sql of SEARCH_TABLES) await env.DB.prepare(sql).run();
  if (!exists) await env.DB.prepare("insert or ignore into search_queue (article_id) select id from articles").run();
}

// Otisk dostane začátek zprávy: nadpis, perex, klíčová slova a první odstavce stačí na to, o čem je.
const EMBED_CHARS = 2000;

export function embedText(row) {
  const parts = [row.title, row.excerpt, shownKeywords(row.keywords), htmlText(String(row.body ?? ""))];
  return parts.filter(Boolean).join("\n").slice(0, EMBED_CHARS);
}

async function queued(env, { fts, limit }) {
  const rows = await env.DB.prepare(
    `select q.article_id as id, a.id as present, a.title, a.excerpt, a.keywords, a.body
     from search_queue q left join articles a on a.id = q.article_id
     where q.fts = ? order by q.article_id desc limit ?`,
  )
    .bind(fts, limit)
    .all();
  return rows.results ?? [];
}

// Fulltext pro zprávy ve frontě. Bez otisků (místně, bez Vectorize) se fronta rovnou vyprázdní.
export async function indexText(env, limit = 50) {
  const rows = await queued(env, { fts: 0, limit });
  if (!rows.length) return 0;
  const vectors = hasVectors(env);
  const statements = [];
  for (const row of rows) {
    statements.push(env.DB.prepare("delete from article_search where rowid = ?").bind(row.id));
    if (row.present) {
      statements.push(
        env.DB.prepare("insert into article_search (rowid, title, excerpt, keywords, body) values (?, ?, ?, ?, ?)").bind(
          row.id,
          String(row.title ?? ""),
          String(row.excerpt ?? ""),
          shownKeywords(row.keywords),
          htmlText(String(row.body ?? "")),
        ),
      );
    }
    statements.push(
      vectors
        ? env.DB.prepare("update search_queue set fts = 1 where article_id = ?").bind(row.id)
        : env.DB.prepare("delete from search_queue where article_id = ?").bind(row.id),
    );
  }
  await env.DB.batch(statements);
  return rows.length;
}

const EMBED_BATCH = 20;

// Otisky významu pro zprávy, které už mají fulltext. Když Workers AI nebo Vectorize selže, zůstanou ve frontě na příště.
export async function indexVectors(env, limit = 200) {
  if (!hasVectors(env)) return 0;
  let done = 0;
  while (done < limit) {
    const rows = await queued(env, { fts: 1, limit: Math.min(EMBED_BATCH, limit - done) });
    if (!rows.length) break;
    const present = rows.filter((row) => row.present);
    const gone = rows.filter((row) => !row.present).map((row) => String(row.id));
    if (present.length) {
      const values = await embedTexts(env, present.map(embedText));
      await env.VECTORS.upsert(present.map((row, i) => ({ id: String(row.id), values: values[i] })));
    }
    if (gone.length) await env.VECTORS.deleteByIds(gone);
    // Zpráva upravená mezitím má ve frontě zase fts = 0 a musí tam zůstat.
    await env.DB.batch(rows.map((row) => env.DB.prepare("delete from search_queue where article_id = ? and fts = 1").bind(row.id)));
    done += rows.length;
    if (rows.length < EMBED_BATCH) break;
  }
  return done;
}

// Cron: dožene frontu. Při prvním spuštění projde celý archiv po částech.
export async function syncSearch(env) {
  let text = 0;
  for (let round = 0; round < 20; round += 1) {
    const step = await indexText(env, 100);
    text += step;
    if (step < 100) break;
  }
  const vectors = await indexVectors(env, 400);
  return { ok: true, text, vectors };
}
