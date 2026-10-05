import assert from "node:assert/strict";
import test from "node:test";
import { adminSkola } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { skolaPrompt, skolaText } from "../src/skola/ai.js";
import { DEFAULT_FEEDS, fetchSchoolFeeds, parseSchoolFeed, readFeedUrls, schoolKey } from "../src/skola/feed.js";
import { photoCaption, skolaSource } from "../src/skola/run.js";

// Výřez skutečného kanálu ze zskopidlno.cz (Antee).
const feed = (section, slug, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
 <channel>
  <title>${section} | ZŠ a MŠ Kopidlno</title>
  <description>${section}</description>
  <item>
   <title>Výstava na stromech: Ghanské kakao</title>
   <link>https://www.zskopidlno.cz/${slug}/vystava-na-stromech-ghanske-kakao?utm_source=aktuality_z%C5%A0&amp;utm_medium=rss</link>
   <description>Krátký perex.</description>
   <enclosure url="https://www.zskopidlno.cz/image.php?nid=18371&amp;oid=13893206" type="image/png" length="1831892"/>
   <category>2026-2027</category>
   <dueDate>3. 10. 2026</dueDate>
   <endDate>10. 10. 2026</endDate>
   <content:encoded><![CDATA[<p><span>ZŠ a MŠ Kopidlno vás zve na výstavu </span>Ghanské kakao<span> na Hilmarově náměstí.</span></p><p>Srdečně zveme i veřejnost.</p>]]></content:encoded>
   <guid>https://www.zskopidlno.cz/${slug}/vystava-na-stromech-ghanske-kakao</guid>
   <pubDate>Thu, 24 Sep 2026 14:40:26 +0200</pubDate>
  </item>${extra}
 </channel>
</rss>`;

const MASOPUST = `
  <item>
   <title>Masopust 2026</title>
   <link>https://www.zskopidlno.cz/aktuality-ms/masopust-2026?utm_source=x</link>
   <content:encoded><![CDATA[<p>Průvod masek.</p>]]></content:encoded>
   <pubDate>Mon, 16 Feb 2026 08:00:00 +0100</pubDate>
  </item>`;

test("z kanálu školy se bere celý text, fotka, rubrika a termín akce", () => {
  const { ok, items } = parseSchoolFeed(feed("Aktuality ZŠ", "aktuality-zs"));
  assert.equal(ok, true);
  const [item] = items;
  assert.equal(item.guid, "www.zskopidlno.cz/vystava-na-stromech-ghanske-kakao");
  assert.equal(item.link, "https://www.zskopidlno.cz/aktuality-zs/vystava-na-stromech-ghanske-kakao");
  assert.match(item.text, /zve na výstavu Ghanské kakao na Hilmarově náměstí\.\n\nSrdečně zveme/);
  assert.deepEqual(item.images, ["https://www.zskopidlno.cz/image.php?nid=18371&oid=13893206"]);
  assert.equal(item.section, "Aktuality ZŠ");
  assert.equal(item.term, "3. 10. 2026 až 10. 10. 2026");
  assert.equal(item.publishedAt, "2026-09-24T12:40:26.000Z");
  assert.equal(parseSchoolFeed("<html></html>").ok, false);
  assert.equal(schoolKey("nic"), "");
});

test("článek v aktualitách ZŠ i MŠ se vezme jednou a nefunkční kanál nevadí", async () => {
  const pages = {
    "https://a.cz/zs": feed("Aktuality ZŠ", "aktuality-zs"),
    "https://a.cz/ms": feed("Aktuality MŠ", "aktuality-ms", MASOPUST),
  };
  const fetchImpl = async (url) => (pages[url] ? new Response(pages[url]) : new Response("", { status: 404 }));
  const result = await fetchSchoolFeeds(["https://a.cz/zs", "https://a.cz/ms", "https://a.cz/pryc"], { fetchImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map((item) => [item.title, item.section]), [
    ["Výstava na stromech: Ghanské kakao", "Aktuality ZŠ"],
    ["Masopust 2026", "Aktuality MŠ"],
  ]);
  assert.equal(result.items[1].term, "");
  assert.match(result.warning, /404/);
  const down = await fetchSchoolFeeds(["https://a.cz/pryc"], { fetchImpl });
  assert.equal(down.ok, false);
});

test("pokyny: modeláři jdou do rubriky spolku a bez řečí o škole, jen když rubrika existuje", () => {
  const prompt = skolaPrompt("", { rubricSlugs: ["skola", "spolky", "letecti-modelari"] });
  assert.match(prompt, /LMK Kopidlno[^\n]*rubrika "letecti-modelari"/);
  assert.match(prompt, /školu ani učitele nezmiňuj/);
  assert.doesNotMatch(skolaPrompt("", { rubricSlugs: ["skola"] }), /letecti-modelari/);
});

test("adresy kanálů: jedna na řádek, jen https, prázdné vrátí výchozí", () => {
  assert.deepEqual(readFeedUrls(""), DEFAULT_FEEDS);
  assert.deepEqual(readFeedUrls("https://a.cz/x\n\nhttps://a.cz/y\nhttps://a.cz/x"), ["https://a.cz/x", "https://a.cz/y"]);
  assert.equal(readFeedUrls("https://a.cz/x\nhttp://a.cz/y"), null);
});

test("pokyny: vlastní fotka jen se zapnutým nastavením, termín jde Claudovi", () => {
  assert.match(skolaPrompt("", { ownPhotos: true }), /image_use: "vlastni"/);
  const stock = skolaPrompt("");
  assert.doesNotMatch(stock, /image_use/);
  assert.match(stock, /Fotky z webu zdroje se neberou/);
  assert.match(stock, /rubriky "skola"/);
  assert.match(stock, /koza Drběna/);
  const text = skolaText(
    { title: "Výstava", text: "Zveme.", section: "Aktuality ZŠ", term: "3. 10. 2026 až 10. 10. 2026", publishedAt: "2026-09-24T12:40:26Z" },
    { imports: [{ id: 2, tag: "skola", publishedOn: "2026-09-20", title: "Mistr republiky", outcome: "přeskočeno" }] },
    { today: "2026-10-03", images: 1 },
  );
  assert.match(text, /rubrika Aktuality ZŠ \(zveřejněno 2026-09-24\)/);
  assert.match(text, /Termín v kalendáři školy: 3\. 10\. 2026 až 10\. 10\. 2026/);
  assert.match(text, /\[skola:2\] 2026-09-20 · Mistr republiky/);
  assert.match(text, /Přiložené obrázky: 1\./);
});

test("pod zprávou je odkaz na článek školy, fotka školy má popisek s původem", () => {
  assert.match(skolaSource("https://www.zskopidlno.cz/aktuality-zs/a?x=1&y=2"), /href="https:\/\/www\.zskopidlno\.cz\/aktuality-zs\/a\?x=1&amp;y=2"[^>]*>web ZŠ a MŠ Kopidlno</);
  assert.equal(photoCaption(""), "Foto: web ZŠ a MŠ Kopidlno");
  assert.equal(photoCaption("Výstava na náměstí"), "Výstava na náměstí (foto: web ZŠ a MŠ Kopidlno)");
  assert.equal(refLink("skola:4"), '<a href="/redakce/skola?zprava=4">Článek školy #4</a>');
});

test("redakce má stránku Škola s nastavením fotek a detailem článku", () => {
  const page = adminSkola(
    { path: "/redakce/skola", copy: {} },
    {
      signedIn: true,
      user: { role: "hlavni", name: "Jana", login: "jana" },
      hasApiKey: true,
      schools: {
        skola: {
          settings: { enabled: false, autoPublish: false, feedUrls: DEFAULT_FEEDS, freshDays: 7, ownPhotos: false, note: "", status: "" },
          items: [
            {
              id: 4,
              title: "Máme mistra republiky!",
              text: "Dominik Fojt – 1. místo",
              link: "https://www.zskopidlno.cz/aktuality-zs/mame-mistra-republiky",
              section: "Aktuality ZŠ",
              term: "",
              publishedAt: "2026-09-21T06:51:59Z",
              status: "nacteno",
              reason: "",
              duplicateOf: "",
              manual: false,
              attempts: 0,
            },
          ],
        },
      },
    },
    null,
    { importId: 4 },
  );
  assert.match(page, /Články z webu školy/);
  assert.match(page, /Máme mistra republiky!/);
  assert.match(page, /name="ownPhotos"/);
  assert.match(page, /aktuality-ms\?action=atom<\/textarea>/);
  assert.match(page, /Článek na webu školy/);
  assert.match(page, /Fotky jen z knihovny\./);
  assert.match(page, /href="\/redakce\/skola"/);
});

test("smazaná zpráva od Drběny vrátí zdrojový článek k novému zpracování", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { reopenImports, IMPORT_ITEM_TABLES } = await import("../src/db-core.js");
  const { markManual } = await import("../src/background.js");
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ meta: { changes: db.prepare(sql).run(...values).changes } }),
    first: async () => db.prepare(sql).get(...values) ?? null,
  });
  const env = { DB: { prepare: (sql) => statement(sql) } };
  for (const table of IMPORT_ITEM_TABLES) {
    db.exec(`create table ${table} (id integer primary key, status text, reason text, article_id integer, proposal_id integer, manual integer, attempts integer)`);
  }
  db.exec(`insert into skola_items values (1, 'hotovo', '', 7, 3, 1, 1), (2, 'hotovo', '', 8, null, 0, 0), (3, 'hotovo', '', null, 5, 0, 0)`);
  await reopenImports(env, { articleId: 7, proposalIds: [] });
  await reopenImports(env, { proposalIds: [5] });
  const rows = db.prepare("select id, status, article_id, proposal_id from skola_items order by id").all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { id: 1, status: "smazano", article_id: null, proposal_id: null },
    { id: 2, status: "hotovo", article_id: 8, proposal_id: null },
    { id: 3, status: "smazano", article_id: null, proposal_id: null },
  ]);
  assert.equal(await markManual(env, "skola_items", [1, 2]), 1);
  assert.equal(db.prepare("select status from skola_items where id = 1").get().status, "nove");
});
