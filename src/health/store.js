// Stav drbny: kdy se který zdroj naposledy stáhl, kolik v něm bylo a jestli šel, a jestli doběhly úlohy cronu.
// Zapisují importy (noteSource), cron (noteJob, trackJob); čte stránka redakce Stav (src/admin/health.js),
// upozornění e-mailem (src/health/check.js) a /stav.json pro hlídání zvenku. Zápis nikdy nezastaví import.
import { clip } from "../db-core.js";
import { CRON_STALE_HOURS } from "./rules.js";

export const HEALTH_TABLES = [
  `create table if not exists health (
    key text primary key,
    label text not null default '',
    page text not null default '',
    kind text not null default 'zdroj',
    tried_at text,
    ok_at text,
    items integer,
    empty_since text,
    error text not null default '',
    failing_since text,
    every_hours integer not null default 4,
    allow_empty integer not null default 0,
    off integer not null default 0,
    alerted text not null default ''
  )`,
];

export async function ensureHealthTables(env) {
  for (const sql of HEALTH_TABLES) await env.DB.prepare(sql).run();
}

// Jeden pokus o stažení. `items` je kolik ve zdroji bylo (null, když se nepřečetl), `error` co nešlo
// (i jen část, třeba jeden kanál ze dvou). `everyHours` jak často se stahuje (0 = nehlídat, že se nestahuje),
// `allowEmpty` zdroj, ve kterém někdy nic není (přehled budoucích akcí malé obce).
export async function noteSource(env, { key, label, page = "", kind = "zdroj", items = null, error = "", everyHours = 4, allowEmpty = false }, now = new Date()) {
  const at = now.toISOString();
  const count = items === null || items === undefined ? null : Number(items);
  try {
    await env.DB.prepare(
      `insert into health (key, label, page, kind, tried_at, ok_at, items, empty_since, error, failing_since, every_hours, allow_empty, off)
       values (?1, ?2, ?3, ?4, ?5, case when ?6 = '' then ?5 end, ?7, case when ?7 = 0 then ?5 end, ?6, case when ?6 <> '' then ?5 end, ?8, ?9, 0)
       on conflict (key) do update set
         label = excluded.label,
         page = excluded.page,
         kind = excluded.kind,
         tried_at = excluded.tried_at,
         ok_at = case when excluded.error = '' then excluded.tried_at else health.ok_at end,
         items = coalesce(excluded.items, health.items),
         empty_since = case when excluded.items is null then health.empty_since when excluded.items = 0 then coalesce(health.empty_since, excluded.tried_at) end,
         error = excluded.error,
         failing_since = case when excluded.error = '' then null else coalesce(health.failing_since, excluded.tried_at) end,
         every_hours = excluded.every_hours,
         allow_empty = excluded.allow_empty,
         off = 0`,
    )
      .bind(key, clip(label, 80), page, kind, at, clip(error, 300), count, Math.max(0, Number(everyHours) || 0), allowEmpty ? 1 : 0)
      .run();
  } catch {
    // Stav je jen navíc, import kvůli němu nesmí spadnout.
  }
}

// Zdroj je v redakci vypnutý: nehlídá se, dokud se zase nestáhne.
export async function noteOff(env, keys) {
  const list = [keys].flat().filter(Boolean);
  if (!list.length) return;
  try {
    await env.DB.prepare(`update health set off = 1 where key in (${list.map(() => "?").join(", ")})`).bind(...list).run();
  } catch {
    // Jako u noteSource.
  }
}

export function noteJob(env, { key, label }, error = "", now = new Date()) {
  return noteSource(env, { key: `cron:${key}`, label, kind: "uloha", error }, now);
}

// Úloha cronu: výjimku, kterou by cron jinak spolkl, zapíše do stavu.
export async function trackJob(env, job, work) {
  try {
    const result = await work();
    await noteJob(env, job);
    return result;
  } catch (error) {
    await noteJob(env, job, error instanceof Error ? error.message || error.name : String(error));
    return null;
  }
}

// Začátek běhu cronu. Podle něj /stav.json pozná, že cron běží.
export function noteCron(env, now = new Date()) {
  return noteSource(env, { key: "cron", label: "Cron (každé 4 hodiny)", kind: "cron" }, now);
}

function mapRow(row) {
  return {
    key: String(row.key),
    label: String(row.label ?? ""),
    page: String(row.page ?? ""),
    kind: String(row.kind ?? "zdroj"),
    triedAt: row.tried_at ? String(row.tried_at) : "",
    okAt: row.ok_at ? String(row.ok_at) : "",
    items: row.items === null || row.items === undefined ? null : Number(row.items),
    emptySince: row.empty_since ? String(row.empty_since) : "",
    error: String(row.error ?? ""),
    failingSince: row.failing_since ? String(row.failing_since) : "",
    everyHours: Number(row.every_hours ?? 4),
    allowEmpty: Boolean(row.allow_empty),
    off: Boolean(row.off),
    alerted: String(row.alerted ?? ""),
  };
}

export async function loadHealthRows(env) {
  try {
    const rows = await env.DB.prepare("select * from health order by kind, label").all();
    return (rows.results ?? []).map(mapRow);
  } catch {
    return [];
  }
}

export async function markAlerted(env, keys, state) {
  if (!keys.length) return;
  await env.DB.prepare(`update health set alerted = ? where key in (${keys.map(() => "?").join(", ")})`)
    .bind(state, ...keys)
    .run();
}

// /stav.json pro hlídání zvenku (UptimeRobot a podobné): 200, když cron běží, jinak 503. Nic víc neprozradí.
export async function statusResponse(env, now = new Date()) {
  let triedAt = "";
  try {
    const row = await env.DB.prepare("select tried_at from health where key = 'cron'").first();
    triedAt = row?.tried_at ? String(row.tried_at) : "";
  } catch {
    // Bez tabulky je to jako cron, který neběžel.
  }
  const parsed = Date.parse(triedAt);
  const fresh = Number.isFinite(parsed) && now.getTime() - parsed <= CRON_STALE_HOURS * 60 * 60 * 1000;
  return new Response(JSON.stringify({ cron: fresh ? "ok" : "stoji", at: triedAt || null }), {
    status: fresh ? 200 : 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "x-content-type-options": "nosniff" },
  });
}
