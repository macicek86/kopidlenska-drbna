// Uzavírky z NDIC v D1: přijaté záznamy, ruční skrytí či ukázání v redakci, zpracování Drběnou a stav příjmu.
import { addColumn, asBool, requireChief } from "../db-core.js";
import { lockRow, unlockRow } from "../background.js";
import { closureKind, closureNotice, closureTitle, closureWatched, DEFAULT_RADIUS_KM, distanceKm, KEEP_RADIUS_KM, MAX_RADIUS_KM, recordEnded } from "./closures.js";

export const NDIC_TABLES = [
  `create table if not exists road_closures (
    id text primary key,
    situation_id text not null,
    version_time text not null default '',
    kind text not null default '',
    title text not null,
    starts_at text not null default '',
    ends_at text not null default '',
    roads text not null default '[]',
    comments text not null default '[]',
    detour text not null default '[]',
    distance_km real,
    manual text not null default '',
    received_at text not null default (datetime('now')),
    status text not null default 'nove',
    reason text not null default '',
    duplicate_of text not null default '',
    article_id integer,
    proposal_id integer,
    attempts integer not null default 0,
    human_title text not null default '',
    human_places text not null default '',
    human_note text not null default '',
    processed_at text,
    cleared integer not null default 0
  )`,
  "create index if not exists road_closures_situation on road_closures (situation_id)",
  `create table if not exists ndic_settings (
    id integer primary key,
    enabled integer not null default 1,
    radius_km integer not null default 10,
    last_at text,
    last_situations integer not null default 0,
    last_kept integer not null default 0,
    last_error text not null default '',
    drbena integer not null default 0,
    article_days integer not null default 2,
    auto_publish integer not null default 0,
    drbena_note text not null default '',
    running_at text
  )`,
];

// Sloupce, které přibyly po prvním založení tabulek (verze 7).
const LATER_COLUMNS = {
  road_closures: [
    ["status", "text not null default 'nove'"],
    ["reason", "text not null default ''"],
    ["duplicate_of", "text not null default ''"],
    ["article_id", "integer"],
    ["proposal_id", "integer"],
    ["attempts", "integer not null default 0"],
    ["human_title", "text not null default ''"],
    ["human_places", "text not null default ''"],
    ["human_note", "text not null default ''"],
    ["processed_at", "text"],
    ["cleared", "integer not null default 0"],
  ],
  ndic_settings: [
    ["drbena", "integer not null default 0"],
    ["article_days", "integer not null default 2"],
    ["auto_publish", "integer not null default 0"],
    ["drbena_note", "text not null default ''"],
    ["running_at", "text"],
  ],
};

export async function ensureNdicTables(env) {
  for (const sql of NDIC_TABLES) await env.DB.prepare(sql).run();
  for (const [table, columns] of Object.entries(LATER_COLUMNS)) {
    const info = await env.DB.prepare(`pragma table_info(${table})`).all();
    const present = new Set((info.results ?? []).map((row) => row.name));
    for (const [name, type] of columns) await addColumn(env, present, name, `alter table ${table} add column ${name} ${type}`);
  }
  await env.DB.prepare("insert into ndic_settings (id) select 1 where not exists (select 1 from ndic_settings where id = 1)").run();
}

export const MAX_ARTICLE_DAYS = 60;

function readArticleDays(value) {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days) || days < 0) return 2;
  return Math.min(days, MAX_ARTICLE_DAYS);
}

function readRadius(value) {
  const radius = Math.round(Number(value));
  if (!Number.isFinite(radius) || radius < 1) return DEFAULT_RADIUS_KM;
  return Math.min(radius, MAX_RADIUS_KM);
}

export async function loadNdicSettings(env) {
  const row = await env.DB.prepare(
    `select enabled, radius_km, last_at, last_situations, last_kept, last_error, drbena, article_days, auto_publish, drbena_note, running_at
     from ndic_settings where id = 1`,
  ).first();
  return {
    enabled: row ? asBool(row.enabled) : true,
    radiusKm: readRadius(row?.radius_km),
    lastAt: row?.last_at ? String(row.last_at) : "",
    lastSituations: Number(row?.last_situations ?? 0),
    lastKept: Number(row?.last_kept ?? 0),
    lastError: String(row?.last_error ?? ""),
    drbena: asBool(row?.drbena),
    articleDays: readArticleDays(row?.article_days ?? 2),
    autoPublish: asBool(row?.auto_publish),
    drbenaNote: String(row?.drbena_note ?? ""),
    runningAt: String(row?.running_at ?? ""),
  };
}

