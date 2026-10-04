import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { assistCost, assistSchema, assistSystem, assistUserText, readAssist, rubricsText } from "../src/assist/ai.js";
import { readAssistInput } from "../src/assist/run.js";
import {
  ASSIST_DEFAULTS,
  assistLimit,
  countAssist,
  ensureAssistTables,
  loadAssistAdmin,
  loadAssistSettings,
  readAssistSettings,
  recordAssist,
} from "../src/assist/store.js";
import { articleFields } from "../src/admin/article-form.js";
import { DEFAULT_VOICE } from "../src/drbena.js";

// Malá náhrada D1 nad SQLite v paměti (stejná jako v messages.test.js).
function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { results: [], meta: { changes: result.changes ?? 0 } };
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
  await env.DB.prepare("create table users (id integer primary key, name text not null)").run();
  await env.DB.prepare("insert into users (id, name) values (1, 'Hlavní'), (2, 'Jana')").run();
  await ensureAssistTables(env);
  return env;
}

const rubrics = [
  { id: 1, parentId: null, name: "Zprávy", slug: "zpravy" },
  { id: 2, parentId: null, name: "Komunita", slug: "komunita" },
  { id: 3, parentId: 2, name: "Škola", slug: "skola" },
];

test("pomocník: formulář se pročistí a krátký text se pozná", () => {
  assert.equal(readAssistInput({ mode: "neco" }), null);
  assert.equal(readAssistInput(null), null);
  const input = readAssistInput({ mode: "drbena", title: "  Drakiáda ", excerpt: "", body: "<p>v neděli <script>x</script>14:00</p>", rubricId: "3", wantsPhoto: 1 });
  assert.equal(input.title, "Drakiáda");
  assert.doesNotMatch(input.body, /script/);
  assert.equal(input.rubricId, 3);
  assert.equal(input.wantsPhoto, true);
  assert.ok(input.length < 30);
});

test("pomocník: učesat drží hlas redaktora, Drběna dostane povahu", () => {
  assert.doesNotMatch(assistSystem("ucesat", DEFAULT_VOICE), /koza Drběna/);
  assert.match(assistSystem("ucesat", DEFAULT_VOICE), /Zachovej jeho hlas/);
  assert.match(assistSystem("drbena", DEFAULT_VOICE), /koza Drběna/);
  assert.match(assistSystem("drbena", DEFAULT_VOICE), /Nic nevymýšlej/);
});

test("pomocník: rubriky s podrubrikou a zadání pro Claude", () => {
  assert.match(rubricsText(rubrics), /- skola: Komunita › Škola/);
  const text = assistUserText({ title: "", excerpt: "", body: "<p>Drakiáda</p>" }, { today: "2026-10-04", rubrics, topics: [], rubric: "skola" });
  assert.match(text, /zatím bez nadpisu/);
  assert.match(text, /vybranou rubriku skola/);
  const schema = assistSchema(["zpravy", "skola"], ["hasici"]);
  assert.deepEqual(schema.properties.rubric.enum, ["zpravy", "skola"]);
  assert.deepEqual(schema.properties.image_topic.enum, ["hasici", ""]);
});

test("pomocník: odpověď se ověří a vyčistí", () => {
  const ok = readAssist(
    { title: "Drakiáda  v neděli", excerpt: "Pouštíme draky.", body_html: "<p>Na louce.</p><img src=x>", rubric: "komunita", image_topic: "neznamy", note: "Chybí čas." },
    { rubricSlugs: ["zpravy", "komunita"], topics: ["hasici"] },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.title, "Drakiáda v neděli");
  assert.doesNotMatch(ok.body, /img/);
  assert.equal(ok.rubric, "komunita");
  assert.equal(ok.imageTopic, "");
  assert.equal(ok.note, "Chybí čas.");
  assert.equal(readAssist({ title: "", excerpt: "x", body_html: "" }, { rubricSlugs: [], topics: [] }).ok, false);
});

