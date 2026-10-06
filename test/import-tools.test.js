import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { callClaude } from "../src/claude.js";
import { contentText, importContent } from "../src/import-overview.js";
import { importSummary } from "../src/import-context.js";
import { importLookup, noteReads, runImportTool, withLookups } from "../src/import-tools.js";
import { readTry, tryVoice } from "../src/drbena-try.js";
import { adminDrbena } from "../src/admin/index.js";

// Falešné API: vrací odpovědi v pořadí a pamatuje si, co dostalo.
async function fakeApi(replies) {
  const seen = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      seen.push(JSON.parse(body));
      const reply = replies[seen.length - 1];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: `msg_${seen.length}`, type: "message", role: "assistant", model: "claude-opus-5-5", ...reply }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { seen, url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };

const known = {
  events: [{ id: 3, title: "Pouť", place: "náměstí", startsOn: "2026-10-10", startsTime: "" }],
  articles: [{ id: 12, title: "Letní kino", excerpt: "Promítá se.", keywords: "kino", createdOn: "2026-07-20" }],
  imports: [{ id: 40, tag: "munipolis", publishedOn: "2026-07-19", title: "Letní kino na koupališti", outcome: "přeskočeno" }],
};

test("přehled jde napřed a ve dvou blocích s cache, převzaté zprávy a položka až za nimi", () => {
  const content = importContent(known, { today: "2026-10-05", topics: "Témata: les", media: [{ type: "image", source: {} }], tail: ["Nadpis: Kino", ""] });
  assert.equal(content.length, 5);
  assert.deepEqual(
    content.map((block) => Boolean(block.cache_control)),
    [true, true, false, false, false],
  );
  assert.match(content[0].text, /^Dnes je 2026-10-05\.\n\nTémata: les\n\nAkce v kalendáři:\n\[akce:3\]/);
  assert.match(content[1].text, /\[zprava:12\] 2026-07-20 · Letní kino/);
  assert.match(content[2].text, /\[munipolis:40\] .* · přeskočeno/);
  assert.equal(content[3].type, "image");
  assert.equal(content[4].text, "Nadpis: Kino");
  assert.doesNotMatch(contentText(content), /\n\n\n/);
});

test("Claude si přečte zprávu nástrojem a pak odpoví JSONem; pokyny jdou do cache", async () => {
  const api = await fakeApi([
    {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "abc" },
        { type: "tool_use", id: "tu_1", name: "precist_zpravu", input: { znacka: "zprava:12" } },
      ],
      usage,
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: '{"decision":"duplicita"}' }], usage },
  ]);
  const reads = [];
  const lookup = { ...importLookup({}), run: async (name, input) => (reads.push([name, input.znacka]), "Letní kino\nPromítá se v pátek.") };
  try {
    const answer = await callClaude(
      { ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: api.url },
      { system: "Pokyny", content: [{ type: "text", text: "Zpráva" }], schema: { type: "object" }, lookup },
    );
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.raw, { decision: "duplicita" });
    assert.deepEqual(answer.read, ["zprava:12"]);
    assert.equal(answer.usage.cache_read_input_tokens, 1800);
    assert.deepEqual(reads, [["precist_zpravu", "zprava:12"]]);
    const [first, second] = api.seen;
    assert.deepEqual(first.system[0].cache_control, { type: "ephemeral" });
    assert.match(first.system[0].text, /^Pokyny\n\nNástroje:/);
    assert.deepEqual(first.tools.map((tool) => tool.name), ["hledat_zpravy", "precist_zpravu", "precist_zdroj"]);
    // Druhé kolo: stejný začátek, odpověď s myšlenkami beze změny a výsledek nástroje.
    assert.deepEqual(second.messages[0], first.messages[0]);
    assert.equal(second.messages[1].role, "assistant");
    assert.equal(second.messages[1].content[0].signature, "abc");
    assert.deepEqual(second.messages[2].content, [{ type: "tool_result", tool_use_id: "tu_1", content: "Letní kino\nPromítá se v pátek." }]);
  } finally {
    api.close();
  }
});

test("bez dohledávání jde jen pokyn s cache a žádné nástroje", async () => {
  const api = await fakeApi([{ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage }]);
  try {
    const answer = await callClaude({ ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: api.url }, { system: "Pokyny", content: [], schema: {} });
    assert.equal(answer.ok, true);
    assert.equal(api.seen[0].tools, undefined);
    assert.equal(api.seen[0].system[0].text, "Pokyny");
  } finally {
    api.close();
  }
});

test("Drběna, která pořád jen čte, skončí chybou", async () => {
  const read = (id) => ({ type: "tool_use", id, name: "precist_zdroj", input: { znacka: "munipolis:1" } });
  const call = { stop_reason: "tool_use", content: [read("tu_a"), read("tu_b")], usage };
  const api = await fakeApi([call, call, call, call]);
  try {
    const answer = await callClaude(
      { ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: api.url },
      { system: "Pokyny", content: [], schema: {}, lookup: { ...importLookup({}), run: async () => "text" } },
    );
    assert.equal(answer.ok, false);
    assert.match(answer.error, /nerozhodla/);
    assert.equal(api.seen.length, 4);
    // Po vyčerpání čtení dostane místo textu výzvu, ať rozhodne.
    assert.match(api.seen[3].messages.at(-1).content[0].content, /rozhodni/);
  } finally {
    api.close();
  }
});

