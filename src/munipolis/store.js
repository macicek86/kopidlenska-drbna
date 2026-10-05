// Import z Munipolisu v D1: nastavení, zapamatované zprávy a autorka Koza Drběna.
import { countQueued, lockHeld, lockRow, markManual, queuedWhere, readFreshDays, STALE_REASON, unlockRow } from "../background.js";
import { addColumn, asBool, clip, requireChief, sqliteStamp } from "../db-core.js";
import { splitRefs } from "../import-context.js";
import { DEFAULT_FEED_URL, readFeedUrl } from "./feed.js";

export const BOT_LOGIN = "drbena";
export const BOT_NAME = "Koza Drběna";
export const STATUS = {
  nacteno: "Načteno, čeká na výběr",
  nove: "Čeká na zpracování",
  stare: "Starší, čeká na výběr",
  hotovo: "Zpracováno",
  preskoceno: "Přeskočeno",
  duplicita: "Duplicita",
  chyba: "Chyba",
  smazano: "Zpráva smazaná",
};
export const MAX_ATTEMPTS = 3;
export const DEFAULT_FRESH_DAYS = 3;

export const IMPORT_TABLES = [
  `create table if not exists import_settings (
    id integer primary key,
    enabled integer not null default 0,
    feed_url text not null default '',
    auto_publish integer not null default 0,
    voice text not null default '', -- dřív povaha Drběny, teď je v drbena_settings
    fresh_days integer not null default 3,
    checked_at text,
    status text not null default '',
    note text not null default '',
    running_at text
  )`,
  `create table if not exists import_items (
    id integer primary key autoincrement,
    guid text not null unique,
    link text not null default '',
    title text not null,
    text text not null default '',
    images text not null default '[]',
    published_at text not null default '',
    status text not null default 'nove',
    reason text not null default '',
    duplicate_of text not null default '',
    article_id integer,
    proposal_id integer,
    event_id integer,
    notice_id integer,
    hours_ids text not null default '',
    manual integer not null default 0,
    attempts integer not null default 0,
    created_at text not null default (datetime('now')),
    processed_at text
  )`,
];

export async function ensureImportTables(env) {
  for (const sql of IMPORT_TABLES) await env.DB.prepare(sql).run();
  const info = await env.DB.prepare("pragma table_info(import_items)").all();
  const columns = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, columns, "manual", "alter table import_items add column manual integer not null default 0");
  await addColumn(env, columns, "hours_ids", "alter table import_items add column hours_ids text not null default ''");
  const settingsInfo = await env.DB.prepare("pragma table_info(import_settings)").all();
  await addColumn(
    env,
    new Set((settingsInfo.results ?? []).map((row) => row.name)),
    "fresh_days",
    "alter table import_settings add column fresh_days integer not null default 3",
  );
  await env.DB.prepare("insert into import_settings (id) select 1 where not exists (select 1 from import_settings where id = 1)").run();
}

function mapSettings(row) {
  return {
    enabled: asBool(row?.enabled),
    feedUrl: String(row?.feed_url ?? "") || DEFAULT_FEED_URL,
    autoPublish: asBool(row?.auto_publish),
    freshDays: readFreshDays(row?.fresh_days, DEFAULT_FRESH_DAYS),
    checkedAt: row?.checked_at ? String(row.checked_at) : "",
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    runningAt: String(row?.running_at ?? ""),
  };
}

