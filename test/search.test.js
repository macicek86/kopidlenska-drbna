import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { findArticles, runChatTool, searchNote } from "../src/chat/context.js";
import { ftsQuery, mergeRanks, searchNews, searchStems, stem } from "../src/search/query.js";
import { embedText, ensureSearchTables, indexText, indexVectors, syncSearch } from "../src/search/store.js";
import { MIN_SCORE } from "../src/search/vectors.js";
import { relatedArticles } from "../src/import-context.js";
import { importContent, relatedSection } from "../src/import-overview.js";
import { relatedFor } from "../src/assist/run.js";
import { lookupLabel, runImportTool } from "../src/import-tools.js";

// Malá náhrada D1 nad SQLite v paměti (má i FTS5): prepare/bind/run/first/all a batch.
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

async function freshEnv(extra = {}) {
  const env = { DB: d1(), ...extra };
  await env.DB.prepare("create table rubrics (id integer primary key, name text not null)").run();
  await env.DB.prepare(
    `create table articles (id integer primary key autoincrement, slug text not null, title text not null, excerpt text not null,
      body text not null, category text not null default 'Zprávy', rubric_id integer, keywords text not null default '',
      published integer not null default 1, created_at text not null)`,
  ).run();
  return env;
}

async function addArticle(env, article) {
  const row = { body: "", keywords: "", published: 1, created_at: "2025-06-01", ...article };
  await env.DB.prepare("insert into articles (slug, title, excerpt, body, keywords, published, created_at) values (?, ?, ?, ?, ?, ?, ?)")
    .bind(row.slug, row.title, row.excerpt, row.body, row.keywords, row.published, row.created_at)
    .run();
  return Number((await env.DB.prepare("select max(id) as id from articles").first()).id);
}

const queue = async (env) => (await env.DB.prepare("select article_id, fts from search_queue order by article_id").all()).results.map((row) => ({ ...row }));

test("kmeny: krátká slova celá, delší bez koncovky, otázková slova pryč", () => {
  assert.equal(stem("ples"), "ples");
  assert.equal(stem("hasici"), "hasic");
  assert.equal(stem("knihovna"), "knihov");
  assert.deepEqual(searchStems("Jakou barvu má zámek?"), ["barv", "zame"]);
  assert.equal(ftsQuery(["barv", "zame"]), '"barv"* OR "zame"*');
});

test("sloučení pořadí: zpráva vysoko v obou seznamech vyhraje", () => {
  assert.deepEqual(mergeRanks([[1, 2, 3], [3, 4, 1]]), [1, 3, 2, 4]);
  assert.deepEqual(mergeRanks([[], [7]]), [7]);
});

test("fulltext najde i rok starou zprávu podle tvarů a synonym, jen tu na webu", async () => {
  const env = await freshEnv();
  const old = await addArticle(env, {
    slug: "zamek-fasada",
    title: "Zámek má novou fasádu",
    excerpt: "Oprava skončila.",
    body: "<p>Fasáda zámku je teď <strong>okrová</strong>.</p>",
    created_at: "2024-08-10",
  });
  await ensureSearchTables(env);
  // Při prvním založení jdou do fronty všechny zprávy, další přidávají spouště.
  await addArticle(env, { slug: "ples", title: "Hasičský ples", excerpt: "V sokolovně.", created_at: "2026-01-20" });
  await addArticle(env, { slug: "skryta", title: "Zámek v plánu", excerpt: "Ještě nevyšla.", published: 0 });
  await addArticle(env, { slug: "budouci", title: "Zámek zítra", excerpt: "Vyjde později.", created_at: "2099-01-01" });
  assert.equal((await queue(env)).length, 4);

  const found = await searchNews(env, { query: "barva zámku", words: ["fasáda"] });
  assert.deepEqual(found.map((row) => row.slug), ["zamek-fasada"]);
  assert.equal(found[0].id, old);
  assert.equal(found[0].createdOn, "2024-08-10");
  // Bez otisků se fronta po fulltextu vyprázdní.
  assert.deepEqual(await queue(env), []);
  assert.deepEqual((await searchNews(env, { query: "hasičů" })).map((row) => row.slug), ["ples"]);
  assert.deepEqual(await searchNews(env, { query: "zámek", year: 2026 }), []);
  assert.deepEqual(await searchNews(env, { query: "zámek", skip: [old] }), []);
});

