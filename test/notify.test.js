import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runChatTool } from "../src/chat/context.js";
import { CHAT_TABLES } from "../src/chat/store.js";
import { ensureMessageTables } from "../src/messages-db.js";
import { ensureNotifyTables, loadNotifySwitches, noticeMail, notifyEditors, notifyRecipients, saveNotifySwitches } from "../src/notify.js";
import { adminAccount } from "../src/admin/account.js";

// Malá náhrada D1 nad SQLite v paměti: prepare/bind/run/first/all a batch.
function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = /\breturning\b/i.test(sql) ? { results: db.prepare(sql).all(...values) } : db.prepare(sql).run(...values);
      return { results: result.results ?? [], meta: { changes: result.changes ?? 0 } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      const out = [];
      for (const item of list) out.push(await item.run());
      return out;
    },
  };
}

const chief = { id: 1, role: "hlavni", permissions: [] };
const jana = { id: 2, role: "prispevatel", permissions: ["vzkazy"] };

async function staffEnv() {
  const env = { DB: d1() };
  const sent = [];
  env.EMAIL = { send: async (mail) => sent.push(mail) };
  for (const sql of CHAT_TABLES) await env.DB.prepare(sql).run();
  await ensureMessageTables(env);
  await ensureNotifyTables(env);
  await env.DB.prepare("create table users (id integer primary key, name text, email text, role text, active integer)").run();
  await env.DB.prepare("create table user_permissions (user_id integer, code text)").run();
  await env.DB.prepare(
    `insert into users values (1, 'Hlavní', 'hlavni@example.cz', 'hlavni', 1), (2, 'Jana', 'jana@example.cz', 'prispevatel', 1),
     (3, 'Bývalý', 'stary@example.cz', 'hlavni', 0), (4, 'Bez e-mailu', '', 'hlavni', 1), (5, 'Druhý', 'druhy@example.cz', 'hlavni', 1)`,
  ).run();
  await env.DB.prepare("insert into user_permissions values (2, 'vzkazy')").run();
  return { env, sent };
}

const who = { day: "2026-10-03", visitor: "otisk", conversation: "rozhovor-1", page: "/oteviraci-doba" };

test("upozornění dostanou aktivní hlavní redaktoři s e-mailem, kdo si ho vypne, ne", async () => {
  const { env } = await staffEnv();
  assert.deepEqual(await notifyRecipients(env, "navrh"), ["hlavni@example.cz", "druhy@example.cz"]);
  await saveNotifySwitches(env, { ...chief, id: 5 }, ["vzkaz", "hodiny"]);
  assert.deepEqual(await notifyRecipients(env, "navrh"), ["hlavni@example.cz"]);
  assert.deepEqual(await notifyRecipients(env, "drbena"), ["hlavni@example.cz"]);
  assert.deepEqual(await notifyRecipients(env, "vzkaz"), ["hlavni@example.cz", "druhy@example.cz"]);
  assert.deepEqual(await notifyRecipients(env, "neznamy"), []);
});

test("vypínače: přispěvatel bez druhů nic nevidí, hlavní redaktor vše a uložení platí", async () => {
  const { env } = await staffEnv();
  assert.deepEqual(await loadNotifySwitches(env, jana), []);
  const all = await loadNotifySwitches(env, chief);
  assert.deepEqual(all.map((topic) => [topic.key, topic.on]), [["vzkaz", true], ["navrh", true], ["drbena", true], ["hodiny", true], ["posta", true]]);
  await saveNotifySwitches(env, chief, ["navrh"]);
  assert.deepEqual((await loadNotifySwitches(env, chief)).filter((topic) => topic.on).map((topic) => topic.key), ["navrh"]);
  await saveNotifySwitches(env, chief, ["navrh", "vzkaz", "drbena", "hodiny", "posta"]);
  assert.equal((await loadNotifySwitches(env, chief)).every((topic) => topic.on), true);
});

test("Můj účet ukáže vypínače jen tomu, komu nějaká upozornění chodí", () => {
  const ctx = { path: "/redakce/ucet", origin: "http://drbna.test" };
  const base = { signedIn: true, sessions: [], sessionId: "" };
  const page = adminAccount(ctx, { ...base, user: { ...chief, name: "Hlavní", email: "hlavni@example.cz" }, notifySwitches: [{ key: "vzkaz", label: "Vzkaz z chatu s Drběnou", on: false }] }, "");
  assert.match(page, /Upozornění e-mailem/);
  assert.match(page, /name="notify" value="vzkaz">/);
  const contributor = adminAccount(ctx, { ...base, user: { ...jana, name: "Jana", email: "jana@example.cz" }, notifySwitches: [] }, "");
  assert.doesNotMatch(contributor, /Upozornění e-mailem/);
});

test("dopis: prázdné řádky vynechá, odkaz vede na web drbny, HTML je escapované", async () => {
  const mail = noticeMail({ subject: "S", intro: "Úvod", fields: [["Kontakt", ""], ["Druh", "Tip"]] });
  assert.equal(mail.text, "Úvod\n\nDruh: Tip\n\nUpozornění si vypnete v redakci na stránce Můj účet.");
  const { env, sent } = await staffEnv();
  const result = await notifyEditors(env, "navrh", { subject: "Návrh", intro: "<b>Ahoj</b>", path: "/redakce/zpravy?navrh=7" });
  assert.deepEqual(result, { sent: 2, failed: 0 });
  assert.match(sent[0].text, /V redakci: https:\/\/www\.kopidlenskadrbna\.org\/redakce\/zpravy\?navrh=7/);
  assert.match(sent[0].html, /&lt;b&gt;Ahoj&lt;\/b&gt;/);
});

test("chyba e-mailu nic nezastaví", async () => {
  const { env } = await staffEnv();
  env.EMAIL = { send: async () => { throw new Error("nejde"); } };
  assert.deepEqual(await notifyEditors(env, "vzkaz", { subject: "S", intro: "Úvod" }), { sent: 0, failed: 2 });
  delete env.EMAIL;
  assert.match(await runChatTool(env, "predat_redakci", { druh: "tip", shrnuti: "Ples", text: "" }, who), /Předáno/);
});

test("o vzkazu z chatu přijde e-mail na pozadí", async () => {
  const { env, sent } = await staffEnv();
  const deferred = [];
  const writer = { ...who, defer: (promise) => deferred.push(promise) };
  await runChatTool(env, "predat_redakci", { druh: "misto", shrnuti: "Chybí cukrárna <U Lípy>", text: "Doplňte ji.", kontakt: "777 123 456" }, writer);
  assert.equal(deferred.length, 1);
  await Promise.all(deferred);
  assert.deepEqual(sent.map((mail) => mail.to), ["hlavni@example.cz", "druhy@example.cz"]);
  assert.equal(sent[0].subject, "Vzkaz z chatu: Chybí cukrárna <U Lípy>");
  assert.match(sent[0].text, /Druh: Chybí místo\nO co jde: Chybí cukrárna <U Lípy>\nKontakt: 777 123 456\nStránka: \/oteviraci-doba\n\nDoplňte ji\./);
  assert.match(sent[0].text, /\/redakce\/vzkazy/);
});
