import assert from "node:assert/strict";
import test from "node:test";
import { fillKeywords, readKeywords, shownKeywords } from "../src/keywords.js";
import { followupLink, followupReason, writeFollowup } from "../src/followup.js";
import { articleLine, contextText, outputSchema, readDecision } from "../src/munipolis/ai.js";

test("klíčová slova se srovnají: malá písmena, bez opakování, nejvýš deset", () => {
  assert.equal(readKeywords(["LMK Kopidlno", " letecké  modely ", "lmk kopidlno", "x", "", null]), "lmk kopidlno, letecké modely");
  assert.equal(readKeywords("ne seznam"), "");
  assert.equal(readKeywords(Array.from({ length: 15 }, (_, i) => `slovo ${i}`)).split(", ").length, 10);
  assert.equal(shownKeywords("-"), "");
});

test("přehled ukáže klíčová slova, starší zprávy a doplnění", () => {
  const line = articleLine({ id: 7, createdOn: "2026-09-01", title: "Modeláři létali", excerpt: "Soutěž.", keywords: "lmk kopidlno", followsId: 3, followups: 1 }, "zprava");
  assert.equal(line, "[zprava:7] 2026-09-01 · Modeláři létali · Soutěž. · klíčová slova: lmk kopidlno · navazuje na zprava:3 · doplněno už 1×");
  const text = contextText({ articles: [], older: [{ id: 2, createdOn: "2026-03-01", title: "Jarní soutěž", excerpt: "", keywords: "letecké modely" }], proposals: [] });
  assert.match(text, /Starší zprávy \(jen nadpis a klíčová slova\):\n\[zprava:2\] 2026-03-01 · Jarní soutěž · klíčová slova: letecké modely/);
});

test("rozhodnutí doplneni jen ke zprávě, jinak duplicita", () => {
  const slugs = ["zpravy"];
  assert.ok(outputSchema(slugs, { followup: true }).properties.decision.enum.includes("doplneni"));
  assert.ok(!outputSchema(slugs).properties.decision.enum.includes("doplneni"));
  assert.ok(outputSchema(slugs).properties.article.required.includes("keywords"));
  const base = { reason: "Víc jmen.", article: { include: false }, event: { include: false }, notice: { include: false } };
  const follow = readDecision({ ...base, decision: "doplneni", duplicate_of: "zprava:12" }, { rubricSlugs: slugs });
  assert.deepEqual([follow.decision, follow.followOf], ["doplneni", 12]);
  assert.equal(readDecision({ ...base, decision: "doplneni", duplicate_of: "navrh:4" }, { rubricSlugs: slugs }).decision, "duplicita");
  // Ruční zpracování doplnění nezakáže.
  assert.equal(readDecision({ ...base, decision: "doplneni", duplicate_of: "zprava:12" }, { rubricSlugs: slugs, force: true }).decision, "doplneni");
  const made = readDecision(
    { ...base, decision: "vytvorit", duplicate_of: "", article: { include: true, title: "Nadpis", excerpt: "Perex.", body_html: "<p>Text</p>", rubric: "zpravy", image_caption: "", image_topic: "", keywords: ["Kopidlno"] } },
    { rubricSlugs: slugs },
  );
  assert.equal(made.article.keywords, "kopidlno");
});

function targetDb(row) {
  return { prepare: () => ({ bind() { return this; }, first: async () => row }) };
}

test("doplnění ke zprávě, která není na webu nebo už má dvě, je duplicita bez volání Claude", async () => {
  const decision = { ok: true, decision: "doplneni", reason: "Víc.", followOf: 5 };
  const options = { system: "", sourceText: "", articleSchema: {}, readArticle: () => null, today: "2026-10-03" };
  const gone = await writeFollowup({ DB: targetDb(null) }, decision, options);
  assert.deepEqual([gone.decision, gone.duplicateOf], ["duplicita", "zprava:5"]);
  const hidden = await writeFollowup({ DB: targetDb({ id: 5, published: 0 }) }, decision, options);
  assert.equal(hidden.decision, "duplicita");
  const full = await writeFollowup({ DB: targetDb({ id: 5, slug: "a", title: "A", body: "<p>x</p>", created_at: "2026-09-01", published: 1, followups: 2 }) }, decision, options);
  assert.equal(full.decision, "duplicita");
});

test("odkaz na starou zprávu a poznámka pro redakci", () => {
  assert.equal(followupLink({ slug: "modelari-letali", title: "Modeláři \"létali\"" }), '<p><em>Navazuje na zprávu <a href="/zpravy/modelari-letali">Modeláři &quot;létali&quot;</a></em></p>');
  assert.equal(followupReason({ target: { id: 3 }, reason: "Výsledky." }), "Doplnění ke zprávě zprava:3. Výsledky.");
});

test("cron doplní klíčová slova a nevrácené označí pomlčkou", async () => {
  const updates = [];
  let served = false;
  const env = {
    ANTHROPIC_API_KEY: "x",
    DB: {
      prepare: (sql) => ({
        bind(...values) {
          this.values = values;
          return this;
        },
        all: async () => {
          if (served || !sql.includes("from articles")) return { results: [] };
          served = true;
          return { results: [{ ref: "zprava:1", id: 1, title: "A", excerpt: "", body: "", created_at: "2026-09-01" }, { ref: "zprava:2", id: 2, title: "B", excerpt: "", body: "", created_at: "2026-09-02" }] };
        },
        run: async function () {
          updates.push([sql.match(/update (\w+)/)[1], ...this.values]);
        },
      }),
    },
  };
  const result = await fillKeywords(env, { ask: async () => ({ ok: true, found: new Map([["zprava:1", "kopidlno"]]) }) });
  assert.deepEqual(result, { ok: true, filled: 1 });
  assert.deepEqual(updates, [["articles", "kopidlno", 1], ["articles", "-", 2]]);
  assert.deepEqual(await fillKeywords({ DB: env.DB }), { ok: true, skipped: true });
});
