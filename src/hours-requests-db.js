// Žádosti o změnu u sběrných dvorů, lékařů a otevírací doby od lidí s oprávněním „ke schválení“.
// Na web nejdou, dokud je hlavní redaktor neschválí (může je i upravit). Schválení zapíše změnu
// stejnou cestou, jako by ji zapsal člověk s plným oprávněním, autorem změny zůstane žadatel.
//
// Každá sekce dává `actions`: { [akce]: { read(input) → hodnota | {error}, target(env, id) → bool, apply(env, id, hodnota, userId) } }.
import { clip, requireChief, requireUser, userCan } from "./db-core.js";

// Klíč je adresa sekce v redakci.
export const REQUEST_SECTIONS = {
  dvory: {
    direct: "sberny_dvur",
    request: "sberny_dvur_navrh",
    label: "Sběrné dvory",
    denied: "Mimořádné uzavření zapíše hlavní redaktor, nebo člověk s oprávněním na sběrný dvůr.",
  },
  lekari: {
    direct: "doktori",
    request: "doktori_navrh",
    label: "Lékaři",
    denied: "Ordinační hodiny mění hlavní redaktor, nebo člověk s oprávněním Lékaři.",
  },
  "oteviraci-doba": {
    direct: "oteviraci_doba",
    request: "oteviraci_doba_navrh",
    label: "Otevírací doba",
    denied: "Otevírací dobu mění hlavní redaktor, nebo člověk s oprávněním Otevírací doba.",
  },
};

// Zamítnuté žádosti žadatel vidí, dokud je nesmaže, nejdéle tolik dní.
const KEEP_REJECTED_DAYS = 30;

export const REQUEST_TABLES = [
  `create table if not exists hours_requests (
    id integer primary key autoincrement,
    section text not null,
    action text not null,
    target_id integer not null,
    payload text not null default '{}',
    status text not null default 'pending',
    reply text not null default '',
    created_by integer not null,
    created_at text not null default (datetime('now'))
  )`,
  "create index if not exists hours_requests_section on hours_requests (section, status, id)",
];

export async function ensureRequestTables(env) {
  for (const sql of REQUEST_TABLES) await env.DB.prepare(sql).run();
}

// „direct“ zapisuje rovnou, „request“ posílá ke schválení, null sekci nevidí. Plné oprávnění má přednost.
export function hoursMode(user, section) {
  const rules = REQUEST_SECTIONS[section];
  if (!user || !rules) return null;
  if (userCan(user, rules.direct)) return "direct";
  if (userCan(user, rules.request)) return "request";
  return null;
}

export function canSeeHours(user, section) {
  return hoursMode(user, section) !== null;
}

function parsePayload(text) {
  try {
    const value = JSON.parse(String(text ?? "{}"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function mapRequest(row) {
  return {
    id: Number(row.id),
    section: String(row.section),
    action: String(row.action),
    targetId: Number(row.target_id),
    value: parsePayload(row.payload),
    status: row.status === "rejected" ? "rejected" : "pending",
    reply: String(row.reply ?? ""),
    createdBy: Number(row.created_by),
    author: String(row.author ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

// Hlavní redaktor vidí všechno, co čeká, ostatní své čekající i zamítnuté. Jen sekce, které člověk vidí.
export async function loadRequests(env, user) {
  const out = Object.fromEntries(Object.keys(REQUEST_SECTIONS).map((section) => [section, []]));
  if (!user) return out;
  const chief = user.role === "hlavni";
  const query = env.DB.prepare(
    `select r.id, r.section, r.action, r.target_id, r.payload, r.status, r.reply, r.created_by, r.created_at, u.name as author
     from hours_requests r left join users u on u.id = r.created_by
     where ${chief ? "r.status = 'pending'" : "r.created_by = ?"} order by r.id asc`,
  );
  const rows = chief ? await query.all() : await query.bind(user.id).all();
  for (const row of rows.results ?? []) {
    const request = mapRequest(row);
    if (out[request.section] && canSeeHours(user, request.section)) out[request.section].push(request);
  }
  return out;
}

// Zapíše rovnou, nebo pošle ke schválení, podle oprávnění. Hodnota se kontroluje stejně v obou případech.
export async function submitHours(env, request, { section, actions, action, targetId, input }) {
  const rules = REQUEST_SECTIONS[section];
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const mode = hoursMode(gate.user, section);
  if (!mode) return { ok: false, error: rules.denied };
  const spec = actions[action];
  const value = spec.read(input);
  if (value.error) return { ok: false, error: value.error };
  if (!targetId || !(await spec.target(env, targetId))) return { ok: false, error: spec.missing };
  if (mode === "direct") return { ...(await spec.apply(env, targetId, value, gate.user.id)), value };
  await env.DB.prepare(
    `delete from hours_requests where status = 'rejected' and created_at < datetime('now', '-${KEEP_REJECTED_DAYS} days')`,
  ).run();
  await env.DB.prepare("insert into hours_requests (section, action, target_id, payload, created_by) values (?, ?, ?, ?, ?)")
    .bind(section, action, targetId, JSON.stringify(value), gate.user.id)
    .run();
  return { ok: true, requested: true, value };
}

async function pendingRequest(env, section, id) {
  const row = await env.DB.prepare("select * from hours_requests where id = ? and section = ? and status = 'pending'").bind(id ?? 0, section).first();
  return row ? mapRequest(row) : null;
}

// Hlavní redaktor žádost schválí; pole formuláře můžou být upravená. Akce bez polí (zrušení) vezme uloženou hodnotu.
export async function approveRequest(env, request, { section, actions, id, input }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const found = await pendingRequest(env, section, id);
  if (!found) return { ok: false, error: "Tahle žádost už nečeká." };
  const spec = actions[found.action];
  if (!spec) return { ok: false, error: "Téhle žádosti nerozumím." };
  const value = spec.fields === false ? found.value : spec.read(input);
  if (value.error) return { ok: false, error: value.error };
  if (!(await spec.target(env, found.targetId))) {
    await env.DB.prepare("delete from hours_requests where id = ?").bind(found.id).run();
    return { ok: false, error: `${spec.missing} Žádost je smazaná.` };
  }
  const result = await spec.apply(env, found.targetId, value, found.createdBy);
  if (!result.ok) return result;
  await env.DB.prepare("delete from hours_requests where id = ?").bind(found.id).run();
  return { ok: true, value };
}

export async function rejectRequest(env, request, { section, id, reply }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const found = await pendingRequest(env, section, id);
  if (!found) return { ok: false, error: "Tahle žádost už nečeká." };
  await env.DB.prepare("update hours_requests set status = 'rejected', reply = ? where id = ?").bind(clip(reply, 400), found.id).run();
  return { ok: true };
}

// Žadatel svou žádost stáhne (čekající) nebo smaže (zamítnutou).
export async function withdrawRequest(env, request, { section, id }) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from hours_requests where id = ? and section = ? and created_by = ?").bind(id ?? 0, section, gate.user.id).run();
  return { ok: true };
}