function list(value) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function mapClosure(row) {
  return {
    id: String(row.id),
    ref: Number(row.rowid ?? 0),
    situationId: String(row.situation_id),
    kind: String(row.kind ?? ""),
    title: String(row.title),
    startsAt: String(row.starts_at ?? ""),
    endsAt: String(row.ends_at ?? ""),
    roads: list(row.roads),
    comments: list(row.comments),
    detour: list(row.detour),
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    manual: String(row.manual ?? ""),
    receivedAt: String(row.received_at ?? ""),
    status: String(row.status ?? "nove"),
    reason: String(row.reason ?? ""),
    duplicateOf: String(row.duplicate_of ?? ""),
    articleId: row.article_id == null ? null : Number(row.article_id),
    proposalId: row.proposal_id == null ? null : Number(row.proposal_id),
    attempts: Number(row.attempts ?? 0),
    humanTitle: String(row.human_title ?? ""),
    humanPlaces: String(row.human_places ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
    humanNote: String(row.human_note ?? ""),
  };
}

export const CLOSURE_FIELDS = `rowid, id, situation_id, kind, title, starts_at, ends_at, roads, comments, detour, distance_km, manual, received_at,
  status, reason, duplicate_of, article_id, proposal_id, attempts, human_title, human_places, human_note`;
const FIELDS = CLOSURE_FIELDS;

// Skončené záznamy pryč: NDIC konec platnosti nemusí poslat znovu, prostě přestane platit.
// Smazané před resetem odběru, které NDIC do týdne neposlal znovu, taky.
async function dropEnded(env, now) {
  await env.DB.prepare("delete from road_closures where ends_at != '' and ends_at < ?").bind(now.toISOString()).run();
  await env.DB.prepare("delete from road_closures where cleared = 1 and received_at < datetime('now', '-7 days')").run();
}

export async function loadClosures(env, now = new Date()) {
  const rows = await env.DB.prepare(
    `select ${FIELDS} from road_closures where cleared = 0 and (ends_at = '' or ends_at >= ?)
     order by distance_km is null, distance_km asc, starts_at asc`,
  )
    .bind(now.toISOString())
    .all();
  return (rows.results ?? []).map(mapClosure);
}

// Uzavírky jako oznámení pro web (published podle okruhu, ručního ukázání či skrytí a vypínače).
export async function loadClosureNotices(env, now = new Date()) {
  const [settings, closures] = await Promise.all([loadNdicSettings(env), loadClosures(env, now)]);
  return closures.map((row) => closureNotice(row, settings));
}

function utc(iso) {
  const date = new Date(String(iso ?? ""));
  return iso && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function upsert(env, record, distance) {
  return env.DB.prepare(
    `insert into road_closures (id, situation_id, version_time, kind, title, starts_at, ends_at, roads, comments, detour, distance_km, received_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     on conflict(id) do update set situation_id = excluded.situation_id, version_time = excluded.version_time,
       kind = excluded.kind, title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       roads = excluded.roads, comments = excluded.comments, detour = excluded.detour,
       distance_km = excluded.distance_km, received_at = excluded.received_at, cleared = 0
     where excluded.version_time >= road_closures.version_time`,
  ).bind(
    record.id,
    record.situationId,
    utc(record.versionTime),
    closureKind(record),
    closureTitle(record),
    utc(record.startsAt),
    utc(record.endsAt),
    JSON.stringify(record.roads ?? []),
    JSON.stringify(record.comments ?? []),
    JSON.stringify(record.detour ?? []),
    distance,
  );
}

// Uloží situace ze zprávy NDIC. Situace přichází vždy celá: záznamy, které v ní už nejsou, se smažou.
// Záznamy daleko od Kopidlna se neukládají (odběr může posílat celou republiku), bez polohy ano,
// ať je redakce vidí a může je ukázat ručně.
export async function saveSituations(env, situations, now = new Date()) {
  const statements = [];
  let kept = 0;
  for (const situation of situations) {
    const live = [];
    for (const record of situation.records) {
      if (recordEnded(record, now)) continue;
      const distance = distanceKm(record.points);
      if (distance != null && distance > KEEP_RADIUS_KM) continue;
      live.push(record);
      statements.push(upsert(env, record, distance));
    }
    kept += live.length;
    const ids = live.map((record) => record.id);
    statements.unshift(
      ids.length
        ? env.DB.prepare(`delete from road_closures where situation_id = ? and id not in (${ids.map(() => "?").join(", ")})`).bind(situation.id, ...ids)
        : env.DB.prepare("delete from road_closures where situation_id = ?").bind(situation.id),
    );
  }
  for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
  await dropEnded(env, now);
  return { situations: situations.length, kept };
}

export async function noteReceived(env, { situations = 0, kept = 0, error = "" }) {
  await env.DB.prepare(
    "update ndic_settings set last_at = datetime('now'), last_situations = ?, last_kept = ?, last_error = ? where id = 1",
  )
    .bind(situations, kept, String(error).slice(0, 300))
    .run();
}

export async function saveNdicSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update ndic_settings set enabled = ?, radius_km = ?, drbena = ?, article_days = ?, auto_publish = ? where id = 1")
    .bind(input.enabled ? 1 : 0, readRadius(input.radiusKm), input.drbena ? 1 : 0, readArticleDays(input.articleDays), input.autoPublish ? 1 : 0)
    .run();
  return { ok: true };
}

const MANUAL = new Set(["", "skryt", "ukazat"]);

export async function setClosureManual(env, request, id, manual) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  if (!MANUAL.has(manual)) return { ok: false, error: "Tohle nastavení neznám." };
  const result = await env.DB.prepare("update road_closures set manual = ? where id = ?").bind(manual, String(id ?? "")).run();
  if (!Number(result?.meta?.changes ?? 0)) return { ok: false, error: "Tahle uzavírka už tu není." };
  return { ok: true };
}

