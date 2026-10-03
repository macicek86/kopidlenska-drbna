// Uzavírky z NDIC v D1: přijaté záznamy, ruční skrytí či ukázání v redakci a stav příjmu.
import { asBool, requireChief } from "../db-core.js";
import { closureKind, closureNotice, closureTitle, DEFAULT_RADIUS_KM, distanceKm, KEEP_RADIUS_KM, MAX_RADIUS_KM, recordEnded } from "./closures.js";

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
    received_at text not null default (datetime('now'))
  )`,
  "create index if not exists road_closures_situation on road_closures (situation_id)",
  `create table if not exists ndic_settings (
    id integer primary key,
    enabled integer not null default 1,
    radius_km integer not null default 10,
    last_at text,
    last_situations integer not null default 0,
    last_kept integer not null default 0,
    last_error text not null default ''
  )`,
];

export async function ensureNdicTables(env) {
  for (const sql of NDIC_TABLES) await env.DB.prepare(sql).run();
  await env.DB.prepare("insert into ndic_settings (id) select 1 where not exists (select 1 from ndic_settings where id = 1)").run();
}

function readRadius(value) {
  const radius = Math.round(Number(value));
  if (!Number.isFinite(radius) || radius < 1) return DEFAULT_RADIUS_KM;
  return Math.min(radius, MAX_RADIUS_KM);
}

export async function loadNdicSettings(env) {
  const row = await env.DB.prepare(
    "select enabled, radius_km, last_at, last_situations, last_kept, last_error from ndic_settings where id = 1",
  ).first();
  return {
    enabled: row ? asBool(row.enabled) : true,
    radiusKm: readRadius(row?.radius_km),
    lastAt: row?.last_at ? String(row.last_at) : "",
    lastSituations: Number(row?.last_situations ?? 0),
    lastKept: Number(row?.last_kept ?? 0),
    lastError: String(row?.last_error ?? ""),
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

function mapClosure(row) {
  return {
    id: String(row.id),
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
  };
}

const FIELDS = "id, situation_id, kind, title, starts_at, ends_at, roads, comments, detour, distance_km, manual, received_at";

// Skončené záznamy pryč: NDIC konec platnosti nemusí poslat znovu, prostě přestane platit.
async function dropEnded(env, now) {
  await env.DB.prepare("delete from road_closures where ends_at != '' and ends_at < ?").bind(now.toISOString()).run();
}

export async function loadClosures(env, now = new Date()) {
  const rows = await env.DB.prepare(
    `select ${FIELDS} from road_closures where ends_at = '' or ends_at >= ?
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
       distance_km = excluded.distance_km, received_at = excluded.received_at
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
  await env.DB.prepare("update ndic_settings set enabled = ?, radius_km = ? where id = 1")
    .bind(input.enabled ? 1 : 0, readRadius(input.radiusKm))
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

// Před resetem odběru v portálu NDIC: NDIC pak pošle všechny platné uzavírky znovu.
export async function clearClosures(env, request) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("delete from road_closures").run();
  return { ok: true };
}
