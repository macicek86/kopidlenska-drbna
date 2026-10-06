// Akce z okolí v D1: nastavení (stahování, víkendový článek, okruh) a stažené akce ze zdrojů (`sources.js`).
// Akce z okolí nejsou v tabulce `events`: kalendář /akce zůstává kopidlenský. `mapNearbyEvent` jim ale dává
// stejný tvar jako `mapEvent`, ať je jde později ukázat v kalendáři vedle kopidlenských (přepínač „i okolí“).
import { lockHeld, lockRow, unlockRow } from "../background.js";
import { addColumn, asBool, clip, requireChief } from "../db-core.js";
import { NEARBY_SOURCES, nearbySource } from "./sources.js";

export const DEFAULT_RADIUS = 25;
// Poslední den akce: u vícedenní `ends_on`, jinak den začátku.
const LAST_DAY = "(case when ends_on > starts_on then ends_on else starts_on end)";

export async function ensureOkoliTables(env) {
  await env.DB.prepare(
    `create table if not exists okoli_settings (
      id integer primary key,
      enabled integer not null default 0,
      weekly integer not null default 0,
      auto_publish integer not null default 0,
      radius_km integer not null default ${DEFAULT_RADIUS},
      checked_at text,
      status text not null default '',
      note text not null default '',
      running_at text,
      weekend_on text not null default '',
      weekend_note text not null default '',
      weekend_article_id integer,
      weekend_proposal_id integer
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists okoli_events (
      id integer primary key autoincrement,
      source text not null,
      guid text not null unique,
      stamp text not null default '',
      link text not null default '',
      title text not null,
      place text not null default '',
      town text not null default '',
      km integer not null default 0,
      kind text not null default '',
      starts_on text not null,
      starts_time text not null default '',
      ends_time text not null default '',
      description text not null default '',
      sold_out integer not null default 0,
      hidden integer not null default 0,
      created_at text not null default (datetime('now')),
      seen_at text
    )`,
  ).run();
  // Poslední den vícedenní akce (festival, výstava), jinak prázdné.
  const info = await env.DB.prepare("pragma table_info(okoli_events)").all();
  await addColumn(env, new Set((info.results ?? []).map((row) => row.name)), "ends_on", "alter table okoli_events add column ends_on text not null default ''");
  await env.DB.prepare("create index if not exists okoli_events_day on okoli_events (starts_on)").run();
  // Přečtené položky zdrojů, které akcí nejsou (nebo už proběhly a akce se smazala), ať se nečtou znovu.
  await env.DB.prepare(
    `create table if not exists okoli_seen (
      guid text primary key,
      source text not null,
      stamp text not null default '',
      seen_at text not null default (datetime('now'))
    )`,
  ).run();
  await env.DB.prepare("insert into okoli_settings (id) select 1 where not exists (select 1 from okoli_settings where id = 1)").run();
}

export function readRadius(value) {
  const km = Number(String(value ?? "").trim());
  return Number.isInteger(km) && km >= 1 && km <= 100 ? km : DEFAULT_RADIUS;
}

function mapSettings(row) {
  return {
    enabled: asBool(row?.enabled),
    weekly: asBool(row?.weekly),
    autoPublish: asBool(row?.auto_publish),
    radiusKm: readRadius(row?.radius_km),
    checkedAt: row?.checked_at ? String(row.checked_at) : "",
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    runningAt: String(row?.running_at ?? ""),
    weekendOn: String(row?.weekend_on ?? ""),
    weekendNote: String(row?.weekend_note ?? ""),
    weekendArticleId: row?.weekend_article_id ? Number(row.weekend_article_id) : null,
    weekendProposalId: row?.weekend_proposal_id ? Number(row.weekend_proposal_id) : null,
  };
}

export async function loadOkoliSettings(env) {
  return mapSettings(await env.DB.prepare("select * from okoli_settings where id = 1").first());
}

export async function saveOkoliSettings(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update okoli_settings set enabled = ?, weekly = ?, auto_publish = ?, radius_km = ? where id = 1")
    .bind(input.enabled ? 1 : 0, input.weekly ? 1 : 0, input.autoPublish ? 1 : 0, readRadius(input.radiusKm))
    .run();
  return { ok: true };
}

export async function writeOkoliStatus(env, { status, note }) {
  await env.DB.prepare("update okoli_settings set checked_at = ?, status = ?, note = ? where id = 1")
    .bind(new Date().toISOString(), status, clip(note, 400))
    .run();
}

// Období (jeho začátek, src/okoli/outings.js), na které Drběna článek napsala nebo zjistila, že není o čem.
export async function saveWeekendResult(env, { key, note, articleId = null, proposalId = null }) {
  await env.DB.prepare("update okoli_settings set weekend_on = ?, weekend_note = ?, weekend_article_id = ?, weekend_proposal_id = ? where id = 1")
    .bind(key, clip(note, 400), articleId, proposalId)
    .run();
}

export const lockOkoli = (env, seconds) => lockRow(env, "okoli_settings", seconds);
export const unlockOkoli = (env, token) => unlockRow(env, "okoli_settings", token);
export const okoliRunning = (settings, now = new Date()) => lockHeld(settings.runningAt, now);

// Co už drbna ze zdroje má: akce i přečtené položky, které akcí nejsou.
export async function knownStamps(env, source) {
  const rows = await env.DB.prepare(
    "select guid, stamp from okoli_seen where source = ? union all select guid, stamp from okoli_events where source = ?",
  )
    .bind(source.tag, source.tag)
    .all();
  return new Map((rows.results ?? []).map((row) => [String(row.guid), String(row.stamp)]));
}

