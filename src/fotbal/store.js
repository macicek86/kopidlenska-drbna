// Fotbal v D1: nastavení, zapamatované aktuality z webu klubu a zámek, ať neběží dva průchody naráz.
import { countQueued, lockHeld, lockRow, markManual, queuedWhere, readFreshDays, unlockRow } from "../background.js";
import { addColumn, asBool, clip, requireChief, sqliteStamp } from "../db-core.js";
import { DEFAULT_CLUB_URL, readClubUrl } from "./club.js";
import { DEFAULT_TRUTH_URL, readTruthUrl } from "./fotbalunas.js";
import { FIXTURE_TABLES } from "./fixtures-db.js";

export const DEFAULT_FRESH_DAYS = 7;
export const INTERVALS = [
  [24, "Jednou denně"],
  [12, "Dvakrát denně"],
  [4, "Každé čtyři hodiny"],
];

export const FOOTBALL_TABLES = [
  `create table if not exists football_settings (
    id integer primary key,
    enabled integer not null default 0,
    club_url text not null default '',
    auto_publish integer not null default 0,
    voice text not null default '', -- dřív povaha Drběny, teď je v drbena_settings
    rubric_id integer,
    previews integer not null default 1,
    club_news integer not null default 0,
    use_crest integer not null default 1,
    interval_hours integer not null default 24,
    fresh_days integer not null default 7,
    crest_url text not null default '',
    crest_key text not null default '',
    checked_at text,
    status text not null default '',
    note text not null default '',
    running_at text
  )`,
  `create table if not exists football_items (
    id integer primary key autoincrement,
    guid text not null unique,
    kind text not null,
    link text not null default '',
    title text not null,
    text text not null default '',
    extra text not null default '',
    images text not null default '[]',
    cover text not null default '',
    published_on text not null default '',
    status text not null default 'nove',
    reason text not null default '',
    duplicate_of text not null default '',
    article_id integer,
    proposal_id integer,
    manual integer not null default 0,
    attempts integer not null default 0,
    created_at text not null default (datetime('now')),
    processed_at text
  )`,
];

// Při prvním spuštění založí podrubriku Fotbal pod Sportem a nastaví ji jako cíl.
async function seedRubric(env) {
  const sport = await env.DB.prepare("select id from rubrics where slug = 'sport' and parent_id is null").first();
  let rubric = await env.DB.prepare("select id from rubrics where slug = 'fotbal'").first();
  if (!rubric && sport) {
    await env.DB.prepare("insert into rubrics (parent_id, name, slug, sort_order) values (?, 'Fotbal', 'fotbal', 10)").bind(sport.id).run();
    rubric = await env.DB.prepare("select id from rubrics where slug = 'fotbal'").first();
  }
  const target = rubric ?? sport;
  if (target) await env.DB.prepare("update football_settings set rubric_id = ? where id = 1").bind(target.id).run();
}

export async function ensureFootballTables(env) {
  for (const sql of [...FOOTBALL_TABLES, ...FIXTURE_TABLES]) await env.DB.prepare(sql).run();
  const info = await env.DB.prepare("pragma table_info(football_items)").all();
  await addColumn(env, new Set((info.results ?? []).map((row) => row.name)), "manual", "alter table football_items add column manual integer not null default 0");
  const settingsInfo = await env.DB.prepare("pragma table_info(football_settings)").all();
  const settingsColumns = new Set((settingsInfo.results ?? []).map((row) => row.name));
  await addColumn(env, settingsColumns, "fresh_days", "alter table football_settings add column fresh_days integer not null default 7");
  // Bez hodnoty (null) platí výchozí klub na fotbalunas.cz, prázdný text znamená neověřovat.
  await addColumn(env, settingsColumns, "truth_url", "alter table football_settings add column truth_url text");
  const created = await env.DB.prepare(
    "insert into football_settings (id) select 1 where not exists (select 1 from football_settings where id = 1)",
  ).run();
  const rubrics = await env.DB.prepare("select 1 as ok from sqlite_master where type = 'table' and name = 'rubrics'").first();
  if (Number(created?.meta?.changes ?? 0) > 0 && rubrics) await seedRubric(env);
}

