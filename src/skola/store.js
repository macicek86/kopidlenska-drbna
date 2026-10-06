// Import z webů škol v D1: nastavení a zapamatované články. Každá škola (`sources.js`) má vlastní dvě tabulky.
import { countQueued, lockHeld, lockRow, markManual, queuedWhere, readFreshDays, STALE_REASON, unlockRow } from "../background.js";
import { addColumn, asBool, clip, requireChief } from "../db-core.js";
import { MAX_ATTEMPTS, mapImportItem } from "../munipolis/store.js";
import { DEFAULT_AHEAD_DAYS, readAheadDays } from "./defer.js";
import { readFeedUrls } from "./feed.js";
import { SCHOOL_LIST } from "./sources.js";

export const schoolTables = (source) => [
  `create table if not exists ${source.settingsTable} (
    id integer primary key,
    enabled integer not null default 0,
    feed_urls text not null default '',
    auto_publish integer not null default 0,
    fresh_days integer not null default ${source.freshDays},
    own_photos integer not null default 0,
    ahead_days integer not null default ${DEFAULT_AHEAD_DAYS},
    checked_at text,
    status text not null default '',
    note text not null default '',
    running_at text
  )`,
  `create table if not exists ${source.itemsTable} (
    id integer primary key autoincrement,
    guid text not null unique,
    link text not null default '',
    title text not null,
    text text not null default '',
    images text not null default '[]',
    documents text not null default '[]',
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
    write_on text not null default '',
    attempts integer not null default 0,
    created_at text not null default (datetime('now')),
    processed_at text
  )`,
];

export async function ensureSkolaTables(env) {
  for (const source of SCHOOL_LIST) {
    for (const sql of schoolTables(source)) await env.DB.prepare(sql).run();
    const info = await env.DB.prepare(`pragma table_info(${source.itemsTable})`).all();
    const names = new Set((info.results ?? []).map((row) => row.name));
    // PDF z úřední desky (zatím jen web města, `deska.js`).
    await addColumn(env, names, "documents", `alter table ${source.itemsTable} add column documents text not null default '[]'`);
    // Odložená pozvánka na akci (`defer.js`).
    await addColumn(env, names, "write_on", `alter table ${source.itemsTable} add column write_on text not null default ''`);
    const settingsInfo = await env.DB.prepare(`pragma table_info(${source.settingsTable})`).all();
    const settingsNames = new Set((settingsInfo.results ?? []).map((row) => row.name));
    await addColumn(env, settingsNames, "ahead_days", `alter table ${source.settingsTable} add column ahead_days integer not null default ${DEFAULT_AHEAD_DAYS}`);
    await env.DB.prepare(`insert into ${source.settingsTable} (id) select 1 where not exists (select 1 from ${source.settingsTable} where id = 1)`).run();
  }
}

function splitUrls(text, source) {
  const urls = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return urls.length ? urls : source.defaultFeeds;
}

function mapSettings(row, source) {
  return {
    enabled: asBool(row?.enabled),
    feedUrls: splitUrls(row?.feed_urls, source),
    autoPublish: asBool(row?.auto_publish),
    freshDays: readFreshDays(row?.fresh_days, source.freshDays),
    ownPhotos: asBool(row?.own_photos),
    aheadDays: readAheadDays(row?.ahead_days),
    checkedAt: row?.checked_at ? String(row.checked_at) : "",
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    runningAt: String(row?.running_at ?? ""),
  };
}

export async function loadSkolaSettings(env, source) {
  const row = await env.DB.prepare(
    `select enabled, feed_urls, auto_publish, fresh_days, own_photos, ahead_days, checked_at, status, note, running_at from ${source.settingsTable} where id = 1`,
  ).first();
  return mapSettings(row, source);
}

const ITEM_FIELDS =
  "id, guid, link, title, text, images, documents, section, term, published_at, status, reason, duplicate_of, article_id, proposal_id, event_id, notice_id, manual, write_on, attempts, processed_at, created_at";

