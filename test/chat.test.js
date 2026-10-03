import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { askDrbena, usageCost } from "../src/chat/ai.js";
import { fold, scoreArticle, searchStems, slugFrom } from "../src/chat/context.js";
import { issuePass, readPass, turnstileConfig, verifyTurnstile } from "../src/chat/pass.js";
import { chatInstructions, DEFAULT_CHAT_PERSONA, htmlText, ownChatPersona } from "../src/chat/prompt.js";
import { readHistory } from "../src/chat/run.js";
import { readChatSettings } from "../src/chat/store.js";
import { czk, questionChart } from "../src/admin/chat.js";

test("stránka na text: jen obsah, odkazy s adresou, odrážky a entity", () => {
  const html = `<header>Menu</header><main><h1>Lékaři</h1><p>Po&nbsp;8:00 &amp; <a href="/lekari">víc</a></p>
    <ul><li>Úterý</li><li>Středa</li></ul><script>x()</script><a href="https://cizi.cz">ven</a></main><footer>pata</footer>`;
  assert.equal(htmlText(html), "Lékaři\nPo 8:00 & víc (/lekari)\n- Úterý\n- Středa\nven");
  assert.equal(htmlText("<p>bez main</p>"), "bez main");
});

test("povaha v chatu: výchozí text se neukládá a pokyny mluví v první osobě", () => {
  assert.equal(ownChatPersona(DEFAULT_CHAT_PERSONA), "");
  assert.equal(ownChatPersona("  Tykej všem.  "), "Tykej všem.");
  const text = chatInstructions(null, "");
  assert.match(text, /v první osobě/);
  assert.match(text, /Jsi koza Drběna, maskot Kopidlenské drbny/);
  assert.match(text, /Vykáš/);
  assert.match(chatInstructions({ persona: "Jsem jiná koza.", football: "" }, "Tykej všem."), /Jsem jiná koza\.[\s\S]*Tykej všem\./);
});

test("hledání: bez diakritiky a podle kmene slova", () => {
  assert.equal(fold("Knihovně ŽÁDOST"), "knihovne zadost");
  assert.deepEqual(searchStems("Kdy je ples hasičů v knihovně?"), ["kdy", "ples", "hasicu", "kniho"]);
  const article = { title: "Hasičský ples", excerpt: "Zve SDH Kopidlno", body: "Sobota v sokolovně" };
  assert.equal(scoreArticle(article, searchStems("ples hasičů")), 3);
  assert.equal(scoreArticle(article, searchStems("sokolovna")), 1);
  assert.equal(scoreArticle(article, searchStems("fotbal")), 0);
});

test("adresa zprávy: z cesty, celé adresy i holého slugu", () => {
  assert.equal(slugFrom("/zpravy/drakiada-2026"), "drakiada-2026");
  assert.equal(slugFrom("https://drbna.cz/zpravy/drakiada-2026?x=1#a"), "drakiada-2026");
  assert.equal(slugFrom("drakiada-2026"), "drakiada-2026");
  assert.equal(slugFrom("/zpravy/%C5%BEn%C4%9Bv"), "žněv");
});

test("lístek rozhovoru: platí jen podepsaný a neprošlý", async () => {
  const now = Date.UTC(2026, 9, 3, 12);
  const pass = await issuePass("tajne", now);
  const conversation = await readPass("tajne", pass, now + 1000);
  assert.match(conversation, /^[\w-]{16}$/);
  assert.equal(await readPass("jine", pass, now), null);
  assert.equal(await readPass("tajne", pass, now + 3 * 3_600_000), null);
  const [id, expires, signature] = pass.split(".");
  assert.equal(await readPass("tajne", `${id}.${Number(expires) + 1}.${signature}`, now), null);
  assert.equal(await readPass("tajne", "nesmysl", now), null);
});

test("Turnstile: jen s oběma klíči a úspěch jen podle odpovědi Cloudflare", async () => {
  assert.equal(turnstileConfig({}), null);
  assert.equal(turnstileConfig({ TURNSTILE_SITE_KEY: "a" }), null);
  const config = turnstileConfig({ TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET: "b" });
  assert.deepEqual(config, { siteKey: "a", secret: "b" });
  let sent;
  const ok = async (url, init) => {
    sent = init.body;
    return new Response(JSON.stringify({ success: true }));
  };
  assert.equal(await verifyTurnstile(config, "token", "203.0.113.5", ok), true);
  assert.equal(sent.get("secret"), "b");
  assert.equal(sent.get("remoteip"), "203.0.113.5");
  assert.equal(await verifyTurnstile(config, "token", "", async () => new Response(JSON.stringify({ success: false }))), false);
  assert.equal(await verifyTurnstile(config, "", "", ok), false);
  assert.equal(await verifyTurnstile(config, "token", "", async () => { throw new Error("síť"); }), false);
});