function mapSettings(row) {
  const interval = Number(row?.interval_hours ?? 24);
  return {
    enabled: asBool(row?.enabled),
    clubUrl: String(row?.club_url ?? "") || DEFAULT_CLUB_URL,
    truthUrl: row?.truth_url == null ? DEFAULT_TRUTH_URL : String(row.truth_url),
    autoPublish: asBool(row?.auto_publish),
    rubricId: row?.rubric_id == null ? null : Number(row.rubric_id),
    previews: row ? asBool(row.previews) : true,
    clubNews: asBool(row?.club_news),
    useCrest: row ? asBool(row.use_crest) : true,
    intervalHours: INTERVALS.some(([hours]) => hours === interval) ? interval : 24,
    freshDays: readFreshDays(row?.fresh_days, DEFAULT_FRESH_DAYS),
    crestUrl: String(row?.crest_url ?? ""),
    crestKey: String(row?.crest_key ?? ""),
    checkedAt: row?.checked_at ? String(row.checked_at) : "",
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    runningAt: String(row?.running_at ?? ""),
  };
}

export async function loadFootballSettings(env) {
  const row = await env.DB.prepare(
    `select enabled, club_url, auto_publish, rubric_id, previews, club_news, use_crest, interval_hours, fresh_days, truth_url, crest_url, crest_key,
       checked_at, status, note, running_at from football_settings where id = 1`,
  ).first();
  return mapSettings(row);
}

function parseImages(text) {
  try {
    const list = JSON.parse(text || "[]");
    return Array.isArray(list) ? list.filter((url) => typeof url === "string") : [];
  } catch {
    return [];
  }
}

export function mapFootballItem(row) {
  return {
    id: Number(row.id),
    guid: String(row.guid),
    kind: String(row.kind),
    link: String(row.link ?? ""),
    title: String(row.title),
    text: String(row.text ?? ""),
    extra: String(row.extra ?? ""),
    images: parseImages(row.images),
    cover: String(row.cover ?? ""),
    publishedOn: String(row.published_on ?? ""),
    status: String(row.status),
    reason: String(row.reason ?? ""),
    duplicateOf: String(row.duplicate_of ?? ""),
    articleId: row.article_id == null ? null : Number(row.article_id),
    proposalId: row.proposal_id == null ? null : Number(row.proposal_id),
    manual: asBool(row.manual),
    attempts: Number(row.attempts ?? 0),
    processedAt: row.processed_at ? String(row.processed_at) : "",
    fetchedAt: sqliteStamp(row.created_at),
  };
}

const ITEM_FIELDS =
  "id, guid, kind, link, title, text, extra, images, cover, published_on, status, reason, duplicate_of, article_id, proposal_id, manual, attempts, processed_at, created_at";

export async function loadFootballItems(env, limit = 40) {
  const rows = await env.DB.prepare(`select ${ITEM_FIELDS} from football_items order by id desc limit ?`).bind(limit).all();
  return (rows.results ?? []).map(mapFootballItem);
}

export async function loadFootballItem(env, id) {
  const row = await env.DB.prepare(`select ${ITEM_FIELDS} from football_items where id = ?`).bind(id).first();
  return row ? mapFootballItem(row) : null;
}

export async function waitingFootballItems(env, limit, maxAttempts, { manualOnly = false } = {}) {
  const rows = await env.DB.prepare(
    `select ${ITEM_FIELDS} from football_items where ${queuedWhere(manualOnly)}
     order by manual desc, published_on asc, id asc limit ?`,
  )
    .bind(maxAttempts, limit)
    .all();
  return (rows.results ?? []).map(mapFootballItem);
}

export const countWaiting = (env, maxAttempts, options) => countQueued(env, "football_items", maxAttempts, options);
export const selectFootballItems = (env, ids) => markManual(env, "football_items", ids);

// Které klíče už drbna zná, ať zbytečně nestahuje detail aktuality znovu.
export async function knownGuids(env, guids) {
  if (!guids.length) return new Set();
  const marks = guids.map(() => "?").join(", ");
  const rows = await env.DB.prepare(`select guid from football_items where guid in (${marks})`).bind(...guids).all();
  return new Set((rows.results ?? []).map((row) => String(row.guid)));
}