function fakeDb(rows) {
  return {
    prepare(sql) {
      return {
        bind(id) {
          return { first: async () => rows.find((row) => sql.includes(row.from) && row.id === id) ?? null };
        },
      };
    },
  };
}

test("nástroje čtou zprávy, návrhy a zdroje; text Deníku ne", async () => {
  const env = {
    DB: fakeDb([
      { from: "from articles", id: 12, title: "Letní kino", excerpt: "Promítá se.", body: "<p>V pátek <strong>Pelíšky</strong>.</p>", created_at: "2026-07-20 10:00:00", rubric: "Kultura" },
      { from: "from proposals", id: 5, title: "Pouť", excerpt: "Kolotoče.", body: "<p>Na náměstí.</p>", status: "pending" },
      { from: "from webmesta_items", id: 3, title: "Bluegrass", text: "<p>XI. ročník.</p>", published_at: "2026-07-21T16:09:00Z" },
      { from: "from denik_items", id: 7, title: "Nehoda u Kopidlna", text: "Placený text.", published_at: "2026-09-01T08:00:00Z" },
    ]),
  };
  assert.equal(await runImportTool(env, "precist_zpravu", { znacka: "[zprava:12]" }), "Letní kino\n2026-07-20 · Kultura\nPromítá se.\n\nV pátek Pelíšky .");
  assert.match(await runImportTool(env, "precist_zpravu", { znacka: "navrh:5" }), /^Pouť \(návrh, čeká na schválení\)\nKolotoče\.\n\nNa náměstí\./);
  assert.match(await runImportTool(env, "precist_zpravu", { znacka: "zprava:99" }), /už na drbně není/);
  assert.match(await runImportTool(env, "precist_zpravu", { znacka: "akce:3" }), /jen podle značky/);
  assert.equal(await runImportTool(env, "precist_zdroj", { znacka: "webmesta:3" }), "Bluegrass\n2026-07-21\n\nXI. ročník.");
  const denik = await runImportTool(env, "precist_zdroj", { znacka: "denik:7" });
  assert.match(denik, /Nehoda u Kopidlna/);
  assert.doesNotMatch(denik, /Placený/);
  assert.match(await runImportTool(env, "precist_zdroj", { znacka: "fotbal:1" }), /munipolis:12/);
});

test("zdůvodnění řekne, co si Drběna přečetla, souhrn průchodu ukáže cache", () => {
  assert.equal(noteReads("Stejná akce.", { read: ["zprava:12", "munipolis:40"] }), "Stejná akce. (Dohledávala: zprava:12, munipolis:40.)");
  assert.equal(noteReads("Nová akce.", { read: [] }), "Nová akce.");
  const merged = withLookups({ ok: true, reason: "x", read: ["navrh:5"], usage }, { read: ["zprava:1"], usage });
  assert.deepEqual(merged.read, ["navrh:5", "zprava:1"]);
  assert.equal(merged.usage.cache_read_input_tokens, 1800);
  const summary = importSummary(
    [
      { ok: true, usage: { cache_read_input_tokens: 12000, cache_creation_input_tokens: 9000 } },
      { ok: true, usage: { cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } },
    ],
    2,
    0,
  );
  assert.match(summary.note, /Cache: přečteno 12 300 tokenů, zapsáno 9 000\./);
  assert.doesNotMatch(importSummary([{ ok: true }], 0, 0).note, /Cache/);
});

test("zkouška povahy jako automatika nechá Drběnu rozhodnout a ukáže, co si přečetla", async () => {
  const env = { DB: { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [] }) }) } };
  let asked = null;
  const askCity = async (_env, args) => ((asked = args), { ok: true, decision: "duplicita", reason: "Už to tu je.", duplicateOf: "zprava:12", read: ["zprava:12"], article: null, event: null, notice: null });
  const input = readTry({ kind: "mesto", articleText: "V sobotu bude na náměstí farmářský trh od osmi.", auto: "1" });
  const result = await tryVoice(env, input, { askCity, loadKnown: async () => ({}) });
  assert.equal(asked.force, false);
  const page = adminDrbena(
    { path: "/redakce/drbena", copy: {} },
    { signedIn: true, user: { role: "hlavni", name: "Jana", login: "jana" }, drbena: { persona: "", football: "" } },
    null,
    { input, result },
  );
  assert.match(page, /name="auto" value="1"[^>]* checked/);
  assert.match(page, /Rozhodla \(duplicita\):<\/b> Už to tu je\./);
  assert.match(page, /Dohledávala:<\/b> <a href="\/redakce\/zpravy\?id=12">Zpráva #12<\/a>/);
});

test("formulář pošle zaškrtnutou paměť i automatiku", async () => {
  const { formFields } = await import("../src/forms.js");
  const body = new URLSearchParams({ memory: "1", auto: "1", text: "Text" });
  const fields = await formFields(new Request("http://x/", { method: "POST", body }));
  assert.equal(fields.memory, true);
  assert.equal(fields.auto, true);
  const empty = await formFields(new Request("http://x/", { method: "POST", body: new URLSearchParams({ text: "Text" }) }));
  assert.equal(empty.memory, false);
});
