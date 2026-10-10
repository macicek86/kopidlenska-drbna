// Sběrné dvory v D1: dvory, jejich otevírací doba a mimořádná uzavření.
import { asBool, clip, requireChief } from "./db-core.js";
import { submitHours } from "./hours-requests-db.js";
import { removeLinksOf } from "./hours-links-db.js";
import { removeMailTargetsOf } from "./mailin/store.js";
import { closureSpan, normalizeWeek, parseHours, weekOfChange } from "./yards.js";

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
    changes: [],
  };
}

function mapClosure(row) {
  return {
    id: Number(row.id),
    yardId: Number(row.yard_id),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    reason: String(row.reason ?? ""),
    // Týden dočasné jiné doby (jeden úsek denně), bez něj je to zavření.
    week: weekOfChange(row.hours),
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
  let closureSql = "select id, yard_id, starts_on, ends_on, reason, hours, created_by from yard_closures";
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
    if (yard) (closure.week ? yard.changes : yard.closures).push(closure);
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
  await removeLinksOf(env, "dvory", id);
  await removeMailTargetsOf(env, "dvory", id);
  await env.DB.prepare("delete from yards where id = ?").bind(id).run();
  return { ok: true };
}

// Zavření (bez `week`), nebo dočasná jiná doba (`week`: sedm dní, v jednom aspoň jeden otevřený úsek).
// Týden bez otevřeného dne je zavření.
function readClosure(input) {
  const span = closureSpan(input.startsOn, input.endsOn);
  if (span.error) return span;
  const reason = clip(input.reason, 400);
  if (reason.length < 3) return { error: "Napište důvod uzavření nebo změny." };
  const value = { startsOn: span.startsOn, endsOn: span.endsOn, reason };
  const slots = input.week;
  if (!Array.isArray(slots) || !slots.some((slot) => slot?.open)) return value;
  const normalized = normalizeWeek(slots);
  if (normalized.error) return normalized;
  return { ...value, week: normalized.week };
}

async function yardExists(env, id) {
  return Boolean(await env.DB.prepare("select id from yards where id = ?").bind(id).first());
}

function readYardHours(input) {
  const normalized = normalizeWeek(input.week);
  return normalized.error ? normalized : { week: normalized.week };
}

// Místo a co se tam vozí. Název mění jen hlavní redaktor.
function readYardDetails(input) {
  const place = clip(input.place, 160);
  const accepts = clip(input.accepts, 1200);
  if (place.length < 2) return { error: "Doplňte místo." };
  if (accepts.length < 3) return { error: "Napište, co se tam vozí." };
  return { place, accepts };
}

// Zavření i dočasná jiná doba jsou jeden druh záznamu. `uzavreni` zůstává kvůli starším žádostem a e-mailům.
const CLOSURE_ACTION = {
  read: readClosure,
  target: yardExists,
  missing: "Tenhle sběrný dvůr už tu není.",
  apply: async (env, yardId, value, userId) => {
    await env.DB.prepare("insert into yard_closures (yard_id, starts_on, ends_on, reason, hours, created_by) values (?, ?, ?, ?, ?, ?)")
      .bind(yardId, value.startsOn, value.endsOn, value.reason, value.week ? JSON.stringify(value.week) : null, userId)
      .run();
    return { ok: true };
  },
};

// Co jde u dvora zapsat rovnou nebo poslat ke schválení (src/hours-requests-db.js).
export const YARD_ACTIONS = {
  hodiny: {
    read: readYardHours,
    target: yardExists,
    missing: "Tenhle sběrný dvůr už tu není.",
    apply: async (env, yardId, value) => {
      await env.DB.prepare("update yards set hours = ? where id = ?").bind(JSON.stringify(value.week), yardId).run();
      return { ok: true };
    },
  },
  udaje: {
    read: readYardDetails,
    target: yardExists,
    missing: "Tenhle sběrný dvůr už tu není.",
    apply: async (env, yardId, value) => {
      await env.DB.prepare("update yards set place = ?, accepts = ? where id = ?").bind(value.place, value.accepts, yardId).run();
      return { ok: true };
    },
  },
  uzavreni: CLOSURE_ACTION,
  zmena: CLOSURE_ACTION,
  zrusit: {
    fields: false,
    read: () => ({}),
    target: async (env, id) => Boolean(await env.DB.prepare("select id from yard_closures where id = ?").bind(id).first()),
    missing: "Tohle uzavření už tu není.",
    apply: async (env, closureId) => {
      await env.DB.prepare("delete from yard_closures where id = ?").bind(closureId).run();
      return { ok: true };
    },
  },
};

const submit = (env, request, action, targetId, input = {}) =>
  submitHours(env, request, { section: "dvory", actions: YARD_ACTIONS, action, targetId, input });

export const saveYardHours = (env, request, input) => submit(env, request, "hodiny", input.yardId, input);
export const saveYardDetails = (env, request, input) => submit(env, request, "udaje", input.yardId, input);
export const saveClosure = (env, request, input) => submit(env, request, "zmena", input.yardId, input);
export const removeClosure = (env, request, id) => submit(env, request, "zrusit", id);
