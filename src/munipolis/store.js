// Import z Munipolisu v D1: nastavení, zapamatované zprávy a autorka Koza Drběna.
import { lockHeld, lockRow, unlockRow } from "../background.js";
import { asBool, clip, requireChief } from "../db-core.js";
import { hashPassword } from "../password.js";
import { DEFAULT_FEED_URL, readFeedUrl } from "./feed.js";

export const BOT_LOGIN = "drbena";
export const BOT_NAME = "Koza Drběna";
export const STATUS = {
  nove: "Čeká na zpracování",
  stare: "Starší než zapnutí importu",
  hotovo: "Zpracováno",
  preskoceno: "Přeskočeno",
  duplicita: "Duplicita",
  chyba: "Chyba",
};
export const MAX_ATTEMPTS = 3;

export const IMPORT_TABLES = [
  `create table if not exists import_settings (
    id integer primary key,
    enabled integer not null default 0,
    feed_url text not null default '',
    auto_publish integer not null default 0,
    voice text not null default '',
    since text not null default '',
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
    attempts integer not null default 0,
    created_at text not null default (datetime('now')),
    processed_at text
  )`,
];

export async function ensureImportTables(env) {
  for (const sql of IMPORT_TABLES) await env.DB.prepare(sql).run();
  await env.DB.prepare("insert into import_settings (id) select 1 where not exists (select 1 from import_settings where id = 1)").run();
}

function mapSettings(row) {
  return {
    enabled: asBool(row?.enabled),
    feedUrl: String(row?.feed_url ?? "") || DEFAULT_FEED_URL,
    autoPublish: asBool(row?.auto_publish),
    voice: String(row?.voice ?? ""),
    since: String(row?.since ?? ""),
    checkedAt: row?.checked_at ? String(row.checked_at) : "",
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    runningAt: String(row?.running_at ?? ""),
  };
}

export async function loadImportSettings(env) {
  const row = await env.DB.prepare(
    "select enabled, feed_url, auto_publish, voice, since, checked_at, status, note, running_at from import_settings where id = 1",
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
    attempts: Number(row.attempts ?? 0),
    processedAt: row.processed_at ? String(row.processed_at) : "",
  };
}

const ITEM_FIELDS =
  "id, guid, link, title, text, images, published_at, status, reason, duplicate_of, article_id, proposal_id, event_id, notice_id, attempts, processed_at";

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

export async function waitingItems(env, limit) {
  const rows = await env.DB.prepare(
    `select ${ITEM_FIELDS} from import_items
     where status = 'nove' or (status = 'chyba' and attempts < ?)
     order by published_at asc, id asc limit ?`,
  )
    .bind(MAX_ATTEMPTS, limit)
    .all();
  return (rows.results ?? []).map(mapImportItem);
}

// Nové zprávy z kanálu si zapamatuje. Co vyšlo před zapnutím importu, jen odloží stranou.
export async function rememberItems(env, items, since) {
  let added = 0;
  for (const item of items) {
    const old = since && item.publishedAt && item.publishedAt < since;
    const result = await env.DB.prepare(
      `insert or ignore into import_items (guid, link, title, text, images, published_at, status)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(item.guid, item.link, item.title, item.text, JSON.stringify(item.images), item.publishedAt, old ? "stare" : "nove")
      .run();
    if (Number(result?.meta?.changes ?? 0) > 0 && !old) added += 1;
  }
  return added;
}

export async function finishItem(env, id, fields) {
  await env.DB.prepare(
    `update import_items set status = ?, reason = ?, duplicate_of = ?, article_id = ?, proposal_id = ?, event_id = ?, notice_id = ?,
       attempts = attempts + 1, processed_at = datetime('now') where id = ?`,
  )
    .bind(
      fields.status,
      clip(fields.reason, 400),
      fields.duplicateOf ?? "",
      fields.articleId ?? null,
      fields.proposalId ?? null,
      fields.eventId ?? null,
      fields.noticeId ?? null,
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

export async function countWaitingItems(env) {
  const row = await env.DB.prepare("select count(*) as n from import_items where status = 'nove' or (status = 'chyba' and attempts < ?)")
    .bind(MAX_ATTEMPTS)
    .first();
  return Number(row?.n ?? 0);
}

// Při prvním zapnutí si drbna poznamená, odkdy zprávy brát, ať nezahltí redakci celým archivem.
export function sinceFor(previous, enabled, now = new Date()) {
  if (previous || !enabled) return previous;
  return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

export async function saveImportSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const feedUrl = readFeedUrl(input.feedUrl);
  if (!feedUrl) return { ok: false, error: "Adresa RSS musí začínat https://." };
  const current = await loadImportSettings(env);
  const voice = clip(input.voice, 3000);
  await env.DB.prepare("update import_settings set enabled = ?, feed_url = ?, auto_publish = ?, voice = ?, since = ? where id = 1")
    .bind(input.enabled ? 1 : 0, feedUrl, input.autoPublish ? 1 : 0, voice, sinceFor(current.since, input.enabled))
    .run();
  return { ok: true };
}

// Autorka převzatých zpráv. Účet je vypnutý, takže se do něj nikdo nepřihlásí.
export async function ensureBot(env) {
  const row = await env.DB.prepare("select id, name from users where login = ?").bind(BOT_LOGIN).first();
  if (row) return { id: Number(row.id), name: String(row.name) };
  const secret = crypto.getRandomValues(new Uint8Array(24)).join("-");
  await env.DB.prepare("insert or ignore into users (login, name, alias, password_hash, role, active) values (?, ?, '', ?, 'prispevovatel', 0)")
    .bind(BOT_LOGIN, BOT_NAME, await hashPassword(secret))
    .run();
  const created = await env.DB.prepare("select id, name from users where login = ?").bind(BOT_LOGIN).first();
  return { id: Number(created.id), name: String(created.name) };
}
