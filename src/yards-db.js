// Sběrné dvory v D1: dvory, jejich otevírací doba a mimořádná uzavření.
import { asBool, clip, requireChief, requireUser, userCan } from "./db-core.js";
import { closureSpan, normalizeWeek, parseHours } from "./yards.js";

function mapYard(row) {
  const hours = parseHours(row.hours);
  return {
    id: Number(row.id),
    name: String(row.name),
    place: String(row.place ?? ""),
    accepts: String(row.accepts ?? ""),
    week: hours.week,
    legacy: hours.legacy,
    sortOrder: Number(row.sort_order ?? 0),
    published: asBool(row.published),
    closures: [],
  };
}

function mapClosure(row) {
  return {
    id: Number(row.id),
    yardId: Number(row.yard_id),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    reason: String(row.reason ?? ""),
    createdBy: row.created_by == null || row.created_by === "" ? null : Number(row.created_by),
  };
}

export async function loadYards(env, { publicOnly = false, today = null } = {}) {
  const yardSql = publicOnly
    ? `select id, name, place, accepts, hours, sort_order, published
       from yards where published = 1 order by sort_order asc, id asc`
    : `select id, name, place, accepts, hours, sort_order, published
       from yards order by sort_order asc, id asc`;
  const yards = ((await env.DB.prepare(yardSql).all()).results ?? []).map(mapYard);
  if (!yards.length) return [];
  let closureSql = "select id, yard_id, starts_on, ends_on, reason, created_by from yard_closures";
  const binds = [];
  if (today) {
    closureSql += " where ends_on >= ?";
    binds.push(today);
  }
  closureSql += " order by starts_on asc, id asc";
  const query = env.DB.prepare(closureSql);
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  const byYard = new Map(yards.map((yard) => [yard.id, yard]));
  for (const row of rows.results ?? []) {
    const closure = mapClosure(row);
    const yard = byYard.get(closure.yardId);
    if (yard) yard.closures.push(closure);
  }
  return yards;
}

function readYard(input) {
  const name = clip(input.name, 120);
  const place = clip(input.place, 160);
  const accepts = clip(input.accepts, 1200);
  const normalized = normalizeWeek(input.week);
  if (normalized.error) return normalized;
  const hours = JSON.stringify(normalized.week);
  const sortOrder = Number(input.sortOrder);
  if (name.length < 2) return { error: "Doplňte název sběrného dvora." };
  if (place.length < 2) return { error: "Doplňte místo." };
  if (accepts.length < 3) return { error: "Napište, co se tam vozí." };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { error: "Pořadí musí být číslo od 0 do 999." };
  }
  return { name, place, accepts, hours, sortOrder, published: input.published ? 1 : 0 };
}

export async function saveYard(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = readYard(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  if (input.id) {
    const current = await env.DB.prepare("select id from yards where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tenhle sběrný dvůr už tu není." };
    await env.DB.prepare(
      "update yards set name = ?, place = ?, accepts = ?, hours = ?, sort_order = ?, published = ? where id = ?",
    )
      .bind(parsed.name, parsed.place, parsed.accepts, parsed.hours, parsed.sortOrder, parsed.published, input.id)
      .run();
    return { ok: true, updated: true };
  }
  await env.DB.prepare(
    "insert into yards (name, place, accepts, hours, sort_order, published) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(parsed.name, parsed.place, parsed.accepts, parsed.hours, parsed.sortOrder, parsed.published)
    .run();
  return { ok: true, updated: false };
}

export async function removeYard(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from yard_closures where yard_id = ?").bind(id).run();
  await env.DB.prepare("delete from yards where id = ?").bind(id).run();
  return { ok: true };
}

async function requireClosure(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (!userCan(gate.user, "sberny_dvur")) {
    return { ok: false, error: "Mimořádné uzavření zapíše hlavní redaktor, nebo člověk s oprávněním na sběrný dvůr." };
  }
  return gate;
}

export async function saveClosure(env, request, input) {
  const gate = await requireClosure(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const yard = await env.DB.prepare("select id from yards where id = ?").bind(input.yardId).first();
  if (!yard) return { ok: false, error: "Tenhle sběrný dvůr už tu není." };
  const span = closureSpan(input.startsOn, input.endsOn);
  if (span.error) return { ok: false, error: span.error };
  const reason = clip(input.reason, 400);
  if (reason.length < 3) return { ok: false, error: "Napište důvod uzavření." };
  await env.DB.prepare(
    "insert into yard_closures (yard_id, starts_on, ends_on, reason, created_by) values (?, ?, ?, ?, ?)",
  )
    .bind(yard.id, span.startsOn, span.endsOn, reason, gate.user.id)
    .run();
  return { ok: true };
}

export async function removeClosure(env, request, id) {
  const gate = await requireClosure(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from yard_closures where id = ?").bind(id).run();
  return { ok: true };
}
