// Společné kousky importů zpráv (Munipolis, Deník, školy): co už na drbně je, rubriky, datum ze zdroje a souhrn průchodu.
import { loadDoctors } from "./db.js";
import { loadNotices } from "./notices-db.js";
import { knownClosures } from "./ndic/store.js";
import { shownKeywords } from "./keywords.js";
import { loadPlaces } from "./places-db.js";
import { addDays, pragueNow } from "./waste.js";

const LOOKBACK_DAYS = 60;
// Starší zprávy už jen s nadpisem a klíčovými slovy, ať Drběna nepíše znovu o věci z jara.
const OLDER_DAYS = 365;
const OLDER_LIMIT = 80;

export function outcomeOf(item) {
  if (item.status === "hotovo") {
    const made = [
      item.articleId && `zprava:${item.articleId}`,
      item.proposalId && `navrh:${item.proposalId}`,
      item.eventId && `akce:${item.eventId}`,
      item.noticeId && `odstavka:${item.noticeId}`,
      ...(item.hoursIds ?? []),
    ].filter(Boolean);
    return `zpracováno (${made.join(", ") || "nic"})`;
  }
  if (item.status === "duplicita") return `duplicita s ${item.duplicateOf || "něčím na webu"}`;
  if (item.status === "preskoceno") return "přeskočeno";
  return "";
}

export function splitRefs(text) {
  return String(text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function rows(env, sql, ...binds) {
  const statement = env.DB.prepare(sql);
  const result = await (binds.length ? statement.bind(...binds) : statement).all();
  return result.results ?? [];
}

// Tabulky importů, které se ukazují Claudovi jako dřívější převzaté zprávy. Značka je to, co vrací v duplicate_of.
export const IMPORT_SOURCES = [
  { table: "import_items", tag: "munipolis" },
  { table: "denik_items", tag: "denik" },
  { table: "skola_items", tag: "skola" },
  { table: "zahradka_items", tag: "zahradka" },
];

async function pastImports(env, { table, tag }, itemTable, itemId, since) {
  const exists = await env.DB.prepare("select 1 as ok from sqlite_master where type = 'table' and name = ?").bind(table).first();
  if (!exists) return [];
  const list = await rows(
    env,
    `select id, title, published_at, status, duplicate_of, article_id, proposal_id, event_id, notice_id,
       ${table === "import_items" ? "hours_ids" : "'' as hours_ids"} from ${table}
     where id != ? and status in ('hotovo', 'duplicita', 'preskoceno') and published_at >= ? order by published_at desc limit 40`,
    table === itemTable ? itemId : 0,
    since,
  );
  return list.map((row) => ({
    id: row.id,
    tag,
    title: row.title,
    publishedOn: String(row.published_at).slice(0, 10),
    outcome: outcomeOf({
      status: row.status,
      duplicateOf: row.duplicate_of,
      articleId: row.article_id,
      proposalId: row.proposal_id,
      eventId: row.event_id,
      noticeId: row.notice_id,
      hoursIds: splitRefs(row.hours_ids),
    }),
  }));
}

// Kolikrát už na zprávu navázala jiná zpráva nebo čekající návrh (doplnění od Drběny).
const FOLLOWUPS = `(select count(*) from articles f where f.follows_id = a.id)
  + (select count(*) from proposals fp where fp.follows_id = a.id and fp.status = 'pending')`;

function shapeArticle(row) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    keywords: shownKeywords(row.keywords),
    followsId: row.follows_id == null ? null : Number(row.follows_id),
    followups: Number(row.followups ?? 0),
    createdOn: String(row.created_at).slice(0, 10),
  };
}

// Zprávy a čekající návrhy pro přehled. Sdílí ho i fotbal.
export async function knownArticles(env, today) {
  const since = addDays(today, -LOOKBACK_DAYS);
  const articles = await rows(
    env,
    `select a.id, a.title, a.excerpt, a.keywords, a.follows_id, a.created_at, ${FOLLOWUPS} as followups
     from articles a where a.created_at >= ? order by a.created_at desc, a.id desc limit 60`,
    since,
  );
  const older = await rows(
    env,
    `select a.id, a.title, '' as excerpt, a.keywords, a.follows_id, a.created_at, ${FOLLOWUPS} as followups
     from articles a where a.created_at < ? and a.created_at >= ? and a.keywords not in ('', '-')
     order by a.created_at desc, a.id desc limit ?`,
    since,
    addDays(today, -OLDER_DAYS),
    OLDER_LIMIT,
  );
  const proposals = await rows(
    env,
    "select id, title, excerpt, keywords, follows_id, created_at from proposals where status = 'pending' order by id desc limit 30",
  );
  return { articles: articles.map(shapeArticle), older: older.map(shapeArticle), proposals: proposals.map(shapeArticle) };
}

// Co už na drbně je, aby Claude poznal stejnou věc od někoho jiného. `table` je tabulka zpracovávané položky,
// `closureRef` uzavírka z NDIC, kterou zrovna zpracovává Drběna (sama sebe v přehledu mít nesmí).
export async function knownContent(env, { itemId, today, table = "import_items", closureRef = 0 }) {
  const since = addDays(today, -LOOKBACK_DAYS);
  const { articles, older, proposals } = await knownArticles(env, today);
  const events = await rows(
    env,
    "select id, title, place, starts_on, starts_time from events where starts_on >= ? order by starts_on asc limit 60",
    addDays(today, -30),
  );
  const notices = (await loadNotices(env)).filter((row) => (row.endsOn || row.startsOn) >= addDays(today, -30));
  const imports = [];
  for (const source of IMPORT_SOURCES) imports.push(...(await pastImports(env, source, table, itemId, since)));
  return {
    articles,
    older,
    proposals,
    events: events.map((row) => ({ id: row.id, title: row.title, place: row.place, startsOn: row.starts_on, startsTime: row.starts_time })),
    notices,
    closures: (await knownClosures(env)).filter((row) => row.ref !== closureRef),
    imports,
    places: await loadPlaces(env, { today }),
    doctors: await loadDoctors(env, { today }),
  };
}

export async function rubricMap(env) {
  const list = await rows(env, "select id, name, slug from rubrics order by sort_order asc, id asc");
  return new Map(list.map((row) => [String(row.slug), { id: Number(row.id), name: String(row.name) }]));
}

// Datum zveřejnění ve zdroji jako pražský den, nebo prázdné (pak dnešek).
export function importSourceDate(item, today) {
  const parsed = Date.parse(item.publishedAt);
  if (!Number.isFinite(parsed)) return "";
  const day = pragueNow(new Date(parsed)).date;
  return day <= today ? day : "";
}

export function importSummary(results, added, waiting) {
  const done = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const parts = [];
  if (added) parts.push(`Nových zpráv: ${added}.`);
  if (done) parts.push(`Zpracováno: ${done}.`);
  if (failed.length) parts.push(`Nepovedlo se: ${failed.length} (${failed[0].error})`);
  if (waiting) parts.push(`Na zpracování čeká ještě ${waiting}.`);
  if (!parts.length) parts.push("Nic nového.");
  return { status: failed.length ? (done ? "partial" : "error") : "ok", note: parts.join(" ") };
}
