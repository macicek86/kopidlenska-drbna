// Pomocník při psaní v D1: limity pro přispěvatele a denní součty (kolikrát, kdo, za kolik).
// Hlavní redaktor limity nemá, jeho použití se jen započítá do přehledu.
import { requireChief } from "../db-core.js";
import { USD_CZK } from "../chat/ai.js";
import { addDays } from "../waste.js";

export const ASSIST_PERMISSION = "ai_pomocnik";
export const ASSIST_DEFAULTS = { perDay: 20, budget: 100 };
export const ASSIST_BOUNDS = { perDay: [1, 500], budget: [0, 100000] };
// Denní součty se po roce mažou, přehled ukazuje jen tenhle a minulý měsíc.
const KEEP_DAYS = 400;

export const ASSIST_TABLES = [
  `create table if not exists assist_settings (
    id integer primary key,
    per_day integer not null default 20,
    budget_czk integer not null default 100
  )`,
  `create table if not exists assist_days (
    day text not null,
    user_id integer not null,
    chief integer not null default 0,
    uses integer not null default 0,
    failed integer not null default 0,
    cost_usd real not null default 0,
    primary key (day, user_id)
  )`,
];

export async function ensureAssistTables(env) {
  for (const sql of ASSIST_TABLES) await env.DB.prepare(sql).run();
  await env.DB.prepare("insert or ignore into assist_settings (id) values (1)").run();
}

function bounded(value, [min, max], fallback) {
  const number = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export async function loadAssistSettings(env) {
  const row = await env.DB.prepare("select per_day, budget_czk from assist_settings where id = 1").first();
  return {
    perDay: bounded(row?.per_day, ASSIST_BOUNDS.perDay, ASSIST_DEFAULTS.perDay),
    budget: bounded(row?.budget_czk, ASSIST_BOUNDS.budget, ASSIST_DEFAULTS.budget),
  };
}

export function readAssistSettings(fields) {
  return {
    perDay: bounded(fields.assistPerDay, ASSIST_BOUNDS.perDay, ASSIST_DEFAULTS.perDay),
    budget: bounded(fields.assistBudget, ASSIST_BOUNDS.budget, ASSIST_DEFAULTS.budget),
  };
}

export async function saveAssistSettings(env, request, fields) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const value = readAssistSettings(fields);
  await env.DB.prepare("update assist_settings set per_day = ?, budget_czk = ? where id = 1").bind(value.perDay, value.budget).run();
  return { ok: true };
}

const monthStart = (day) => `${day.slice(0, 7)}-01`;

// Smí přispěvatel teď pomocníka použít? Vrací null, nebo důvod: "den" (jeho denní limit), "mesic" (rozpočet přispěvatelů).
export async function assistLimit(env, settings, { day, userId }) {
  const [mine, month] = await Promise.all([
    env.DB.prepare("select uses from assist_days where day = ? and user_id = ?").bind(day, userId).first(),
    env.DB.prepare("select coalesce(sum(cost_usd), 0) as cost from assist_days where day >= ? and chief = 0").bind(monthStart(day)).first(),
  ]);
  if (Number(mine?.uses ?? 0) >= settings.perDay) return "den";
  if (Number(month?.cost ?? 0) * USD_CZK >= settings.budget) return "mesic";
  return null;
}

// Použití se započítá hned, ať souběžná kliknutí limit nepřelezou. Vrací, kolikrát dnes ještě smí.
export async function countAssist(env, settings, { day, userId, chief }) {
  await env.DB.batch([
    env.DB.prepare(
      `insert into assist_days (day, user_id, chief, uses) values (?, ?, ?, 1)
       on conflict(day, user_id) do update set uses = uses + 1`,
    ).bind(day, userId, chief ? 1 : 0),
    env.DB.prepare("delete from assist_days where day < ?").bind(addDays(day, -KEEP_DAYS)),
  ]);
  const row = await env.DB.prepare("select uses from assist_days where day = ? and user_id = ?").bind(day, userId).first();
  return Math.max(0, settings.perDay - Number(row?.uses ?? 0));
}

export async function recordAssist(env, { day, userId, ok, cost }) {
  await env.DB.prepare("update assist_days set failed = failed + ?, cost_usd = cost_usd + ? where day = ? and user_id = ?")
    .bind(ok ? 0 : 1, Number(cost) || 0, day, userId)
    .run();
}

// Přehled pro stránku Koza Drběna: tenhle a minulý měsíc, kdo kolikrát a za kolik.
export async function loadAssistAdmin(env, today) {
  const thisMonth = monthStart(today);
  const lastMonth = monthStart(addDays(thisMonth, -1));
  const [settings, rows] = await Promise.all([
    loadAssistSettings(env),
    env.DB.prepare(
      `select substr(d.day, 1, 7) as month, d.user_id, d.chief, coalesce(u.name, '') as name,
         sum(d.uses) as uses, sum(d.failed) as failed, sum(d.cost_usd) as cost
       from assist_days d left join users u on u.id = d.user_id
       where d.day >= ? group by month, d.user_id order by uses desc`,
    )
      .bind(lastMonth)
      .all(),
  ]);
  const month = (prefix) => {
    const people = (rows.results ?? [])
      .filter((row) => row.month === prefix)
      .map((row) => ({
        name: String(row.name || "Smazaný účet"),
        chief: Boolean(row.chief),
        uses: Number(row.uses),
        failed: Number(row.failed),
        czk: Number(row.cost) * USD_CZK,
      }));
    const sum = (list) => list.reduce((total, row) => total + row.czk, 0);
    return { people, czk: sum(people), contributorsCzk: sum(people.filter((row) => !row.chief)) };
  };
  return { settings, thisMonth: month(thisMonth.slice(0, 7)), lastMonth: month(lastMonth.slice(0, 7)) };
}
