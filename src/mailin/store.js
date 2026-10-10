// E-mail na otevírací dobu: kdo smí psát (adresa, pro koho, které řádky, rovnou nebo ke schválení)
// a záznam přijatých e-mailů pro redakci. Seznam spravuje jen hlavní redaktor (src/admin/mailin.js).
import { addColumn, clip, requireChief } from "../db-core.js";
import { REQUEST_SECTIONS } from "../hours-requests-db.js";
import { waitingRequests } from "./register.js";
import { pragueNow } from "../waste.js";

// Kolik e-mailů od jedné adresy denně Drběna zpracuje (proti zacyklení s automatickou odpovědí a spamu).
export const MAIL_DAILY_LIMIT = 20;
// Jak dlouho drží záznam přijatých e-mailů.
const KEEP_LOG_DAYS = 90;

export const MAILIN_TABLES = [
  `create table if not exists mail_senders (
    id integer primary key autoincrement,
    email text not null unique,
    label text not null default '',
    direct integer not null default 1,
    used_on text not null default '',
    used_count integer not null default 0,
    last_used_at text,
    created_by integer,
    created_at text not null default (datetime('now'))
  )`,
  `create table if not exists mail_sender_targets (
    sender_id integer not null,
    section text not null,
    target_id integer not null,
    primary key (sender_id, section, target_id)
  )`,
  `create table if not exists mail_log (
    id integer primary key autoincrement,
    sender_email text not null,
    sender_id integer,
    subject text not null default '',
    excerpt text not null default '',
    status text not null,
    result text not null default '',
    verified integer not null default 0,
    auth text not null default '',
    created_at text not null default (datetime('now'))
  )`,
  "create index if not exists mail_log_sender on mail_log (sender_email, created_at)",
  // Změny z e-mailu, které čekají na potvrzení odesílatelem (src/mailin/pending.js). `items` je JSON změn,
  // `token` je v odkazech z e-mailu, `due_at` kdy se zapíšou samy, `log_id` řádek v mail_log, který se po vyřízení přepíše.
  `create table if not exists mail_pending (
    id integer primary key autoincrement,
    token text not null unique,
    sender_id integer not null,
    email text not null,
    subject text not null default '',
    message_id text not null default '',
    refs text not null default '',
    items text not null default '[]',
    text text not null default '',
    who text not null default '',
    status text not null default 'ceka',
    result text not null default '',
    log_id integer,
    verified integer not null default 1,
    to_web integer not null default 1,
    due_at text not null,
    created_at text not null default (datetime('now')),
    decided_at text
  )`,
  "create index if not exists mail_pending_due on mail_pending (status, due_at)",
  // Žádost neznámé (ale ověřené) adresy o povolení psát: její první e-mail čeká, až ho redakce povolí.
  `create table if not exists mail_requests (
    id integer primary key autoincrement,
    email text not null unique,
    subject text not null default '',
    text text not null default '',
    message_id text not null default '',
    refs text not null default '',
    status text not null default 'ceka',
    kind text not null default 'adresa',
    draft text not null default '',
    created_at text not null default (datetime('now'))
  )`,
];

export async function ensureMailinTables(env) {
  for (const sql of MAILIN_TABLES) await env.DB.prepare(sql).run();
  // `verified`: e-mail prošel ověřením odesílatele, `to_web`: po čekání jde na web (jinak ke schválení redakci).
  const info = await env.DB.prepare("pragma table_info(mail_pending)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "text", "alter table mail_pending add column text text not null default ''");
  // Žádost o povolení adresy (`adresa`), nebo o založení nového místa (`misto`, `draft` je JSON s návrhem).
  const requests = await env.DB.prepare("pragma table_info(mail_requests)").all();
  const requestNames = new Set((requests.results ?? []).map((row) => row.name));
  await addColumn(env, requestNames, "kind", "alter table mail_requests add column kind text not null default 'adresa'");
  await addColumn(env, requestNames, "draft", "alter table mail_requests add column draft text not null default ''");
  await addColumn(env, names, "verified", "alter table mail_pending add column verified integer not null default 1");
  await addColumn(env, names, "to_web", "alter table mail_pending add column to_web integer not null default 1");
}

export function normalEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160 ? email : "";
}

// Zaškrtnutý řádek ve formuláři je „sekce:id“ (oteviraci-doba:3, lekari:1, dvory:2).
export function readTargets(values) {
  const out = [];
  for (const value of values ?? []) {
    const match = String(value).match(/^([a-z-]+):(\d+)$/);
    if (match && REQUEST_SECTIONS[match[1]]) out.push({ section: match[1], targetId: Number(match[2]) });
  }
  return out;
}

function mapSender(row, targets) {
  return {
    id: Number(row.id),
    email: String(row.email),
    label: String(row.label ?? ""),
    direct: Number(row.direct) === 1,
    usedOn: String(row.used_on ?? ""),
    usedCount: Number(row.used_count ?? 0),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : "",
    targets,
  };
}