function parseDocuments(text) {
  try {
    const list = JSON.parse(text || "[]");
    return Array.isArray(list) ? list.filter((url) => typeof url === "string") : [];
  } catch {
    return [];
  }
}

function mapSkolaItem(row) {
  return { ...mapImportItem(row), documents: parseDocuments(row.documents), section: String(row.section ?? ""), term: String(row.term ?? ""), writeOn: String(row.write_on ?? "") };
}

export async function loadSkolaItems(env, source, limit = 40) {
  const rows = await env.DB.prepare(`select ${ITEM_FIELDS} from ${source.itemsTable} order by published_at desc, id desc limit ?`).bind(limit).all();
  return (rows.results ?? []).map(mapSkolaItem);
}

export async function waitingSkolaItems(env, source, limit, { manualOnly = false } = {}) {
  const rows = await env.DB.prepare(
    `select ${ITEM_FIELDS} from ${source.itemsTable} where ${queuedWhere(manualOnly)}
     order by manual desc, published_at asc, id asc limit ?`,
  )
    .bind(MAX_ATTEMPTS, limit)
    .all();
  return (rows.results ?? []).map(mapSkolaItem);
}

export const countWaitingSkola = (env, source, options) => countQueued(env, source.itemsTable, MAX_ATTEMPTS, options);
export const selectSkolaItems = (env, source, ids) => markManual(env, source.itemsTable, ids);

// Nové články si zapamatuje. Starší (`isOld`) jen odloží stranou.
// Při ručním načtení počkají všechny, až redakce vybere, které zpracovat.
export async function rememberSkolaItems(env, source, items, { manual = false, isOld = () => false } = {}) {
  let added = 0;
  for (const item of items) {
    const status = manual ? "nacteno" : isOld(item) ? "stare" : "nove";
    const result = await env.DB.prepare(
      `insert or ignore into ${source.itemsTable} (guid, link, title, text, images, documents, section, term, published_at, status, reason)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        item.guid,
        item.link,
        item.title,
        item.text,
        JSON.stringify(item.images),
        JSON.stringify(item.documents ?? []),
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

export async function finishSkolaItem(env, source, id, fields) {
  await env.DB.prepare(
    `update ${source.itemsTable} set status = ?, reason = ?, duplicate_of = ?, article_id = ?, proposal_id = ?, event_id = ?, notice_id = ?,
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

export async function writeSkolaStatus(env, source, { status, note }) {
  await env.DB.prepare(`update ${source.settingsTable} set checked_at = ?, status = ?, note = ? where id = 1`)
    .bind(new Date().toISOString(), status, clip(note, 400))
    .run();
}

export const lockSkola = (env, source, seconds) => lockRow(env, source.settingsTable, seconds);
export const unlockSkola = (env, source, token) => unlockRow(env, source.settingsTable, token);

export function skolaRunning(settings, now = new Date()) {
  return lockHeld(settings.runningAt, now);
}

export async function saveSkolaSettings(env, request, source, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  // Škola bez pole adres (WordPress) má adresu pevnou.
  const urls = source.feedField ? readFeedUrls(input.feedUrls, source.defaultFeeds) : [];
  if (!urls) return { ok: false, error: "Každá adresa RSS musí začínat https://." };
  await env.DB.prepare(
    `update ${source.settingsTable} set enabled = ?, feed_urls = ?, auto_publish = ?, fresh_days = ?, own_photos = ?, ahead_days = ? where id = 1`,
  )
    .bind(
      input.enabled ? 1 : 0,
      urls.join("\n"),
      input.autoPublish ? 1 : 0,
      readFreshDays(input.freshDays, source.freshDays),
      input.ownPhotos ? 1 : 0,
      readAheadDays(input.aheadDays),
    )
    .run();
  return { ok: true };
}