test("pomocník: cena podle ceníku Sonnetu", () => {
  assert.equal(assistCost({ input_tokens: 1_000_000, output_tokens: 0 }), 2);
  assert.equal(assistCost({ input_tokens: 0, output_tokens: 100_000 }), 1);
  assert.equal(assistCost(null), 0);
});

test("pomocník: nastavení drží meze", async () => {
  assert.deepEqual(readAssistSettings({ assistPerDay: "9999", assistBudget: "-5" }), { perDay: 500, budget: 0 });
  assert.deepEqual(readAssistSettings({}), ASSIST_DEFAULTS);
  const env = await freshEnv();
  assert.deepEqual(await loadAssistSettings(env), ASSIST_DEFAULTS);
});

test("pomocník: denní limit přispěvatele a měsíční rozpočet", async () => {
  const env = await freshEnv();
  const settings = { perDay: 2, budget: 10 };
  const who = { day: "2026-10-04", userId: 2 };
  assert.equal(await assistLimit(env, settings, who), null);
  assert.equal(await countAssist(env, settings, { ...who, chief: false }), 1);
  await recordAssist(env, { ...who, ok: true, cost: 0.01 });
  assert.equal(await countAssist(env, settings, { ...who, chief: false }), 0);
  await recordAssist(env, { ...who, ok: false, cost: 0 });
  assert.equal(await assistLimit(env, settings, who), "den");
  // Druhý den denní limit neplatí, rozpočet měsíce ano.
  const next = { day: "2026-10-05", userId: 2 };
  assert.equal(await assistLimit(env, settings, next), null);
  await countAssist(env, settings, { ...next, chief: false });
  await recordAssist(env, { ...next, ok: true, cost: 1 });
  assert.equal(await assistLimit(env, settings, next), "mesic");
  // Hlavní redaktor se do rozpočtu přispěvatelů nepočítá.
  const env2 = await freshEnv();
  await countAssist(env2, settings, { day: "2026-10-04", userId: 1, chief: true });
  await recordAssist(env2, { day: "2026-10-04", userId: 1, ok: true, cost: 5 });
  assert.equal(await assistLimit(env2, settings, who), null);
});

test("pomocník: přehled za tento a minulý měsíc", async () => {
  const env = await freshEnv();
  const settings = { perDay: 20, budget: 100 };
  await countAssist(env, settings, { day: "2026-09-30", userId: 2, chief: false });
  await recordAssist(env, { day: "2026-09-30", userId: 2, ok: true, cost: 0.02 });
  await countAssist(env, settings, { day: "2026-10-04", userId: 1, chief: true });
  await recordAssist(env, { day: "2026-10-04", userId: 1, ok: true, cost: 0.01 });
  await countAssist(env, settings, { day: "2026-10-04", userId: 2, chief: false });
  await recordAssist(env, { day: "2026-10-04", userId: 2, ok: false, cost: 0 });
  const admin = await loadAssistAdmin(env, "2026-10-04");
  assert.equal(admin.thisMonth.people.length, 2);
  const jana = admin.thisMonth.people.find((row) => row.name === "Jana");
  assert.deepEqual([jana.uses, jana.failed, jana.chief], [1, 1, false]);
  assert.ok(Math.abs(admin.thisMonth.czk - 0.23) < 1e-9);
  assert.equal(admin.thisMonth.contributorsCzk, 0);
  assert.equal(admin.lastMonth.people[0].name, "Jana");
});

test("pomocník: lišta ve formuláři jen s oprávněním", () => {
  const form = (user) => articleFields(null, { rubrics, user });
  assert.doesNotMatch(form({ role: "prispevatel", permissions: [] }), /data-assist/);
  assert.match(form({ role: "prispevatel", permissions: ["ai_pomocnik"] }), /data-assist-run="drbena"/);
  assert.match(form({ role: "hlavni", permissions: [] }), /data-assist-run="ucesat"/);
});
