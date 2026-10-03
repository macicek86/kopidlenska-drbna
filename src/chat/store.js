// Chat s Drběnou v D1: nastavení, denní součty a cena, denní limity a uložené otázky.
// Limity počítají otisk návštěvníka z počítadla návštěv (denní sůl, žádné IP); dnešní otisky se druhý den smažou.
import { addColumn, asBool, clip, IMPORT_ITEM_TABLES, requireChief, wrote } from "../db-core.js";
import { addDays, pragueNow } from "../waste.js";
import { chatModel, DEFAULT_CHAT_MODEL, USD_CZK } from "./ai.js";
import { turnstileConfig } from "./pass.js";
import { ownChatPersona } from "./prompt.js";

export const CHAT_DEFAULTS = { perVisitor: 20, perDay: 300, budget: 500, keepDays: 30 };
const BOUNDS = { perVisitor: [1, 200], perDay: [1, 10000], budget: [0, 100000], keepDays: [1, 365] };

export const CHAT_TABLES = [
  `create table if not exists chat_settings (
    id integer primary key,
    enabled integer not null default 0,
    model text not null default 'sonnet',
    per_visitor integer not null default 20,
    per_day integer not null default 300,
    budget_czk integer not null default 500,
    keep_days integer not null default 30,
    persona text not null default '',
    secret text not null default '',
    ads integer not null default 1
  )`,
  `create table if not exists chat_days (
    day text primary key,
    questions integer not null default 0,
    conversations integer not null default 0,
    failed integer not null default 0,
    limited integer not null default 0,
    blocked integer not null default 0,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd real not null default 0
  )`,
  `create table if not exists chat_seen (
    day text not null,
    key text not null,
    questions integer not null default 0,
    primary key (day, key)
  )`,
  `create table if not exists chat_questions (
    id integer primary key autoincrement,
    asked_at text not null,
    conversation text not null default '',
    question text not null,
    answer text not null default '',
    model text not null default '',
    cost_usd real not null default 0,
    ok integer not null default 1
  )`,
  "create index if not exists chat_questions_asked on chat_questions (asked_at)",
];

function randomSecret() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ensureChatTables(env) {
  for (const sql of CHAT_TABLES) await env.DB.prepare(sql).run();
  const info = await env.DB.prepare("pragma table_info(chat_settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "ads", "alter table chat_settings add column ads integer not null default 1");
  await env.DB.prepare("insert into chat_settings (id, secret) select 1, ? where not exists (select 1 from chat_settings where id = 1)")
    .bind(randomSecret())
    .run();
}

// Dřív schválené návrhy z importů si nepamatovaly hotovou zprávu. Dohledá ji podle nadpisu a autora.
export async function linkApprovedImports(env) {
  for (const table of IMPORT_ITEM_TABLES) {
    await env.DB.prepare(
      `update ${table} set article_id = (
         select a.id from proposals p join articles a on a.title = p.title and a.author_id = p.author_id
         where p.id = ${table}.proposal_id and p.status = 'approved' and p.article_id is null order by a.id desc limit 1)
       where article_id is null and proposal_id is not null`,
    ).run();
  }
}

function bounded(value, [min, max], fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && String(value ?? "").trim() !== "" ? Math.min(max, Math.max(min, number)) : fallback;
}

function mapSettings(row) {
  return {
    enabled: asBool(row?.enabled),
    model: chatModel(String(row?.model ?? DEFAULT_CHAT_MODEL)),
    perVisitor: bounded(row?.per_visitor, BOUNDS.perVisitor, CHAT_DEFAULTS.perVisitor),
    perDay: bounded(row?.per_day, BOUNDS.perDay, CHAT_DEFAULTS.perDay),
    budget: bounded(row?.budget_czk, BOUNDS.budget, CHAT_DEFAULTS.budget),
    keepDays: bounded(row?.keep_days, BOUNDS.keepDays, CHAT_DEFAULTS.keepDays),
    persona: ownChatPersona(row?.persona),
    ads: row?.ads == null ? true : asBool(row.ads),
    secret: String(row?.secret ?? ""),
  };
}

export async function loadChatSettings(env) {
  return mapSettings(await env.DB.prepare("select * from chat_settings where id = 1").first());
}

// Co z nastavení potřebuje každá veřejná stránka: jestli ukázat okénko.
export async function chatEnabled(env) {
  const row = await env.DB.prepare("select enabled from chat_settings where id = 1").first();
  return asBool(row?.enabled);
}

export function readChatSettings(fields) {
  return {
    enabled: Boolean(fields.enabled),
    model: chatModel(fields.model),
    perVisitor: bounded(fields.perVisitor, BOUNDS.perVisitor, CHAT_DEFAULTS.perVisitor),
    perDay: bounded(fields.perDay, BOUNDS.perDay, CHAT_DEFAULTS.perDay),
    budget: bounded(fields.budget, BOUNDS.budget, CHAT_DEFAULTS.budget),
    keepDays: bounded(fields.keepDays, BOUNDS.keepDays, CHAT_DEFAULTS.keepDays),
    persona: ownChatPersona(fields.persona),
    ads: Boolean(fields.chatAds),
  };
}

export async function saveChatSettings(env, request, fields) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const value = readChatSettings(fields);
  await env.DB.prepare(
    `update chat_settings set enabled = ?, model = ?, per_visitor = ?, per_day = ?, budget_czk = ?, keep_days = ?, persona = ?, ads = ?
     where id = 1`,
  )
    .bind(value.enabled ? 1 : 0, value.model, value.perVisitor, value.perDay, value.budget, value.keepDays, value.persona, value.ads ? 1 : 0)
    .run();
  return { ok: true, enabled: value.enabled };
}