test("úprava a smazání zprávy se v indexu projeví", async () => {
  const env = await freshEnv();
  await ensureSearchTables(env);
  const id = await addArticle(env, { slug: "drakiada", title: "Drakiáda", excerpt: "Na kopci." });
  await indexText(env);
  await env.DB.prepare("update articles set title = 'Pouštění draků' where id = ?").bind(id).run();
  assert.deepEqual(await searchNews(env, { query: "drakiáda" }), []);
  assert.equal((await searchNews(env, { query: "draků" })).length, 1);
  await env.DB.prepare("delete from articles where id = ?").bind(id).run();
  assert.deepEqual(await searchNews(env, { query: "draků" }), []);
  assert.equal(Number((await env.DB.prepare("select count(*) as n from article_search").first()).n), 0);
});

function fakeVectors(nearest = []) {
  const stored = new Map();
  const calls = { embedded: [], deleted: [] };
  return {
    calls,
    stored,
    AI: {
      run: async (model, { text }) => {
        calls.embedded.push(...text);
        return { data: text.map(() => [0.1, 0.2]) };
      },
    },
    VECTORS: {
      upsert: async (list) => list.forEach((item) => stored.set(item.id, item.values)),
      deleteByIds: async (ids) => calls.deleted.push(...ids),
      query: async () => ({ matches: nearest }),
    },
  };
}

test("otisky: cron je dopočítá, zpráva upravená mezitím zůstane ve frontě, smazaná zmizí", async () => {
  const fake = fakeVectors();
  const env = await freshEnv({ AI: fake.AI, VECTORS: fake.VECTORS });
  await ensureSearchTables(env);
  const first = await addArticle(env, { slug: "a", title: "První", excerpt: "Perex.", keywords: "obec, oprava", body: "<p>Text</p>" });
  const second = await addArticle(env, { slug: "b", title: "Druhá", excerpt: "Perex." });
  await indexText(env);
  assert.deepEqual(await queue(env), [
    { article_id: first, fts: 1 },
    { article_id: second, fts: 1 },
  ]);
  await env.DB.prepare("update articles set title = 'Druhá upravená' where id = ?").bind(second).run();
  await indexVectors(env);
  assert.deepEqual([...fake.stored.keys()], [String(first)]);
  assert.deepEqual(fake.calls.embedded, ["První\nPerex.\nobec, oprava\nText"]);
  assert.deepEqual(await queue(env), [{ article_id: second, fts: 0 }]);
  await env.DB.prepare("delete from articles where id = ?").bind(first).run();
  const synced = await syncSearch(env);
  assert.deepEqual(synced, { ok: true, text: 2, vectors: 2 });
  assert.deepEqual(fake.calls.deleted, [String(first)]);
  assert.deepEqual(await queue(env), []);
});

test("hledání podle významu najde zprávu bez společných slov, slabou shodu ne", async () => {
  const fake = fakeVectors();
  const env = await freshEnv({ AI: fake.AI, VECTORS: fake.VECTORS });
  await ensureSearchTables(env);
  const nater = await addArticle(env, { slug: "nater", title: "Okrový nátěr", excerpt: "Hotovo." });
  const jiny = await addArticle(env, { slug: "jiny", title: "Pouť", excerpt: "Kolotoče." });
  const barva = await addArticle(env, { slug: "barva", title: "Barva laviček", excerpt: "Zelená." });
  fake.VECTORS.query = async () => ({
    matches: [
      { id: String(nater), score: 0.71 },
      { id: String(jiny), score: MIN_SCORE - 0.01 },
    ],
  });
  const found = await searchNews(env, { query: "barva zámku" });
  assert.deepEqual(found.map((row) => row.id).sort(), [nater, barva].sort());
});

test("chat: nástroj hledat_zpravy bere slova i rok a redakce vidí, co hledala", async () => {
  const env = await freshEnv();
  await env.DB.prepare("create table import_items (id integer primary key, title text, text text, published_at text, article_id integer)").run();
  for (const table of ["football_items", "skola_items", "zahradka_items", "webmesta_items"]) {
    const day = table === "football_items" ? "published_on" : "published_at";
    await env.DB.prepare(`create table ${table} (id integer primary key, title text, text text, ${day} text, article_id integer)`).run();
  }
  await env.DB.prepare("insert into import_items (title, text, published_at) values ('Fasáda zámku', 'Oprava fasády začne v květnu.', '2026-04-01')").run();
  await ensureSearchTables(env);
  await addArticle(env, { slug: "zamek", title: "Zámek má novou fasádu", excerpt: "Je okrová.", keywords: "zámek, fasáda", created_at: "2024-08-10" });
  const found = await findArticles(env, { dotaz: "barva zámku", slova: ["fasáda"] });
  assert.match(found.text, /10\. 8\. 2024 · Zprávy · Zámek má novou fasádu \(\/zpravy\/zamek\): Je okrová\. \[zámek, fasáda\]/);
  assert.match(found.text, /\[mesto-1\]/);
  assert.equal(searchNote({ dotaz: "barva zámku", slova: ["fasáda"] }, found), "hledala „barva zámku“ (+ fasáda) → 1 zpráv, 1 ze zdrojů");
  const log = [];
  const none = await runChatTool(env, "hledat_zpravy", { dotaz: "zámek", rok: 2026 }, { log });
  assert.match(none, /nic nenašla/);
  await runChatTool(env, "precist_zpravu", { adresa: "/zpravy/zamek" }, { log });
  assert.deepEqual(log, ["hledala „zámek“ (rok 2026) → nic", "četla /zpravy/zamek"]);
});

