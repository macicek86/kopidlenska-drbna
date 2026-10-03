// Výluky a mimořádnosti vlaků (trať 061) v D1: co drbna naposledy zjistila u Českých drah, ruční skrytí a nastavení.
import { asBool, requireChief } from "../db-core.js";
import { pragueNow } from "../waste.js";
import { TRACK } from "./cd.js";

export const TRAIN_TABLES = [
  `create table if not exists train_restrictions (
    id text primary key,
    cd_id integer not null,
    type text not null,
    sections text not null default '[]',
    measures text not null default '[]',
    starts_on text not null,
    starts_time text not null default '',
    ends_on text not null default '',
    ends_time text not null default '',
    cause text not null default '',
    link text not null default '',
    description text not null default '',
    pdf_url text not null default '',
    detail_key text not null default '',
    manual text not null default '',
    seen_at text not null default '',
    created_at text not null default (datetime('now'))
  )`,
  `create table if not exists train_settings (
    id integer primary key,
    enabled integer not null default 1,
    days_ahead integer not null default 21,
    track_id integer,
    track_checked_on text not null default '',
    last_at text,
    last_count integer not null default 0,
    last_error text not null default ''
  )`,
];

export async function ensureTrainTables(env) {
  for (const sql of TRAIN_TABLES) await env.DB.prepare(sql).run();
  await env.DB.prepare("insert into train_settings (id) select 1 where not exists (select 1 from train_settings where id = 1)").run();
}

export const DEFAULT_DAYS_AHEAD = 21;
export const MAX_DAYS_AHEAD = 35;

function readDays(value) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days) || days < 1) return DEFAULT_DAYS_AHEAD;
  return Math.min(days, MAX_DAYS_AHEAD);
}

export async function loadTrainSettings(env) {
  const row = await env.DB.prepare(
    "select enabled, days_ahead, track_id, track_checked_on, last_at, last_count, last_error from train_settings where id = 1",
  ).first();
  return {
    enabled: row ? asBool(row.enabled) : true,
    daysAhead: readDays(row?.days_ahead),
    trackId: Number(row?.track_id) || TRACK.id,
    trackCheckedOn: String(row?.track_checked_on ?? ""),
    lastAt: row?.last_at ? String(row.last_at) : "",
    lastCount: Number(row?.last_count ?? 0),
    lastError: String(row?.last_error ?? ""),
  };
}

export async function saveTrainSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update train_settings set enabled = ?, days_ahead = ? where id = 1")
    .bind(input.enabled ? 1 : 0, readDays(input.daysAhead))
    .run();
  return { ok: true };
}

export async function saveTrackId(env, trackId, today) {
  await env.DB.prepare("update train_settings set track_id = coalesce(?, track_id), track_checked_on = ? where id = 1").bind(trackId, today).run();
}

export async function noteScan(env, { count = 0, error = "" }) {
  await env.DB.prepare("update train_settings set last_at = datetime('now'), last_count = ?, last_error = ? where id = 1")
    .bind(count, String(error).slice(0, 300))
    .run();
}