export async function clearChatQuestions(env, request) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("delete from chat_questions").run();
  return { ok: true };
}

const monthStart = (day) => `${day.slice(0, 7)}-01`;

// Smí se teď ptát? Vrací null, nebo důvod: "den" (strop webu), "mesic" (rozpočet), "ty" (limit návštěvníka).
export async function chatLimit(env, settings, { day, visitor, conversation }) {
  const [today, month, seen] = await Promise.all([
    env.DB.prepare("select questions from chat_days where day = ?").bind(day).first(),
    env.DB.prepare("select coalesce(sum(cost_usd), 0) as cost from chat_days where day >= ?").bind(monthStart(day)).first(),
    env.DB.prepare("select coalesce(max(questions), 0) as most from chat_seen where day = ? and key in (?, ?)")
      .bind(day, `v:${visitor}`, `c:${conversation}`)
      .first(),
  ]);
  if (Number(today?.questions ?? 0) >= settings.perDay) return "den";
  if (Number(month?.cost ?? 0) * USD_CZK >= settings.budget) return "mesic";
  if (Number(seen?.most ?? 0) >= settings.perVisitor) return "ty";
  return null;
}

function bumpDay(env, day, column, amount = 1) {
  return env.DB.prepare(
    `insert into chat_days (day, ${column}) values (?, ?) on conflict(day) do update set ${column} = ${column} + excluded.${column}`,
  ).bind(day, amount);
}

// Zastavení limitem ("limited") nebo Turnstilem ("blocked").
export async function countStop(env, day, column) {
  if (column !== "limited" && column !== "blocked") return;
  await bumpDay(env, day, column).run();
}

// Otázka se započítá hned, ať souběžné otázky limit nepřelezou. Vrací, kolik otázek návštěvníkovi zbývá.
export async function countQuestion(env, settings, { day, visitor, conversation }) {
  const seen = (key) =>
    env.DB.prepare(
      `insert into chat_seen (day, key, questions) values (?, ?, 1)
       on conflict(day, key) do update set questions = questions + 1`,
    ).bind(day, key);
  const fresh = wrote(await env.DB.prepare("insert or ignore into chat_seen (day, key, questions) values (?, ?, 0)").bind(day, `c:${conversation}`).run());
  await env.DB.batch([
    seen(`v:${visitor}`),
    seen(`c:${conversation}`),
    bumpDay(env, day, "questions"),
    ...(fresh ? [bumpDay(env, day, "conversations")] : []),
    env.DB.prepare("delete from chat_seen where day < ?").bind(day),
  ]);
  const row = await env.DB.prepare("select max(questions) as most from chat_seen where day = ? and key in (?, ?)")
    .bind(day, `v:${visitor}`, `c:${conversation}`)
    .first();
  return Math.max(0, settings.perVisitor - Number(row?.most ?? 0));
}

