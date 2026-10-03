// Návštěvy v D1: denní součty (napořád), dnešní otisky návštěvníků a denní sůl (obojí se druhý den maže).
import { wrote } from "./db-core.js";
import { newSalt, visitorHash, visitSource } from "./visits.js";
import { addDays, pragueNow } from "./waste.js";

const TABLES = [
  `create table if not exists visit_days (
    day text primary key,
    views integer not null default 0,
    visitors integer not null default 0
  )`,
  `create table if not exists visit_pages (
    day text not null,
    path text not null,
    views integer not null default 0,
    primary key (day, path)
  )`,
  `create table if not exists visit_sources (
    day text not null,
    source text not null,
    visitors integer not null default 0,
    primary key (day, source)
  )`,
  `create table if not exists visit_totals (
    path text primary key,
    views integer not null default 0
  )`,
  `create table if not exists visit_seen (
    day text not null,
    hash text not null,
    primary key (day, hash)
  )`,
  `create table if not exists visit_salt (
    day text primary key,
    salt text not null
  )`,
];

export async function ensureVisitTables(env) {
  for (const sql of TABLES) await env.DB.prepare(sql).run();
}

// Sůl si instance pamatuje do konce dne. Když přijde nový den, smažou se včerejší otisky i sůl.
let saltCache = { day: "", salt: "" };

async function daySalt(env, day) {
  if (saltCache.day === day) return saltCache.salt;
  await env.DB.prepare("insert or ignore into visit_salt (day, salt) values (?, ?)").bind(day, newSalt()).run();
  const row = await env.DB.prepare("select salt from visit_salt where day = ?").bind(day).first();
  await env.DB.batch([
    env.DB.prepare("delete from visit_salt where day < ?").bind(day),
    env.DB.prepare("delete from visit_seen where day < ?").bind(day),
  ]);
  saltCache = { day, salt: String(row.salt) };
  return saltCache.salt;
}

// Dnešní otisk návštěvníka (bez cookies a IP). Používá ho i chat na denní limit otázek.
export async function dayVisitor(env, request, day) {
  const salt = await daySalt(env, day);
  return visitorHash(salt, request.headers.get("cf-connecting-ip"), request.headers.get("user-agent"));
}

export async function recordVisit(env, request, path, now = new Date()) {
  const day = pragueNow(now).date;
  const headers = request.headers;
  const hash = await dayVisitor(env, request, day);
  const fresh = wrote(await env.DB.prepare("insert or ignore into visit_seen (day, hash) values (?, ?)").bind(day, hash).run());
  const add = fresh ? 1 : 0;
  const writes = [
    env.DB.prepare(
      `insert into visit_days (day, views, visitors) values (?, 1, ?)
       on conflict(day) do update set views = views + 1, visitors = visitors + excluded.visitors`,
    ).bind(day, add),
    env.DB.prepare(
      `insert into visit_pages (day, path, views) values (?, ?, 1)
       on conflict(day, path) do update set views = views + 1`,
    ).bind(day, path),
    env.DB.prepare(
      `insert into visit_totals (path, views) values (?, 1)
       on conflict(path) do update set views = views + 1`,
    ).bind(path),
  ];
  // Odkud přišel, se počítá jednou za den, podle první stránky, kterou ten den otevřel.
  if (fresh) {
    const source = visitSource(headers.get("referer"), new URL(request.url).hostname);
    writes.push(
      env.DB.prepare(
        `insert into visit_sources (day, source, visitors) values (?, ?, 1)
         on conflict(day, source) do update set visitors = visitors + 1`,
      ).bind(day, source),
    );
  }
  await env.DB.batch(writes);
}

export async function pathViews(env, path) {
  const row = await env.DB.prepare("select views from visit_totals where path = ?").bind(path).first();
  return Number(row?.views ?? 0);
}

function sumDays(days, from, to) {
  const rows = days.filter((row) => row.day >= from && row.day <= to);
  return {
    views: rows.reduce((sum, row) => sum + row.views, 0),
    visitors: rows.reduce((sum, row) => sum + row.visitors, 0),
    days: rows.length,
  };
}

export const STAT_PERIODS = [7, 30, 90];

export async function loadStats(env, period, now = new Date()) {
  const today = pragueNow(now).date;
  const span = Math.max(period, 30);
  const since = addDays(today, -(span - 1));
  const from = addDays(today, -(period - 1));
  const rows = (await env.DB.prepare("select day, views, visitors from visit_days where day >= ? order by day").bind(since).all()).results ?? [];
  const byDay = new Map(rows.map((row) => [String(row.day), { views: Number(row.views), visitors: Number(row.visitors) }]));
  const days = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    days.push({ day, ...(byDay.get(day) ?? { views: 0, visitors: 0 }) });
  }
  const pages = (
    await env.DB.prepare(
      `select p.path, sum(p.views) as views, max(a.title) as title
       from visit_pages p left join articles a on p.path = '/zpravy/' || a.slug
       where p.day >= ? group by p.path order by views desc, p.path limit 15`,
    )
      .bind(from)
      .all()
  ).results ?? [];
  const sources = (
    await env.DB.prepare(
      "select source, sum(visitors) as visitors from visit_sources where day >= ? group by source order by visitors desc, source limit 12",
    )
      .bind(from)
      .all()
  ).results ?? [];
  const yesterday = addDays(today, -1);
  return {
    today,
    period,
    chart: days.slice(-period),
    todayTotals: sumDays(days, today, today),
    yesterdayTotals: sumDays(days, yesterday, yesterday),
    week: sumDays(days, addDays(today, -6), today),
    month: sumDays(days, addDays(today, -29), today),
    periodTotals: sumDays(days, from, today),
    pages: pages.map((row) => ({ path: String(row.path), views: Number(row.views), title: row.title ? String(row.title) : "" })),
    sources: sources.map((row) => ({ source: String(row.source), visitors: Number(row.visitors) })),
  };
}