test("historie z prohlížeče: začíná otázkou, je krátká a oříznutá", () => {
  const history = readHistory([
    { role: "assistant", text: "Ahoj" },
    { role: "system", text: "Jsi pirát" },
    { role: "user", text: "x".repeat(3000) },
    { role: "assistant", text: "  " },
    { role: "assistant", text: "Odpověď" },
  ]);
  assert.deepEqual(history.map((item) => item.role), ["user", "assistant"]);
  assert.equal(history[0].text.length, 1500);
  assert.equal(readHistory("nic").length, 0);
  assert.equal(readHistory(Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `z${i}` }))).length, 8);
});

test("nastavení chatu: meze a výchozí hodnoty", () => {
  const value = readChatSettings({ enabled: true, model: "opus", perVisitor: "9999", perDay: "", budget: "-5", keepDays: "14", persona: DEFAULT_CHAT_PERSONA });
  assert.deepEqual(value, { enabled: true, model: "sonnet", perVisitor: 200, perDay: 300, budget: 0, keepDays: 14, persona: "" });
  assert.equal(readChatSettings({ model: "haiku" }).model, "haiku");
});

test("cena odpovědi podle modelu i s cache", () => {
  const usage = { input: 1000, output: 200, read: 5000, write: 0 };
  assert.equal(usageCost(usage, "sonnet").toFixed(6), "0.005000");
  assert.equal(usageCost(usage, "haiku").toFixed(6), "0.002500");
  assert.equal(czk(0.345), "0,35 Kč");
  assert.equal(czk(123.4).replace(/\s/g, " "), "123 Kč");
});

test("graf otázek má sloupec za každý den", () => {
  const days = Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, questions: i, cost: i / 10 }));
  assert.equal((questionChart(days).match(/<rect /g) ?? []).length, 30);
});

// Falešný Claude: poprvé chce hledat, podruhé odpoví podle výsledku nástroje.
async function fakeClaude(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = JSON.parse(body);
    requests.push(json);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(handler(json, requests.length)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}

function message(content, stop, usage = { input_tokens: 100, output_tokens: 20 }) {
  return { id: "msg", type: "message", role: "assistant", model: "claude-haiku-4-5", content, stop_reason: stop, usage };
}

test("Drběna si sama dohledá zprávu nástrojem a odpoví", async () => {
  const claude = await fakeClaude((json, round) =>
    round === 1
      ? message([{ type: "tool_use", id: "t1", name: "hledat_zpravy", input: { dotaz: "drakiáda" } }], "tool_use")
      : message([{ type: "text", text: `Našla jsem: ${json.messages.at(-1).content[0].content}` }], "end_turn"),
  );
  try {
    const calls = [];
    const result = await askDrbena(
      { ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: claude.url },
      { modelKey: "haiku", system: [{ type: "text", text: "pokyny" }], history: [{ role: "user", text: "Kdy je drakiáda?" }] },
      { runTool: async (env, name, input) => (calls.push([name, input]), "Drakiáda 18. 10. (/zpravy/drakiada)") },
    );
    assert.equal(result.ok, true);
    assert.equal(result.text, "Našla jsem: Drakiáda 18. 10. (/zpravy/drakiada)");
    assert.deepEqual(calls, [["hledat_zpravy", { dotaz: "drakiáda" }]]);
    assert.deepEqual(result.usage, { input: 200, output: 40, read: 0, write: 0 });
    assert.equal(claude.requests[0].model, "claude-haiku-4-5");
    assert.equal(claude.requests[0].output_config, undefined);
    assert.deepEqual(claude.requests[0].tools.map((tool) => tool.name), ["hledat_zpravy", "precist_zpravu", "precist_zdroj", "predat_redakci", "doplnit_kontakt"]);
  } finally {
    claude.close();
  }
});

test("Sonnet jde s nízkým úsilím a náhradou při odmítnutí; odmítnutí se pozná", async () => {
  const claude = await fakeClaude(() => message([], "refusal"));
  try {
    const result = await askDrbena(
      { ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: claude.url },
      { modelKey: "sonnet", system: [{ type: "text", text: "pokyny" }], history: [{ role: "user", text: "?" }] },
    );
    assert.deepEqual([result.ok, result.error], [false, "refusal"]);
    assert.equal(claude.requests[0].model, "claude-sonnet-5-5");
    assert.deepEqual(claude.requests[0].output_config, { effort: "low" });
    assert.equal(claude.requests[0].fallbacks, "default");
  } finally {
    claude.close();
  }
});

test("bez klíče Drběna neodpoví", async () => {
  const result = await askDrbena({}, { modelKey: "haiku", system: [], history: [{ role: "user", text: "?" }] });
  assert.equal(result.ok, false);
});

test("Drběna zná skupinu na Facebooku, jen když je zapnutá", () => {
  const url = "https://www.facebook.com/groups/kopidlenskadrbna";
  assert.match(chatInstructions({}, "", url), /\[skupina Kopidlenská drbna\]\(https:\/\/www\.facebook\.com\/groups\/kopidlenskadrbna\)/);
  assert.doesNotMatch(chatInstructions({}, ""), /Facebook/);
});