// Odpověď (i nepovedená): tokeny a cena do denního součtu, otázka do seznamu pro redakci, staré otázky pryč.
export async function recordAnswer(env, settings, { day, now = new Date(), conversation, question, answer, ok, usage, cost }) {
  const cutoff = new Date(now.getTime() - settings.keepDays * 86_400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `insert into chat_days (day, failed, input_tokens, output_tokens, cost_usd) values (?, ?, ?, ?, ?)
       on conflict(day) do update set failed = failed + excluded.failed, input_tokens = input_tokens + excluded.input_tokens,
         output_tokens = output_tokens + excluded.output_tokens, cost_usd = cost_usd + excluded.cost_usd`,
    ).bind(day, ok ? 0 : 1, usage.input + usage.read + usage.write, usage.output, cost),
    env.DB.prepare(
      "insert into chat_questions (asked_at, conversation, question, answer, model, cost_usd, ok) values (?, ?, ?, ?, ?, ?, ?)",
    ).bind(now.toISOString(), conversation, clip(question, 1000), clip(answer, 4000), settings.model, cost, ok ? 1 : 0),
    env.DB.prepare("delete from chat_questions where asked_at < ?").bind(cutoff),
  ]);
}

function mapDay(row) {
  return {
    questions: Number(row?.questions ?? 0),
    conversations: Number(row?.conversations ?? 0),
    failed: Number(row?.failed ?? 0),
    limited: Number(row?.limited ?? 0),
    blocked: Number(row?.blocked ?? 0),
    cost: Number(row?.cost_usd ?? 0) * USD_CZK,
  };
}

function sum(days) {
  return days.reduce(
    (total, row) => ({
      questions: total.questions + row.questions,
      conversations: total.conversations + row.conversations,
      failed: total.failed + row.failed,
      limited: total.limited + row.limited,
      blocked: total.blocked + row.blocked,
      cost: total.cost + row.cost,
    }),
    mapDay(null),
  );
}

// Pro redakci: posledních 30 dní po dnech, dnešek, tento měsíc a poslední otázky. Ceny už v korunách.
export async function loadChatStats(env, today) {
  const since = addDays(today, -29);
  const from = since < monthStart(today) ? since : monthStart(today);
  const [rows, questions] = await Promise.all([
    env.DB.prepare("select * from chat_days where day >= ? order by day").bind(from).all(),
    env.DB.prepare("select id, asked_at, question, answer, model, cost_usd, ok from chat_questions order by id desc limit 100").all(),
  ]);
  const byDay = new Map((rows.results ?? []).map((row) => [String(row.day), mapDay(row)]));
  const chart = [];
  for (let i = 29; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    chart.push({ day, ...(byDay.get(day) ?? mapDay(null)) });
  }
  const month = sum([...byDay.entries()].filter(([day]) => day >= monthStart(today)).map(([, row]) => row));
  return {
    today: byDay.get(today) ?? mapDay(null),
    month,
    last30: sum(chart),
    chart,
    questions: (questions.results ?? []).map((row) => ({
      id: Number(row.id),
      askedAt: String(row.asked_at),
      question: String(row.question),
      answer: String(row.answer),
      model: String(row.model),
      cost: Number(row.cost_usd) * USD_CZK,
      ok: asBool(row.ok),
    })),
  };
}

// Všechno pro stránku Chat s Drběnou v redakci.
export async function loadChatAdmin(env) {
  const today = pragueNow().date;
  const [settings, stats] = await Promise.all([loadChatSettings(env), loadChatStats(env, today)]);
  return { settings, stats, today, turnstile: Boolean(turnstileConfig(env)), hasApiKey: Boolean(env.ANTHROPIC_API_KEY) };
}