async function targetsOf(env, ids) {
  if (!ids.length) return new Map();
  const rows = await env.DB.prepare(
    `select sender_id, section, target_id from mail_sender_targets where sender_id in (${ids.map(() => "?").join(",")}) order by section, target_id`,
  )
    .bind(...ids)
    .all();
  const out = new Map(ids.map((id) => [id, []]));
  for (const row of rows.results ?? []) out.get(Number(row.sender_id))?.push({ section: String(row.section), targetId: Number(row.target_id) });
  return out;
}

export async function senderById(env, id) {
  const row = await env.DB.prepare("select * from mail_senders where id = ?").bind(id ?? 0).first();
  if (!row) return null;
  const targets = await targetsOf(env, [Number(row.id)]);
  return mapSender(row, targets.get(Number(row.id)) ?? []);
}

export async function senderByEmail(env, email) {
  const address = normalEmail(email);
  if (!address) return null;
  const row = await env.DB.prepare("select * from mail_senders where email = ?").bind(address).first();
  if (!row) return null;
  const targets = await targetsOf(env, [Number(row.id)]);
  return mapSender(row, targets.get(Number(row.id)) ?? []);
}

function mapLog(row) {
  return {
    id: Number(row.id),
    email: String(row.sender_email),
    subject: String(row.subject ?? ""),
    excerpt: String(row.excerpt ?? ""),
    status: String(row.status),
    result: String(row.result ?? ""),
    verified: Number(row.verified) === 1,
    auth: String(row.auth ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

// Pro stránku redakce: adresy s řádky a posledních 50 e-mailů.
export async function loadMailAdmin(env) {
  const rows = (await env.DB.prepare("select * from mail_senders order by label collate nocase, email").all()).results ?? [];
  const targets = await targetsOf(env, rows.map((row) => Number(row.id)));
  const log = (await env.DB.prepare("select * from mail_log order by id desc limit 50").all()).results ?? [];
  return {
    senders: rows.map((row) => mapSender(row, targets.get(Number(row.id)) ?? [])),
    log: log.map(mapLog),
    requests: await waitingRequests(env),
  };
}

export async function saveSender(env, request, { id, email, label, direct, targets }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const address = normalEmail(email);
  if (!address) return { ok: false, error: "Napište platnou e-mailovou adresu." };
  const chosen = readTargets(targets);
  if (!chosen.length) return { ok: false, error: "Zaškrtněte aspoň jedno místo, lékaře nebo sběrný dvůr." };
  const taken = await env.DB.prepare("select id from mail_senders where email = ? and id <> ?").bind(address, id ?? 0).first();
  if (taken) return { ok: false, error: "Tahle adresa už v seznamu je." };
  let senderId = id;
  if (id) {
    const found = await env.DB.prepare("select id from mail_senders where id = ?").bind(id).first();
    if (!found) return { ok: false, error: "Tahle adresa už tu není." };
    await env.DB.prepare("update mail_senders set email = ?, label = ?, direct = ? where id = ?").bind(address, clip(label, 80), direct ? 1 : 0, id).run();
  } else {
    const created = await env.DB.prepare("insert into mail_senders (email, label, direct, created_by) values (?, ?, ?, ?)")
      .bind(address, clip(label, 80), direct ? 1 : 0, gate.user.id)
      .run();
    senderId = Number(created.meta?.last_row_id ?? 0);
  }
  await env.DB.batch([
    env.DB.prepare("delete from mail_sender_targets where sender_id = ?").bind(senderId),
    ...chosen.map((target) =>
      env.DB.prepare("insert or ignore into mail_sender_targets (sender_id, section, target_id) values (?, ?, ?)").bind(senderId, target.section, target.targetId),
    ),
  ]);
  return { ok: true };
}

export async function removeSender(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.batch([
    env.DB.prepare("delete from mail_sender_targets where sender_id = ?").bind(id ?? 0),
    env.DB.prepare("delete from mail_senders where id = ?").bind(id ?? 0),
  ]);
  return { ok: true };
}

// Smazaný řádek (místo, ordinace, dvůr) zmizí i z adres, které ho smějí měnit.
export async function removeMailTargetsOf(env, section, targetId) {
  await env.DB.prepare("delete from mail_sender_targets where section = ? and target_id = ?").bind(section, targetId).run();
}

export function senderHasRoom(sender, today = pragueNow().date) {
  return sender.usedOn !== today || sender.usedCount < MAIL_DAILY_LIMIT;
}

export async function countSenderUse(env, sender, today = pragueNow().date) {
  await env.DB.prepare(
    `update mail_senders set
       used_count = case when used_on = ? then used_count + 1 else 1 end,
       used_on = ?,
       last_used_at = datetime('now')
     where id = ?`,
  )
    .bind(today, today, sender.id)
    .run();
}

// Vrací id řádku, ať se dá po vyřízení přepsat (`setLogStatus`).
export async function logMail(env, { email, senderId = null, subject, excerpt, status, result = "", verified = false, auth = "" }) {
  await env.DB.prepare(`delete from mail_log where created_at < datetime('now', '-${KEEP_LOG_DAYS} days')`).run();
  const saved = await env.DB.prepare(
    "insert into mail_log (sender_email, sender_id, subject, excerpt, status, result, verified, auth) values (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(clip(email, 160), senderId, clip(subject, 200), clip(excerpt, 4000), status, clip(result, 1000), verified ? 1 : 0, clip(auth, 3000))
    .run();
  return Number(saved.meta?.last_row_id ?? 0);
}

export async function setLogStatus(env, id, status, result) {
  if (!id) return;
  await env.DB.prepare("update mail_log set status = ?, result = ? where id = ?").bind(status, clip(result, 1000), id).run();
}

// Neznámou adresu Drběna zkoumá a odpovídá jí nejvýš jednou za den, ať se nehádá s robotem. Počítá se jen e-mail,
// který opravdu vyřídila (ověřený: žádost o povolení, spam nebo odpověď „kam psát“), ne přeskočený
// ani neověřený pokus (ten by jinak zablokoval pozdější ověřený e-mail z téže adresy).
// Řádek historie, u kterého Drběna zkoumala neznámou adresu (a platila za volání modelu).
const HANDLED = `verified = 1 and created_at >= datetime('now', '-1 day') and (status in ('zadost', 'spam') or (status = 'neznamy' and result like '%odpověděla jsem%'))`;

export async function answeredToday(env, email) {
  const row = await env.DB.prepare(`select 1 as hit from mail_log where sender_email = ? and ${HANDLED} limit 1`)
    .bind(clip(email, 160))
    .first();
  return Boolean(row);
}

// Na co se Drběna tohoto odesílatele naposledy ptala, když jí od té doby nic dalšího nenapsal (nejvýš 3 dny zpátky).
// Další e-mail je nejspíš odpověď a Drběna ho dostane spolu s tím předchozím.
export async function earlierQuestion(env, senderId) {
  const row = await env.DB.prepare(
    "select subject, excerpt, result, status from mail_log where sender_id = ? and created_at >= datetime('now', '-3 days') order by id desc limit 1",
  )
    .bind(senderId)
    .first();
  if (row?.status !== "nejasne") return null;
  return { subject: String(row.subject ?? ""), text: String(row.excerpt ?? ""), question: String(row.result ?? "") };
}

// Kolik neznámých adres dnes už Drběna zkoumala (každé zkoumání je volání modelu): strop proti zaplavení.
export const UNKNOWN_DAILY_LIMIT = 30;

// Počítají se jen zkoumané adresy, ne přeskočené ani neověřené: podvržených e-mailů může přijít kolik chce
// a nesmí tím ucpat žádosti skutečných lidí.
export async function unknownRoom(env) {
  const row = await env.DB.prepare(`select count(*) as n from mail_log where sender_id is null and ${HANDLED}`).first();
  return Number(row?.n ?? 0) < UNKNOWN_DAILY_LIMIT;
}

// Spam od téhle adresy už dnes redakci hlásil? Víc upozornění od jednoho odesílatele denně nechodí.
export async function spamReportedToday(env, email) {
  const row = await env.DB.prepare(
    "select 1 as hit from mail_log where sender_email = ? and status = 'spam' and created_at >= datetime('now', '-1 day') limit 1",
  )
    .bind(clip(email, 160))
    .first();
  return Boolean(row);
}

// E-maily od známých adres, kterým Drběna nerozuměla (zeptala se) nebo je nezpracovala kvůli chybě, a odesílatel
// od té doby nenapsal nic, co by se vyřídilo. Čekají na člověka z redakce (Přehled), dokud je neoznačí „Vyřízeno“.
const UNRESOLVED_DAYS = 7;

export async function loadUnresolvedMail(env) {
  try {
    const rows = await env.DB.prepare(
      `select * from mail_log m
       where m.status in ('nejasne', 'chyba') and m.sender_id is not null and m.created_at >= datetime('now', '-${UNRESOLVED_DAYS} days')
         and not exists (
           select 1 from mail_log n
           where n.sender_email = m.sender_email and n.id > m.id and n.status in ('ceka', 'zapsano', 'ke_schvaleni', 'zamitnuto', 'upraveno', 'vyrizeno')
         )
       order by m.id desc limit 20`,
    ).all();
    return (rows.results ?? []).map(mapLog);
  } catch {
    return [];
  }
}

// Redaktor e-mail vyřídil sám (zapsal změnu ručně, odpověděl odesílateli): zmizí z Přehledu.
export async function markMailHandled(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("update mail_log set status = 'vyrizeno' where id = ? and status in ('nejasne', 'chyba')").bind(id ?? 0).run();
  return { ok: true };
}