function list(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function mapTrain(row) {
  return {
    id: String(row.id),
    cdId: Number(row.cd_id),
    type: String(row.type),
    sections: list(row.sections),
    measures: list(row.measures),
    startsOn: String(row.starts_on),
    startsTime: String(row.starts_time ?? ""),
    endsOn: String(row.ends_on ?? ""),
    endsTime: String(row.ends_time ?? ""),
    cause: String(row.cause ?? ""),
    link: String(row.link ?? ""),
    description: String(row.description ?? ""),
    pdfUrl: String(row.pdf_url ?? ""),
    detailKey: String(row.detail_key ?? ""),
    manual: String(row.manual ?? ""),
  };
}

const FIELDS = `id, cd_id, type, sections, measures, starts_on, starts_time, ends_on, ends_time, cause, link, description, pdf_url, detail_key, manual`;

export async function loadTrains(env, now = new Date()) {
  const rows = await env.DB.prepare(
    `select ${FIELDS} from train_restrictions where ends_on = '' or ends_on >= ? order by starts_on asc, starts_time asc, id asc`,
  )
    .bind(pragueNow(now).date)
    .all();
  return (rows.results ?? []).map(mapTrain);
}

// Výluka jako oznámení (stejný tvar jako notices), ať ji web vykreslí jako vodu a uzavírky.
// Celý den (00:00 až 23:55 či 23:59) se píše jen datem.
export function trainNotice(row, { enabled = true } = {}) {
  const note = row.description || row.measures.join(". ");
  return {
    id: `vlak-${row.id}`,
    kind: "vlak",
    title: row.type === "mimo" ? "Mimořádnost na trati" : "Výluka vlaků",
    startsOn: row.startsOn,
    startsTime: row.startsTime === "00:00" ? "" : row.startsTime,
    endsOn: row.endsOn && row.endsOn !== row.startsOn ? row.endsOn : "",
    endsTime: row.endsTime >= "23:55" ? "" : row.endsTime,
    openEnded: !row.endsOn,
    places: row.sections,
    note: row.type === "mimo" && row.cause && !note.includes(row.cause) ? [row.cause, note].filter(Boolean).join(". ") : note,
    sourceUrl: row.link,
    pdfUrl: row.pdfUrl,
    published: Boolean(enabled && row.manual !== "skryt"),
    source: "cd",
  };
}

export async function loadTrainNotices(env, now = new Date()) {
  const [settings, rows] = await Promise.all([loadTrainSettings(env), loadTrains(env, now)]);
  return rows.map((row) => trainNotice(row, settings));
}

function upsert(env, item, stamp) {
  return env.DB.prepare(
    `insert into train_restrictions (id, cd_id, type, sections, measures, starts_on, starts_time, ends_on, ends_time, cause, link, seen_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set sections = excluded.sections, measures = excluded.measures, starts_on = excluded.starts_on,
       starts_time = excluded.starts_time, ends_on = excluded.ends_on, ends_time = excluded.ends_time, cause = excluded.cause,
       link = excluded.link, seen_at = excluded.seen_at`,
  ).bind(
    item.id,
    item.cdId,
    item.type,
    JSON.stringify(item.sections),
    JSON.stringify(item.measures),
    item.startsOn,
    item.startsTime,
    item.endsOn,
    item.endsTime,
    item.cause,
    item.link,
    stamp,
  );
}

// Uloží, co drbna u ČD našla. Když se podařilo projít všechny dny, výluky, které v přehledu už nejsou
// (zrušené, skončené), se smažou. Po částečném průchodu se jen přidává, ať výluka nezmizí kvůli výpadku.
export async function saveScan(env, items, { complete, now = new Date() }) {
  const stamp = now.toISOString();
  const statements = items.map((item) => upsert(env, item, stamp));
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  if (complete) await env.DB.prepare("delete from train_restrictions where seen_at < ?").bind(stamp).run();
  await env.DB.prepare("delete from train_restrictions where ends_on != '' and ends_on < ?").bind(pragueNow(now).date).run();
}

// Detail (popis a výlukový jízdní řád) se stahuje jednou a znovu, jen když se výluka posune.
export function detailKey(row) {
  return `${row.startsOn} ${row.startsTime}|${row.endsOn} ${row.endsTime}`;
}

export async function rowsWithoutDetail(env, limit) {
  const rows = await env.DB.prepare(
    `select ${FIELDS} from train_restrictions
     where link != '' and detail_key != starts_on || ' ' || starts_time || '|' || ends_on || ' ' || ends_time
     order by starts_on asc limit ?`,
  )
    .bind(limit)
    .all();
  return (rows.results ?? []).map(mapTrain);
}

export async function saveDetail(env, row, detail) {
  await env.DB.prepare("update train_restrictions set description = ?, pdf_url = ?, detail_key = ? where id = ?")
    .bind(detail.description, detail.pdfUrl, detailKey(row), row.id)
    .run();
}

const MANUAL = new Set(["", "skryt"]);

export async function setTrainManual(env, request, id, manual) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  if (!MANUAL.has(manual)) return { ok: false, error: "Tohle nastavení neznám." };
  const result = await env.DB.prepare("update train_restrictions set manual = ? where id = ?").bind(manual, String(id ?? "")).run();
  if (!Number(result?.meta?.changes ?? 0)) return { ok: false, error: "Tahle výluka už tu není." };
  return { ok: true };
}