export async function loadImportSettings(env) {
  const row = await env.DB.prepare(
    "select enabled, feed_url, auto_publish, fresh_days, checked_at, status, note, running_at from import_settings where id = 1",
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

export function mapImportItem(row) {
  return {
    id: Number(row.id),
    guid: String(row.guid),
    link: String(row.link ?? ""),
    title: String(row.title),
    text: String(row.text ?? ""),
    images: parseImages(row.images),
    publishedAt: String(row.published_at ?? ""),
    status: String(row.status),
    reason: String(row.reason ?? ""),
    duplicateOf: String(row.duplicate_of ?? ""),
    articleId: row.article_id == null ? null : Number(row.article_id),
    proposalId: row.proposal_id == null ? null : Number(row.proposal_id),
    eventId: row.event_id == null ? null : Number(row.event_id),
    noticeId: row.notice_id == null ? null : Number(row.notice_id),
    hoursIds: splitRefs(row.hours_ids),
    manual: asBool(row.manual),
    attempts: Number(row.attempts ?? 0),
    processedAt: row.processed_at ? String(row.processed_at) : "",
    fetchedAt: sqliteStamp(row.created_at),
  };
}

const ITEM_FIELDS =
  "id, guid, link, title, text, images, published_at, status, reason, duplicate_of, article_id, proposal_id, event_id, notice_id, hours_ids, manual, attempts, processed_at, created_at";

export async function loadImportItems(env, limit = 40) {
  const rows = await env.DB.prepare(`select ${ITEM_FIELDS} from import_items order by published_at desc, id desc limit ?`)
    .bind(limit)
    .all();
  return (rows.results ?? []).map(mapImportItem);
}

export async function loadImportItem(env, id) {
  const row = await env.DB.prepare(`select ${ITEM_FIELDS} from import_items where id = ?`).bind(id).first();
  return row ? mapImportItem(row) : null;
}

export async function waitingItems(env, limit, { manualOnly = false } = {}) {
  const rows = await env.DB.prepare(
    `select ${ITEM_FIELDS} from import_items where ${queuedWhere(manualOnly)}
     order by manual desc, published_at asc, id asc limit ?`,
  )
    .bind(MAX_ATTEMPTS, limit)
    .all();
  return (rows.results ?? []).map(mapImportItem);
}

export const countWaitingItems = (env, options) => countQueued(env, "import_items", MAX_ATTEMPTS, options);
export const selectImportItems = (env, ids) => markManual(env, "import_items", ids);

// Nové zprávy z kanálu si zapamatuje. Starší (`isOld`) jen odloží stranou.
// Při ručním načtení počkají všechny, až redakce vybere, které zpracovat.
export async function rememberItems(env, items, { manual = false, isOld = () => false } = {}) {
  let added = 0;
  for (const item of items) {
    const status = manual ? "nacteno" : isOld(item) ? "stare" : "nove";
    const result = await env.DB.prepare(
      `insert or ignore into import_items (guid, link, title, text, images, published_at, status, reason)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(item.guid, item.link, item.title, item.text, JSON.stringify(item.images), item.publishedAt, status, status === "stare" ? STALE_REASON : "")
      .run();
    if (Number(result?.meta?.changes ?? 0) > 0 && status !== "stare") added += 1;
  }
  return added;
}

export async function finishItem(env, id, fields) {
  await env.DB.prepare(
    `update import_items set status = ?, reason = ?, duplicate_of = ?, article_id = ?, proposal_id = ?, event_id = ?, notice_id = ?,
       hours_ids = ?, attempts = attempts + 1, processed_at = datetime('now') where id = ?`,
  )
    .bind(
      fields.status,
      clip(fields.reason, 400),
      fields.duplicateOf ?? "",
      fields.articleId ?? null,
      fields.proposalId ?? null,
      fields.eventId ?? null,
      fields.noticeId ?? null,
      (fields.hoursIds ?? []).join(","),
      id,
    )
    .run();
}

export async function writeImportStatus(env, { status, note }) {
  await env.DB.prepare("update import_settings set checked_at = ?, status = ?, note = ? where id = 1")
    .bind(new Date().toISOString(), status, clip(note, 400))
    .run();
}

export const lockImport = (env, seconds) => lockRow(env, "import_settings", seconds);
export const unlockImport = (env, token) => unlockRow(env, "import_settings", token);

export function importRunning(settings, now = new Date()) {
  return lockHeld(settings.runningAt, now);
}


export async function saveImportSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const feedUrl = readFeedUrl(input.feedUrl);
  if (!feedUrl) return { ok: false, error: "Adresa RSS musí začínat https://." };
  await env.DB.prepare("update import_settings set enabled = ?, feed_url = ?, auto_publish = ?, fresh_days = ? where id = 1")
    .bind(input.enabled ? 1 : 0, feedUrl, input.autoPublish ? 1 : 0, readFreshDays(input.freshDays, DEFAULT_FRESH_DAYS))
    .run();
  return { ok: true };
}

// Autorka převzatých zpráv. Účet je vypnutý a bez e-mailu, takže se do něj nikdo nepřihlásí.
export async function ensureBot(env) {
  const row = await env.DB.prepare("select id, name from users where login = ?").bind(BOT_LOGIN).first();
  if (row) return { id: Number(row.id), name: String(row.name) };
  await env.DB.prepare("insert or ignore into users (login, name, alias, password_hash, role, active) values (?, ?, '', '', 'prispevovatel', 0)")
    .bind(BOT_LOGIN, BOT_NAME)
    .run();
  const created = await env.DB.prepare("select id, name from users where login = ?").bind(BOT_LOGIN).first();
  return { id: Number(created.id), name: String(created.name) };
}
