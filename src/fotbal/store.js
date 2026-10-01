// Fotbal v D1: nastavení, zapamatované aktuality z webu klubu a zámek, ať neběží dva průchody naráz.
import { asBool, clip, requireChief } from "../db-core.js";
import { DEFAULT_CLUB_URL, readClubUrl } from "./club.js";

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
    voice text not null default '',
    rubric_id integer,
    previews integer not null default 1,
    club_news integer not null default 0,
    use_crest integer not null default 1,
    interval_hours integer not null default 24,
    since text not null default '',
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
  for (const sql of FOOTBALL_TABLES) await env.DB.prepare(sql).run();
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
    autoPublish: asBool(row?.auto_publish),
    voice: String(row?.voice ?? ""),
    rubricId: row?.rubric_id == null ? null : Number(row.rubric_id),
    previews: row ? asBool(row.previews) : true,
    clubNews: asBool(row?.club_news),
    useCrest: row ? asBool(row.use_crest) : true,
    intervalHours: INTERVALS.some(([hours]) => hours === interval) ? interval : 24,
    since: String(row?.since ?? ""),
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
    `select enabled, club_url, auto_publish, voice, rubric_id, previews, club_news, use_crest, interval_hours, since, crest_url, crest_key,
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
    attempts: Number(row.attempts ?? 0),
    processedAt: row.processed_at ? String(row.processed_at) : "",
  };
}

const ITEM_FIELDS =
  "id, guid, kind, link, title, text, extra, images, cover, published_on, status, reason, duplicate_of, article_id, proposal_id, attempts, processed_at";

export async function loadFootballItems(env, limit = 40) {
  const rows = await env.DB.prepare(`select ${ITEM_FIELDS} from football_items order by id desc limit ?`).bind(limit).all();
  return (rows.results ?? []).map(mapFootballItem);
}

export async function loadFootballItem(env, id) {
  const row = await env.DB.prepare(`select ${ITEM_FIELDS} from football_items where id = ?`).bind(id).first();
  return row ? mapFootballItem(row) : null;
}

export async function waitingFootballItems(env, limit, maxAttempts) {
  const rows = await env.DB.prepare(
    `select ${ITEM_FIELDS} from football_items
     where status = 'nove' or (status = 'chyba' and attempts < ?)
     order by published_on asc, id asc limit ?`,
  )
    .bind(maxAttempts, limit)
    .all();
  return (rows.results ?? []).map(mapFootballItem);
}

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

export async function countWaiting(env, maxAttempts) {
  const row = await env.DB.prepare(
    "select count(*) as n from football_items where status = 'nove' or (status = 'chyba' and attempts < ?)",
  )
    .bind(maxAttempts)
    .first();
  return Number(row?.n ?? 0);
}

// Zámek nese čas, kdy sám vyprší. Když Worker uprostřed práce skončí, nezůstane fotbal zamčený dlouho.
export async function lockFootball(env, seconds) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();
  const token = `${until}-${crypto.randomUUID()}`;
  const result = await env.DB.prepare(
    "update football_settings set running_at = ? where id = 1 and (running_at is null or running_at = '' or running_at < ?)",
  )
    .bind(token, now.toISOString())
    .run();
  return Number(result?.meta?.changes ?? 0) > 0 ? token : "";
}

export async function unlockFootball(env, token) {
  if (!token) return;
  await env.DB.prepare("update football_settings set running_at = null where id = 1 and running_at = ?").bind(token).run();
}

export function footballRunning(settings, now = new Date()) {
  return Boolean(settings.runningAt) && settings.runningAt > now.toISOString();
}

// Cron běží každé čtyři hodiny. Fotbal se podívá, až od minulé kontroly uběhne nastavená doba (s hodinkou rezervy).
// Po chybě to zkusí hned při dalším běhu.
export function footballDue(settings, now = new Date()) {
  if (!settings.enabled) return false;
  const last = Date.parse(settings.checkedAt);
  if (!Number.isFinite(last) || settings.status === "error") return true;
  return now.getTime() - last >= (settings.intervalHours - 1) * 60 * 60 * 1000;
}

// Při prvním zapnutí vezme jen aktuality z posledního týdne, ať nezahltí redakci archivem.
export function footballSince(previous, enabled, today) {
  if (previous || !enabled) return previous;
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export async function saveFootballSettings(env, request, input, today) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const clubUrl = readClubUrl(input.clubUrl);
  if (!clubUrl) return { ok: false, error: "Adresa webu klubu musí začínat https://." };
  const rubricId = Number(input.rubricId);
  const rubric = Number.isInteger(rubricId) ? await env.DB.prepare("select id from rubrics where id = ?").bind(rubricId).first() : null;
  if (!rubric) return { ok: false, error: "Vyberte rubriku." };
  const interval = Number(input.intervalHours);
  const current = await loadFootballSettings(env);
  await env.DB.prepare(
    `update football_settings set enabled = ?, club_url = ?, auto_publish = ?, voice = ?, rubric_id = ?, previews = ?, club_news = ?, use_crest = ?,
       interval_hours = ?, since = ? where id = 1`,
  )
    .bind(
      input.enabled ? 1 : 0,
      clubUrl,
      input.autoPublish ? 1 : 0,
      clip(input.voice, 3000),
      rubric.id,
      input.previews ? 1 : 0,
      input.clubNews ? 1 : 0,
      input.useCrest ? 1 : 0,
      INTERVALS.some(([hours]) => hours === interval) ? interval : 24,
      footballSince(current.since, input.enabled, today),
    )
    .run();
  return { ok: true };
}
