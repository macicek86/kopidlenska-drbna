// Žádosti o změnu u sběrných dvorů, lékařů a otevírací doby od lidí s oprávněním „ke schválení“.
// Na web nejdou, dokud je hlavní redaktor neschválí (může je i upravit). Schválení zapíše změnu
// stejnou cestou, jako by ji zapsal člověk s plným oprávněním, autorem změny zůstane žadatel.
//
// Každá sekce dává `actions`: { [akce]: { read(input) → hodnota | {error}, target(env, id) → bool, apply(env, id, hodnota, userId) } }.
import { addColumn, clip, requireChief, requireUser, userCan } from "./db-core.js";
import { notifyEditors } from "./notify.js";
import { answerRequester, mailOrigin, mailReplyText } from "./mailin/answer.js";

// Klíč je adresa sekce v redakci.
export const REQUEST_SECTIONS = {
  dvory: {
    direct: "sberny_dvur",
    request: "sberny_dvur_navrh",
    label: "Sběrné dvory",
    denied: "Zavření nebo jinou dobu dvora zapíše hlavní redaktor, nebo člověk s oprávněním na sběrný dvůr.",
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

// Co žádost chce, pro e-mail hlavnímu redaktorovi, a z jaké tabulky je jméno řádku (zrušení míří na změnu, ne na řádek).
const REQUEST_ACTIONS = {
  uzavreni: "mimořádné uzavření",
  hodiny: "oprava běžných hodin",
  zmena: "změna hodin",
  nabidka: "seznam „Co tu najdete“",
  udaje: "údaje (adresa, telefon…)",
  zrusit: "zrušení zapsané změny",
};
// Sběrné dvory mají záznam pro zavření i jinou dobu, jedna akce `zmena`.
const YARD_REQUEST = "mimořádné uzavření nebo jiná doba";
const REQUEST_ROWS = { dvory: "yards", lekari: "doctors", "oteviraci-doba": "places" };

async function requestNotice(env, author, { section, action, targetId, id, mail = null }) {
  const row =
    action === "zrusit" ? null : await env.DB.prepare(`select name from ${REQUEST_ROWS[section]} where id = ?`).bind(targetId).first();
  return notifyEditors(env, "hodiny", {
    subject: `Ke schválení: ${REQUEST_SECTIONS[section].label}${row?.name ? `, ${row.name}` : ""}`,
    intro: "Přišel návrh změny, čeká na schválení.",
    fields: [
      ["Od", author],
      ["Sekce", REQUEST_SECTIONS[section].label],
      ["Kde", row?.name ?? ""],
      ["Co", section === "dvory" && action === "zmena" ? YARD_REQUEST : (REQUEST_ACTIONS[action] ?? action)],
      ...(mail ? [["E-mail", mail.subject]] : []),
    ],
    body: mail?.text ?? "",
    path: `/redakce/${section}?zadost=${id}`,
  });
}

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
  // Žádosti z odkazu pro správce (src/hours-links-db.js): created_by je 0, jméno napsal žadatel.
  const info = await env.DB.prepare("pragma table_info(hours_requests)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "link_id", "alter table hours_requests add column link_id integer");
  await addColumn(env, names, "author_name", "alter table hours_requests add column author_name text not null default ''");
  // Žádost z e-mailu na otevírací dobu (src/mailin/): komu po rozhodnutí odepsat (JSON s adresou a vláknem).
  await addColumn(env, names, "mail_reply", "alter table hours_requests add column mail_reply text not null default ''");
}

// Kdo žádost z odkazu pro správce poslal, jak ho ukázat v redakci.
export function linkAuthor(name, linkLabel) {
  const who = clip(name, 80) || "Neznámý";
  return linkLabel ? `${who} (odkaz: ${linkLabel})` : `${who} (přes odkaz)`;
}

// Odkaz po použití zaniká, proto se jméno i s popiskem ukládá do žádosti hned (`author_name`). Starší žádosti mají
// jen jméno a popisek se k nim dohledá z odkazu, dokud existuje.
function linkedAuthor(name, linkLabel) {
  const text = String(name ?? "");
  return /\((odkaz: .*|přes odkaz)\)$/.test(text) ? text : linkAuthor(text, linkLabel);
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
    createdBy: Number(row.created_by) || null,
    linkId: row.link_id == null ? null : Number(row.link_id),
    author: row.link_id != null ? linkedAuthor(row.author_name, row.link_label) : String(row.author ?? row.author_name ?? ""),
    mailReply: String(row.mail_reply ?? ""),
    mail: mailOrigin(row.mail_reply),
    createdAt: String(row.created_at ?? ""),
  };
}

async function rowName(env, section, targetId) {
  const row = await env.DB.prepare(`select name from ${REQUEST_ROWS[section]} where id = ?`).bind(targetId).first();
  return String(row?.name ?? "");
}

// Hlavní redaktor vidí všechno, co čeká, ostatní své čekající i zamítnuté. Jen sekce, které člověk vidí.
export async function loadRequests(env, user) {
  const out = Object.fromEntries(Object.keys(REQUEST_SECTIONS).map((section) => [section, []]));
  if (!user) return out;
  const chief = user.role === "hlavni";
  const query = env.DB.prepare(
    `select r.id, r.section, r.action, r.target_id, r.payload, r.status, r.reply, r.created_by, r.link_id, r.author_name, r.mail_reply, r.created_at, u.name as author, l.label as link_label
     from hours_requests r left join users u on u.id = r.created_by left join hours_links l on l.id = r.link_id
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
  return fileHours(env, { section, actions, action, targetId, input, mode, userId: gate.user.id, author: gate.user.name });
}

// Společné pro redakci, odkaz pro správce (`linkId`) a e-mail na otevírací dobu (src/mailin/): bez `userId`
// je `author` jméno, které se uloží k žádosti (žadatel ho napsal, nebo je to adresa e-mailu).
export async function fileHours(env, { section, actions, action, targetId, input, mode, userId = null, author = "", linkId = null, linkLabel = "", mailReply = null }) {
  const spec = actions[action];
  if (!spec) return { ok: false, error: "Tahle změna tu nejde." };
  const value = spec.read(input);
  if (value.error) return { ok: false, error: value.error };
  if (!targetId || !(await spec.target(env, targetId))) return { ok: false, error: spec.missing };
  if (mode === "direct") return { ...(await spec.apply(env, targetId, value, userId)), value };
  await env.DB.prepare(
    `delete from hours_requests where status = 'rejected' and created_at < datetime('now', '-${KEEP_REJECTED_DAYS} days')`,
  ).run();
  const created = await env.DB.prepare(
    "insert into hours_requests (section, action, target_id, payload, created_by, link_id, author_name, mail_reply) values (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(section, action, targetId, JSON.stringify(value), userId ?? 0, linkId, userId ? "" : clip(linkId ? linkAuthor(author, linkLabel) : author, 160), mailReplyText(mailReply))
    .run();
  await requestNotice(env, linkId ? linkAuthor(author, linkLabel) : author, { section, action, targetId, id: Number(created.meta?.last_row_id ?? 0), mail: mailOrigin(mailReplyText(mailReply)) });
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
  if (found.mailReply && found.action !== "zrusit") {
    const name = await rowName(env, section, found.targetId);
    await answerRequester(env, { mailReply: found.mailReply, section, action: found.action, value, name, approved: true });
  }
  return { ok: true, value };
}

export async function rejectRequest(env, request, { section, id, reply }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const found = await pendingRequest(env, section, id);
  if (!found) return { ok: false, error: "Tahle žádost už nečeká." };
  await env.DB.prepare("update hours_requests set status = 'rejected', reply = ? where id = ?").bind(clip(reply, 400), found.id).run();
  if (found.mailReply && found.action !== "zrusit") {
    const name = await rowName(env, section, found.targetId);
    await answerRequester(env, { mailReply: found.mailReply, section, action: found.action, value: found.value, name, approved: false, reason: clip(reply, 400) });
  }
  return { ok: true };
}

// Žadatel svou žádost stáhne (čekající) nebo smaže (zamítnutou).
export async function withdrawRequest(env, request, { section, id }) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from hours_requests where id = ? and section = ? and created_by = ?").bind(id ?? 0, section, gate.user.id).run();
  return { ok: true };
}