// Akce starší než `days` dní se smažou, ale zůstanou mezi přečtenými, ať je zdroj, který je pořád ukazuje, nečte znovu.
// Přečtené položky se zapomenou po roce.
export async function pruneNearby(env, today, days = 60) {
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - days);
  const before = limit.toISOString().slice(0, 10);
  await env.DB.prepare(
    `insert or replace into okoli_seen (guid, source, stamp) select guid, source, stamp from okoli_events where ${LAST_DAY} < ?`,
  )
    .bind(before)
    .run();
  await env.DB.prepare(`delete from okoli_events where ${LAST_DAY} < ?`).bind(before).run();
  await env.DB.prepare("delete from okoli_seen where seen_at < datetime('now', '-365 days')").run();
}

// Uloží, co zdroj poslal. Změněná akce (jiný termín, místo) se přepíše, schovaná zůstane schovaná.
// Akce, které na webu zdroje už nejsou (zrušené), se smažou, jen když se zdroj přečetl celý.
export async function rememberNearby(env, source, feed, known = new Map()) {
  let added = 0;
  for (const item of feed.items) {
    if (item.unchanged) {
      await env.DB.prepare("update okoli_events set seen_at = datetime('now') where guid = ?").bind(item.guid).run();
      continue;
    }
    if (!known.has(item.guid)) added += 1;
    await env.DB.prepare(
      `insert into okoli_events (source, guid, stamp, link, title, place, town, km, kind, starts_on, starts_time, ends_time, ends_on, description, sold_out, seen_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       on conflict(guid) do update set stamp = excluded.stamp, link = excluded.link, title = excluded.title, place = excluded.place,
         town = excluded.town, km = excluded.km, kind = excluded.kind, starts_on = excluded.starts_on, starts_time = excluded.starts_time,
         ends_time = excluded.ends_time, ends_on = excluded.ends_on, description = excluded.description, sold_out = excluded.sold_out, seen_at = excluded.seen_at`,
    )
      .bind(
        source.tag,
        item.guid,
        item.stamp ?? "",
        item.link,
        clip(item.title, 200),
        clip(item.place || source.town, 160),
        source.town,
        source.km,
        item.kind ?? "",
        item.startsOn,
        item.startsTime ?? "",
        item.endsTime ?? "",
        item.endsOn ?? "",
        clip(item.description, 1000),
        item.soldOut ? 1 : 0,
      )
      .run();
  }
  for (const guid of feed.seen ?? []) {
    await env.DB.prepare("insert or ignore into okoli_seen (guid, source) values (?, ?)").bind(guid, source.tag).run();
  }
  let removed = 0;
  if (feed.complete) {
    const listed = new Set(feed.listed ?? []);
    for (const guid of known.keys()) {
      if (listed.has(guid)) continue;
      const gone = await env.DB.prepare("delete from okoli_events where guid = ?").bind(guid).run();
      await env.DB.prepare("delete from okoli_seen where guid = ?").bind(guid).run();
      removed += Number(gone?.meta?.changes ?? 0);
    }
  }
  return { added, removed };
}

// Stejný tvar jako akce v kalendáři (`mapEvent`), navíc město, vzdálenost a zdroj. Odkaz vede na web pořadatele.
export function mapNearbyEvent(row) {
  const source = nearbySource(String(row.source));
  return {
    id: Number(row.id),
    title: String(row.title),
    place: String(row.place ?? ""),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    startsTime: String(row.starts_time ?? ""),
    endsTime: String(row.ends_time ?? ""),
    endsOn: String(row.ends_on ?? ""),
    description: String(row.description ?? ""),
    published: !asBool(row.hidden),
    link: String(row.link ?? ""),
    articleId: null,
    articleSlug: "",
    nearby: true,
    town: String(row.town ?? ""),
    km: Number(row.km ?? 0),
    kind: String(row.kind ?? ""),
    soldOut: asBool(row.sold_out),
    source: String(row.source),
    sourceName: source?.name ?? String(row.source),
    hidden: asBool(row.hidden),
  };
}

// Akce z okolí, které od `from` do `to` (včetně) probíhají. `radiusKm` vynechá vzdálenější, schované jen s `withHidden`.
export async function loadNearbyEvents(env, { from, to = "9999-12-31", radiusKm = null, withHidden = false, limit = 400 } = {}) {
  const where = [`${LAST_DAY} >= ?`, "starts_on <= ?"];
  const binds = [from, to];
  if (radiusKm) {
    where.push("km <= ?");
    binds.push(radiusKm);
  }
  if (!withHidden) where.push("hidden = 0");
  const rows = await env.DB.prepare(
    `select * from okoli_events where ${where.join(" and ")} order by starts_on asc, starts_time asc, id asc limit ?`,
  )
    .bind(...binds, limit)
    .all();
  return (rows.results ?? []).map(mapNearbyEvent);
}

export async function hideNearbyEvent(env, request, id, hidden) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  if (!id) return { ok: false, error: "Ta akce tu není." };
  await env.DB.prepare("update okoli_events set hidden = ? where id = ?").bind(hidden ? 1 : 0, id).run();
  return { ok: true };
}

// Kolik budoucích akcí má každý zdroj a kdy z něj naposledy něco přišlo (pro redakci, hlavně u zdroje přes GitHub).
export async function countBySource(env, today) {
  const rows = await env.DB.prepare(
    `select source, sum(case when ${LAST_DAY} >= ? then 1 else 0 end) as n, max(seen_at) as seen from okoli_events group by source`,
  )
    .bind(today)
    .all();
  const stats = new Map((rows.results ?? []).map((row) => [String(row.source), row]));
  return NEARBY_SOURCES.map((source) => {
    const row = stats.get(source.tag);
    return { ...source, upcoming: Number(row?.n ?? 0), seenAt: row?.seen ? `${String(row.seen).replace(" ", "T")}Z` : "" };
  });
}