test("otisk zprávy: nadpis, perex, klíčová slova a text bez značek", () => {
  assert.equal(embedText({ title: "A", excerpt: "B", keywords: "-", body: "<p>C</p>" }), "A\nB\nC");
});

test("importy: k položce se dohledají starší zprávy, které v přehledu nejsou", async () => {
  const env = await freshEnv();
  await ensureSearchTables(env);
  const loni = await addArticle(env, { slug: "drakiada-2025", title: "Drakiáda na Bažantnici", excerpt: "Přišlo sto dětí.", created_at: "2025-10-04" });
  const shown = await addArticle(env, { slug: "drakiada-pozvanka", title: "Drakiáda bude v sobotu", excerpt: "Pozvánka.", created_at: "2026-09-30" });
  const related = await relatedArticles(env, { title: "Drakiáda 2026", text: "Pouštění draků na kopci." }, [{ id: shown }]);
  assert.deepEqual(related.map((row) => row.id), [loni]);
  assert.deepEqual(await relatedArticles(env, { title: "" }), []);
  const text = relatedSection(related);
  assert.match(text, /^Možná souvisí/);
  assert.match(text, new RegExp(`\\[zprava:${loni}\\] 2025-10-04 · Drakiáda na Bažantnici · Přišlo sto dětí\\.`));
  assert.equal(relatedSection([]), "");
  const content = importContent({ related }, { today: "2026-10-06", tail: ["Položka"] });
  assert.match(content.at(-1).text, /^Možná souvisí[\s\S]*\n\nPoložka$/);
  assert.equal(content.at(-1).cache_control, undefined);
});

test("pomocník při psaní: ukáže starší zprávy o stejné věci, ne zprávu samotnou", async () => {
  const env = await freshEnv();
  await ensureSearchTables(env);
  await addArticle(env, { slug: "skleník", title: "Palmový skleník obehnala páska", excerpt: "Hrozí pád zdiva.", created_at: "2026-09-09" });
  await addArticle(env, { slug: "sklenik-oprava", title: "Oprava skleníku začne", excerpt: "Zdivo se zpevní.", created_at: "2026-10-01" });
  const related = await relatedFor(env, {
    input: { title: "skleník oprava" },
    answer: { title: "Oprava skleníku začne", excerpt: "Palmový skleník dostane nové zdivo." },
  });
  assert.deepEqual(related, [{ title: "Palmový skleník obehnala páska", url: "/zpravy/skleník", date: "2026-09-09" }]);
});

test("importy: Drběna si sama dohledá starší zprávu v archivu, zdůvodnění řekne, co hledala", async () => {
  const env = await freshEnv();
  await ensureSearchTables(env);
  const old = await addArticle(env, { slug: "drakiada-2024", title: "Drakiáda na Bažantnici", excerpt: "Draci létali.", keywords: "drakiáda, bažantnice", created_at: "2024-10-05" });
  const text = await runImportTool(env, "hledat_zpravy", { dotaz: "pouštění draků", slova: ["drakiáda"] });
  assert.match(text, new RegExp(`^Zprávy z archivu drbny[^\\n]*\\n\\[zprava:${old}\\] 2024-10-05 · Drakiáda na Bažantnici · Draci létali\\. · klíčová slova: drakiáda, bažantnice$`));
  assert.match(await runImportTool(env, "hledat_zpravy", { dotaz: "fotbal", slova: [] }), /nic nenašla/);
  assert.equal(lookupLabel({ name: "hledat_zpravy", input: { dotaz: " drakiáda " } }), "hledání „drakiáda“");
  assert.equal(lookupLabel({ name: "precist_zpravu", input: { znacka: "zprava:3" } }), "zprava:3");
});

test("Kopidlno je skoro v každé zprávě, hledání podle slov ho přeskočí", () => {
  assert.deepEqual(searchStems("FK Kopidlno C - Sokol Libuň 2:2"), ["soko", "libu"]);
  assert.deepEqual(searchStems("V Kopidlně"), []);
});
