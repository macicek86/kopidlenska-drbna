// Import z webu ZŠ a MŠ Kopidlno v D1: nastavení a zapamatované články školy.
import { countQueued, lockHeld, lockRow, markManual, queuedWhere, readFreshDays, STALE_REASON, unlockRow } from "../background.js";
import { asBool, clip, requireChief } from "../db-core.js";
import { MAX_ATTEMPTS, mapImportItem } from "../munipolis/store.js";
import { DEFAULT_FEEDS, readFeedUrls } from "./feed.js";

// Škola píše jednou za pár dní a pozvánky dává s předstihem, týden je tak akorát.
export const DEFAULT_FRESH_DAYS = 7;

export const SKOLA_TABLES = [
  `create table if not exists skola_settings (
    id integer primary key,
    enabled integer not null default 0,
    feed_urls text not null default '',
    auto_publish integer not null default 0,
    fresh_days integer not null default 7,
    own_photos integer not null default 0,
    checked_at text,
    status text not null default '',
    note text not null default '',
    running_at text
  )`,
  `create table if not exists skola_items (
    id integer primary key autoincrement,
    guid text not null unique,
    link text not null default '',
    title text not null,
    text text not null default '',
    images text not null default '[]',
    section text not null default '',
    term text not null default '',
    published_at text not null default '',
    status text not null default 'nove',
    reason text not null default '',
    duplicate_of text not null default '',
    article_id integer,
    proposal_id integer,
    event_id integer,
    notice_id integer,
    manual integer not null default 0,
    attempts integer not null default 0,
    created_at text not null default (datetime('now')),
    processed_at text
  )`,
];

export async function ensureSkolaTables(env) {
  for (const sql of SKOLA_TABLES) await env.DB.prepare(sql).run();
  await env.DB.prepare("insert into skola_settings (id) select 1 where not exists (select 1 from skola_settings where id = 1)").run();
}

function splitUrls(text) {
  const urls = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return urls.length ? urls : DEFAULT_FEEDS;
}

function mapSettings(row) {
  return {
    enabled: asBool(row?.enabled),
    feedUrls: splitUrls(row?.feed_urls),
    autoPublish: asBool(row?.auto_publish),
    freshDays: readFreshDays(row?.fresh_days, DEFAULT_FRESH_DAYS),
    ownPhotos: asBool(row?.own_photos),
    checkedAt: row?.checked_at ? String(row.checked_at) : "",
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    runningAt: String(row?.running_at ?? ""),
  };
}

export async function loadSkolaSettings(env) {
  const row = await env.DB.prepare(
    "select enabled, feed_urls, auto_publish, fresh_days, own_photos, checked_at, status, note, running_at from skola_settings where id = 1",
  ).first();
  return mapSettings(row);
}

const ITEM_FIELDS =
  "id, guid, link, title, text, images, section, term, published_at, status, reason, duplicate_of, article_id, proposal_id, event_id, notice_id, manual, attempts, processed_at";

function mapSkolaItem(row) {
  return { ...mapImportItem(row), section: String(row.section ?? ""), term: String(row.term ?? "") };
}

export async function loadSkolaItems(env, limit = 40) {
  const rows = await env.DB.prepare(`select ${ITEM_FIELDS} from skola_items order by published_at desc, id desc limit ?`).bind(limit).all();
  return (rows.results ?? []).map(mapSkolaItem);
}

export async function waitingSkolaItems(env, limit, { manualOnly = false } = {}) {
  const rows = await env.DB.prepare(
    `select ${ITEM_FIELDS} from skola_items where ${queuedWhere(manualOnly)}
     order by manual desc, published_at asc, id asc limit ?`,
  )
    .bind(MAX_ATTEMPTS, limit)
    .all();
  return (rows.results ?? []).map(mapSkolaItem);
}

export const countWaitingSkola = (env, options) => countQueued(env, "skola_items", MAX_ATTEMPTS, options);
export const selectSkolaItems = (env, ids) => markManual(env, "skola_items", ids);

// Nové články si zapamatuje. Starší (`isOld`) jen odloží stranou.
// Při ručním načtení počkají všechny, až redakce vybere, které zpracovat.
export async function rememberSkolaItems(env, items, { manual = false, isOld = () => false } = {}) {
  let added = 0;
  for (const item of items) {
    const status = manual ? "nacteno" : isOld(item) ? "stare" : "nove";
    const result = await env.DB.prepare(
      `insert or ignore into skola_items (guid, link, title, text, images, section, term, published_at, status, reason)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        item.guid,
        item.link,
        item.title,
        item.text,
        JSON.stringify(item.images),
        item.section,
        item.term,
        item.publishedAt,
        status,
        status === "stare" ? STALE_REASON : "",
      )
      .run();
    if (Number(result?.meta?.changes ?? 0) > 0 && status !== "stare") added += 1;
  }
  return added;
}

export async function finishSkolaItem(env, id, fields) {
  await env.DB.prepare(
    `update skola_items set status = ?, reason = ?, duplicate_of = ?, article_id = ?, proposal_id = ?, event_id = ?, notice_id = ?,
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

export async function writeSkolaStatus(env, { status, note }) {
  await env.DB.prepare("update skola_settings set checked_at = ?, status = ?, note = ? where id = 1")
    .bind(new Date().toISOString(), status, clip(note, 400))
    .run();
}

export const lockSkola = (env, seconds) => lockRow(env, "skola_settings", seconds);
export const unlockSkola = (env, token) => unlockRow(env, "skola_settings", token);

export function skolaRunning(settings, now = new Date()) {
  return lockHeld(settings.runningAt, now);
}

export async function saveSkolaSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const urls = readFeedUrls(input.feedUrls);
  if (!urls) return { ok: false, error: "Každá adresa RSS musí začínat https://." };
  await env.DB.prepare(
    "update skola_settings set enabled = ?, feed_urls = ?, auto_publish = ?, fresh_days = ?, own_photos = ? where id = 1",
  )
    .bind(
      input.enabled ? 1 : 0,
      urls.join("\n"),
      input.autoPublish ? 1 : 0,
      readFreshDays(input.freshDays, DEFAULT_FRESH_DAYS),
      input.ownPhotos ? 1 : 0,
    )
    .run();
  return { ok: true };
}
