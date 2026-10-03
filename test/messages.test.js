import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runChatTool } from "../src/chat/context.js";
import { CHAT_TABLES } from "../src/chat/store.js";
import { chatInstructions } from "../src/chat/prompt.js";
import {
  addMessageContact,
  countNewMessages,
  ensureMessageTables,
  loadMessages,
  MESSAGE_LIMITS,
  messageKind,
  messagePage,
  saveChatMessage,
} from "../src/messages-db.js";

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

async function freshEnv() {
  const env = { DB: d1() };
  for (const sql of CHAT_TABLES) await env.DB.prepare(sql).run();
  await ensureMessageTables(env);
  return env;
}

const who = { day: "2026-10-03", visitor: "otisk", conversation: "rozhovor-1", page: "/oteviraci-doba" };

test("vzkaz: druh a stránka se pročistí", () => {
  assert.equal(messageKind("MISTO"), "misto");
  assert.equal(messageKind("cokoli"), "jine");
  assert.equal(messagePage("/oteviraci-doba"), "/oteviraci-doba");
  assert.equal(messagePage("https://cizi.cz/"), "");
  assert.equal(messagePage("//cizi.cz"), "");
});

test("Drběna předá vzkaz a později k němu připíše kontakt", async () => {
  const env = await freshEnv();
  const saved = await runChatTool(env, "predat_redakci", { druh: "misto", shrnuti: "Chybí cukrárna U Lípy", text: "Doplňte prosím cukrárnu." }, who);
  assert.match(saved, /Předáno redakci/);
  assert.equal(await countNewMessages(env), 1);
  assert.match(await runChatTool(env, "doplnit_kontakt", { kontakt: "jana@example.cz" }, who), /připsaný/);
  const [row] = await loadMessages(env);
  assert.deepEqual(
    { kind: row.kind, summary: row.summary, text: row.text, contact: row.contact, page: row.page, done: row.done },
    { kind: "misto", summary: "Chybí cukrárna U Lípy", text: "Doplňte prosím cukrárnu.", contact: "jana@example.cz", page: "/oteviraci-doba", done: false },
  );
});

test("kontakt bez předaného vzkazu ani vzkaz bez návštěvníka se neuloží", async () => {
  const env = await freshEnv();
  assert.equal((await addMessageContact(env, { conversation: "jiny" }, "777 123 456")).reason, "missing");
  assert.match(await runChatTool(env, "predat_redakci", { druh: "tip", shrnuti: "Ples", text: "" }), /nejde/);
  assert.equal(await countNewMessages(env), 0);
});

test("vzkazů je v rozhovoru a za den omezeně", async () => {
  const env = await freshEnv();
  for (let i = 0; i < MESSAGE_LIMITS.perConversation; i += 1) {
    assert.equal((await saveChatMessage(env, who, { kind: "tip", summary: `Tip ${i}` })).ok, true);
  }
  assert.equal((await saveChatMessage(env, who, { kind: "tip", summary: "Navíc" })).reason, "limit");
  const other = { ...who, conversation: "rozhovor-2" };
  for (let i = MESSAGE_LIMITS.perConversation; i < MESSAGE_LIMITS.perVisitor; i += 1) {
    assert.equal((await saveChatMessage(env, other, { kind: "tip", summary: `Tip ${i}` })).ok, true);
  }
  assert.equal((await saveChatMessage(env, { ...who, conversation: "rozhovor-3" }, { kind: "tip", summary: "Navíc" })).reason, "limit");
  assert.equal(await countNewMessages(env), MESSAGE_LIMITS.perVisitor);
});

test("pokyny chatu: přání předat redakci, kontakt nevyžadovat", () => {
  const text = chatInstructions(null, "");
  assert.match(text, /predat_redakci/);
  assert.match(text, /Kontakt nevyžaduj/);
});
