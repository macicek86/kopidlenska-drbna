// Vzkazy pro redakci, které předala Drběna z chatu: chybějící místo, oprava, tip na článek…
// Kontakt je jen tehdy, když ho návštěvník sám napsal. Vyřízené vzkazy se po 90 dnech smažou.
import { clip, currentUser, userCan } from "./db-core.js";

export const MESSAGE_KINDS = {
  misto: "Chybí místo",
  oprava: "Oprava",
  tip: "Tip na článek",
  napad: "Nápad",
  jine: "Jiné",
};

export const MESSAGE_LIMITS = { perConversation: 3, perVisitor: 5 };
const KEEP_DONE_DAYS = 90;
// Kontakt jde doplnit k poslednímu vzkazu z rozhovoru, dokud je čerstvý.
const CONTACT_WINDOW_MS = 2 * 3_600_000;

export const MESSAGE_TABLES = [
  `create table if not exists chat_messages (
    id integer primary key autoincrement,
    created_at text not null,
    conversation text not null default '',
    kind text not null default 'jine',
    summary text not null,
    text text not null default '',
    contact text not null default '',
    page text not null default '',
    status text not null default 'novy',
    done_at text
  )`,
  "create index if not exists chat_messages_status on chat_messages (status, id)",
];

export async function ensureMessageTables(env) {
  for (const sql of MESSAGE_TABLES) await env.DB.prepare(sql).run();
}

export function messageKind(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return Object.hasOwn(MESSAGE_KINDS, key) ? key : "jine";
}

// Jen adresa stránky na drbně, odkud návštěvník psal.
export function messagePage(value) {
  const path = String(value ?? "").trim();
  return /^\/(?!\/)[\w\-./]{0,120}$/.test(path) ? path : "";
}

function mapMessage(row) {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    kind: messageKind(row.kind),
    summary: String(row.summary),
    text: String(row.text ?? ""),
    contact: String(row.contact ?? ""),
    page: String(row.page ?? ""),
    done: row.status === "vyrizeno",
    doneAt: row.done_at ? String(row.done_at) : "",
  };
}

// Uloží vzkaz z chatu. Limity se počítají v chat_seen (denní otisk návštěvníka a rozhovor), stejně jako otázky.
// Vrací { ok: true, id } nebo { ok: false, reason: "limit" | "empty" }.
export async function saveChatMessage(env, { day, visitor, conversation, now = new Date() }, input) {
  const summary = clip(input?.summary, 200);
  if (!summary) return { ok: false, reason: "empty" };
  const seen = await env.DB.prepare("select key, questions from chat_seen where day = ? and key in (?, ?)")
    .bind(day, `mv:${visitor}`, `mc:${conversation}`)
    .all();
  const count = (key) => Number((seen.results ?? []).find((row) => row.key === key)?.questions ?? 0);
  if (count(`mc:${conversation}`) >= MESSAGE_LIMITS.perConversation || count(`mv:${visitor}`) >= MESSAGE_LIMITS.perVisitor) {
    return { ok: false, reason: "limit" };
  }
  const bump = (key) =>
    env.DB.prepare(
      `insert into chat_seen (day, key, questions) values (?, ?, 1)
       on conflict(day, key) do update set questions = questions + 1`,
    ).bind(day, key);
  const results = await env.DB.batch([
    env.DB.prepare(
      "insert into chat_messages (created_at, conversation, kind, summary, text, contact, page) values (?, ?, ?, ?, ?, ?, ?) returning id",
    ).bind(
      now.toISOString(),
      conversation,
      messageKind(input?.kind),
      summary,
      clip(input?.text, 2000),
      clip(input?.contact, 200),
      messagePage(input?.page),
    ),
    bump(`mv:${visitor}`),
    bump(`mc:${conversation}`),
    env.DB.prepare("delete from chat_messages where status = 'vyrizeno' and done_at < ?").bind(
      new Date(now.getTime() - KEEP_DONE_DAYS * 86_400_000).toISOString(),
    ),
  ]);
  return { ok: true, id: Number(results[0].results?.[0]?.id ?? 0) };
}

// Kontakt napsaný až po předání: připíše se k poslednímu vzkazu z téhož rozhovoru.
export async function addMessageContact(env, { conversation, now = new Date() }, contact) {
  const value = clip(contact, 200);
  if (!value) return { ok: false, reason: "empty" };
  const since = new Date(now.getTime() - CONTACT_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    "select id from chat_messages where conversation = ? and created_at >= ? order by id desc limit 1",
  )
    .bind(conversation, since)
    .first();
  if (!row) return { ok: false, reason: "missing" };
  await env.DB.prepare("update chat_messages set contact = ? where id = ?").bind(value, row.id).run();
  return { ok: true, id: Number(row.id) };
}

export async function countNewMessages(env) {
  const row = await env.DB.prepare("select count(*) as n from chat_messages where status = 'novy'").first();
  return Number(row?.n ?? 0);
}

export async function loadMessages(env) {
  const rows = await env.DB.prepare(
    "select * from chat_messages order by case status when 'novy' then 0 else 1 end, id desc limit 300",
  ).all();
  return (rows.results ?? []).map(mapMessage);
}

async function requireMessages(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { ok: false, error: "Přihlaste se do redakce." };
  if (!userCan(user, "vzkazy")) return { ok: false, error: "Na vzkazy potřebuješ oprávnění." };
  return { ok: true, user };
}

export async function markMessage(env, request, id, done) {
  const gate = await requireMessages(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update chat_messages set status = ?, done_at = ? where id = ?")
    .bind(done ? "vyrizeno" : "novy", done ? new Date().toISOString() : null, Number(id))
    .run();
  return { ok: true };
}

export async function removeMessage(env, request, id) {
  const gate = await requireMessages(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("delete from chat_messages where id = ?").bind(Number(id)).run();
  return { ok: true };
}
