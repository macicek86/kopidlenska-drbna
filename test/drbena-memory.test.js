import assert from "node:assert/strict";
import test from "node:test";
import { markRecalled, memoryOn, readRecall, withMemory } from "../src/drbena-memory.js";
import { contextText, readArticle } from "../src/munipolis/ai.js";

test("paměť jen se zapnutým vypínačem a u článku s dnešním datem", () => {
  const today = "2026-10-04";
  assert.equal(memoryOn({ memory: true }, "", today), true);
  assert.equal(memoryOn({ memory: true }, today, today), true);
  assert.equal(memoryOn({ memory: true }, "2026-09-10", today), false);
  assert.equal(memoryOn({ memory: false }, "", today), false);
  assert.equal(withMemory("Povaha.", false), "Povaha.");
  assert.match(withMemory("Povaha.", true), /^Povaha\.\n\nDrběna si pamatuje/);
});

test("přehled ukáže nedávné akce a konec odstávky", () => {
  const text = contextText({
    recent: [{ id: 5, startsOn: "2026-10-02", title: "Drakiáda", place: "Letiště" }],
    notices: [{ id: 3, kind: "voda", startsOn: "2026-10-03", startsTime: "", endsOn: "2026-10-06", endsTime: "14:00", title: "Bez vody", places: ["Ledkov"] }],
  });
  assert.match(text, /Akce, které nedávno proběhly a Drběna na nich byla:\n\[akce:5\] 2026-10-02 · Drakiáda · Letiště/);
  assert.match(text, /\[odstavka:3\] voda 2026-10-03 až 2026-10-06 14:00 · Bez vody · Ledkov/);
  assert.doesNotMatch(contextText({}), /nedávno proběhly/);
});

test("vzpomínka na akci jde z článku do uložení jen jako značka akce", async () => {
  assert.equal(readRecall(" akce:12 "), "akce:12");
  assert.equal(readRecall("zprava:12"), "");
  const raw = { include: true, title: "Taneční večírek", excerpt: "Ve středu.", body_html: "<p>Text.</p>", rubric: "zpravy", recall: "akce:5" };
  assert.equal(readArticle(raw, ["zpravy"]).recall, "akce:5");
  const runs = [];
  const env = { DB: { prepare: (sql) => ({ bind: (...args) => ({ run: async () => runs.push([sql, ...args]) }) }) } };
  await markRecalled(env, "akce:5");
  await markRecalled(env, "");
  assert.deepEqual(runs, [["update events set recalled = 1 where id = ?", 5]]);
});