// Před resetem odběru v portálu NDIC: NDIC pak pošle všechny platné uzavírky znovu. Záznamy se jen schovají,
// ať u uzavírky, která přijde znovu, zůstane, co k ní Drběna napsala (jinak by svůj článek měla za duplicitu).
export async function clearClosures(env, request) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update road_closures set cleared = 1").run();
  return { ok: true };
}

// Zpracování Drběnou: fronta, zámek a výsledek.
export const MAX_ATTEMPTS = 3;

export async function lockNdic(env, seconds) {
  return lockRow(env, "ndic_settings", seconds);
}

export async function unlockNdic(env, token) {
  return unlockRow(env, "ndic_settings", token);
}

// Čekající uzavírky v hlídaném okruhu, nejstarší první. Okruh se kontroluje tady, ne v SQL (ruční ukázání, skrytí).
export async function waitingClosures(env, settings, now = new Date()) {
  const rows = await env.DB.prepare(
    `select ${CLOSURE_FIELDS} from road_closures
     where cleared = 0 and (status = 'nove' or (status = 'chyba' and attempts < ?)) and (ends_at = '' or ends_at >= ?)
     order by received_at asc, rowid asc limit 200`,
  )
    .bind(MAX_ATTEMPTS, now.toISOString())
    .all();
  return (rows.results ?? []).map(mapClosure).filter((row) => closureWatched(row, settings.radiusKm));
}

export async function finishClosure(env, id, fields) {
  await env.DB.prepare(
    `update road_closures set status = ?, reason = ?, duplicate_of = ?, article_id = ?, proposal_id = ?,
       human_title = ?, human_places = ?, human_note = ?, processed_at = datetime('now'),
       attempts = attempts + case when ? = 'chyba' then 1 else 0 end
     where id = ?`,
  )
    .bind(
      fields.status,
      String(fields.reason ?? "").slice(0, 400),
      fields.duplicateOf ?? "",
      fields.articleId ?? null,
      fields.proposalId ?? null,
      fields.humanTitle ?? "",
      (fields.humanPlaces ?? []).join("\n"),
      fields.humanNote ?? "",
      fields.status,
      id,
    )
    .run();
}

export async function writeNdicNote(env, note) {
  await env.DB.prepare("update ndic_settings set drbena_note = ? where id = 1").bind(String(note).slice(0, 300)).run();
}

// Redakce chce, aby to Drběna zkusila znovu (třeba po duplicitě, která duplicitou nebyla).
// Článek, který už napsala, zůstane: znovu se jen přepíše oznámení a rozhodne o duplicitě.
export async function retryClosure(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const result = await env.DB.prepare(
    "update road_closures set status = 'nove', attempts = 0, reason = '', duplicate_of = '' where id = ?",
  )
    .bind(String(id ?? ""))
    .run();
  if (!Number(result?.meta?.changes ?? 0)) return { ok: false, error: "Tahle uzavírka už tu není." };
  return { ok: true };
}

// Uzavírky z NDIC, které jsou na webu, jako přehled pro importy (Munipolis, Deník, NDIC), ať se nezdvojí.
export async function knownClosures(env, now = new Date()) {
  const [settings, closures] = await Promise.all([loadNdicSettings(env), loadClosures(env, now)]);
  return closures
    .map((row) => ({ row, notice: closureNotice(row, settings) }))
    .filter(({ notice }) => notice.published)
    .map(({ row, notice }) => ({ ref: row.ref, articleId: row.articleId, proposalId: row.proposalId, notice }));
}