// Nová aktualita do fronty. Vrací true, když tam ještě nebyla.
export async function rememberFootballItem(env, entry, { status = "nove", reason = "" } = {}) {
  const result = await env.DB.prepare(
    `insert or ignore into football_items (guid, kind, link, title, text, extra, images, cover, published_on, status, reason)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      entry.guid,
      entry.kind,
      entry.link,
      clip(entry.title, 300),
      clip(entry.text, 12000),
      clip(entry.extra, 6000),
      JSON.stringify(entry.images ?? []),
      entry.cover ?? "",
      entry.publishedOn,
      status,
      reason,
    )
    .run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function finishFootballItem(env, id, fields) {
  await env.DB.prepare(
    `update football_items set status = ?, reason = ?, duplicate_of = ?, article_id = ?, proposal_id = ?,
       attempts = attempts + 1, processed_at = datetime('now') where id = ?`,
  )
    .bind(fields.status, clip(fields.reason, 400), fields.duplicateOf ?? "", fields.articleId ?? null, fields.proposalId ?? null, id)
    .run();
}

// `checked` jen když se opravdu díval na web klubu. Samotné dopsání fronty dobu poslední kontroly nemění.
export async function writeFootballStatus(env, { status, note, checked = true }) {
  const sql = checked
    ? "update football_settings set checked_at = ?, status = ?, note = ? where id = 1"
    : "update football_settings set status = ?, note = ? where id = 1";
  const binds = checked ? [new Date().toISOString(), status, clip(note, 400)] : [status, clip(note, 400)];
  await env.DB.prepare(sql).bind(...binds).run();
}

export async function saveCrest(env, url, key) {
  await env.DB.prepare("update football_settings set crest_url = ?, crest_key = ? where id = 1").bind(url, key).run();
}


export const lockFootball = (env, seconds) => lockRow(env, "football_settings", seconds);
export const unlockFootball = (env, token) => unlockRow(env, "football_settings", token);

export function footballRunning(settings, now = new Date()) {
  return lockHeld(settings.runningAt, now);
}

// Cron běží každé čtyři hodiny. Fotbal se podívá, až od minulé kontroly uběhne nastavená doba (s hodinkou rezervy).
// Po chybě to zkusí hned při dalším běhu.
export function footballDue(settings, now = new Date()) {
  if (!settings.enabled) return false;
  const last = Date.parse(settings.checkedAt);
  if (!Number.isFinite(last) || settings.status === "error") return true;
  return now.getTime() - last >= (settings.intervalHours - 1) * 60 * 60 * 1000;
}

export async function saveFootballSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const clubUrl = readClubUrl(input.clubUrl);
  if (!clubUrl) return { ok: false, error: "Adresa webu klubu musí začínat https://." };
  const truth = readTruthUrl(input.truthUrl);
  if (!truth.ok) return truth;
  const rubricId = Number(input.rubricId);
  const rubric = Number.isInteger(rubricId) ? await env.DB.prepare("select id from rubrics where id = ?").bind(rubricId).first() : null;
  if (!rubric) return { ok: false, error: "Vyberte rubriku." };
  const interval = Number(input.intervalHours);
  await env.DB.prepare(
    `update football_settings set enabled = ?, club_url = ?, auto_publish = ?, rubric_id = ?, previews = ?, club_news = ?, use_crest = ?,
       interval_hours = ?, fresh_days = ?, truth_url = ? where id = 1`,
  )
    .bind(
      input.enabled ? 1 : 0,
      clubUrl,
      input.autoPublish ? 1 : 0,
      rubric.id,
      input.previews ? 1 : 0,
      input.clubNews ? 1 : 0,
      input.useCrest ? 1 : 0,
      INTERVALS.some(([hours]) => hours === interval) ? interval : 24,
      readFreshDays(input.freshDays, DEFAULT_FRESH_DAYS),
      truth.url,
    )
    .run();
  return { ok: true };
}
