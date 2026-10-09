import assert from "node:assert/strict";
import test from "node:test";
import { adminSkola } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { skolaContent, skolaPrompt, skolaText } from "../src/skola/ai.js";
import { contentText } from "../src/import-overview.js";
import { screenDesk } from "../src/skola/deska-screen.js";
import { DESK_FEED, DESK_SECTION, fetchDocuments, parseDeskFeed } from "../src/skola/deska.js";
import { parseSchoolFeed } from "../src/skola/feed.js";
import { photoCaption, skolaSource } from "../src/skola/run.js";
import { SCHOOLS } from "../src/skola/sources.js";
import { DatabaseSync } from "node:sqlite";
import { deferDay, deferSkolaItem, laterNote, loadKeptImages, releaseKeptImages, reopenDeferred, rescheduleDeferred, termDays, termOver } from "../src/skola/defer.js";
import { schoolTables, waitingSkolaItems } from "../src/skola/store.js";

const WEB = SCHOOLS.webmesta;

// Výřez skutečného kanálu z kopidlno.cz/aktuality?action=atom (Antee, stejný jako ZŠ).
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
 <channel>
  <title>Aktuality | Město Kopidlno</title>
  <description>Aktuality</description>
  <item>
   <title>Rozloučení s prázdninami</title>
   <link>https://www.kopidlno.cz/aktuality/rozlouceni-s-prazdninami-2026?utm_source=aktuality&amp;utm_medium=rss&amp;utm_campaign=1191461</link>
   <description>Zveme vás na příjemné komunitní odpoledne.</description>
   <enclosure url="https://www.kopidlno.cz/image.php?nid=21327&amp;oid=13744569" type="image/jpeg" length="267389"/>
   <category>Komunitní a vzdělávací centrum</category>
   <dueDate>28. 8. 2026</dueDate>
   <endDate>28. 8. 2026</endDate>
   <content:encoded><![CDATA[<p>Těšit se můžete na melodie z muzikálů <strong>Děti ráje</strong> a <strong>Pomáda</strong>.</p>]]></content:encoded>
   <guid>https://www.kopidlno.cz/aktuality/rozlouceni-s-prazdninami-2026</guid>
   <pubDate>Tue, 21 Jul 2026 18:17:23 +0200</pubDate>
  </item>
 </channel>
</rss>`;

test("aktuality města se čtou stejně jako web ZŠ: text, fotka a termín", () => {
  const { ok, items } = parseSchoolFeed(FEED);
  assert.ok(ok);
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item.guid, "www.kopidlno.cz/rozlouceni-s-prazdninami-2026");
  assert.equal(item.link, "https://www.kopidlno.cz/aktuality/rozlouceni-s-prazdninami-2026");
  assert.match(item.text, /Děti ráje/);
  assert.deepEqual(item.images, ["https://www.kopidlno.cz/image.php?nid=21327&oid=13744569"]);
  assert.equal(item.term, "28. 8. 2026");
  assert.equal(item.section, "Aktuality");
  assert.deepEqual(WEB.defaultFeeds, ["https://www.kopidlno.cz/aktuality?action=atom"]);
});

test("pokyny webu města: porovnat s Munipolisem, rubriku vybrat volně", () => {
  const prompt = skolaPrompt("", { source: WEB });
  assert.match(prompt, /webu města Kopidlna/);
  assert.match(prompt, /munipolis:40/);
  assert.match(prompt, /z Munipolisu přeskočila/);
  assert.match(prompt, /vyber rubriku ze seznamu/);
  assert.doesNotMatch(prompt, /rubriky ""/);
  const text = skolaText(
    { title: "Letní kino", text: "Promítáme.", section: "Aktuality", term: "1. 8. 2026", publishedAt: "2026-07-20T10:00:00Z" },
    { imports: [{ id: 40, tag: "munipolis", publishedOn: "2026-07-19", title: "Letní kino na koupališti", outcome: "zpráva" }] },
    { today: "2026-07-21", source: WEB },
  );
  assert.match(text, /Článek z webu města Kopidlna, rubrika Aktuality/);
  assert.match(text, /Termín v kalendáři města: 1\. 8\. 2026/);
  assert.match(text, /\[munipolis:40\] 2026-07-19 · Letní kino na koupališti/);
});

test("zdroj a popisek fotky ukazují na web města", () => {
  assert.equal(skolaSource("https://www.kopidlno.cz/aktuality/letni-kino-2026", WEB), "web města Kopidlna https://www.kopidlno.cz/aktuality/letni-kino-2026");
  assert.equal(photoCaption("", WEB), "Foto: web města Kopidlna");
  assert.equal(refLink("webmesta:3"), '<a href="/redakce/webmesta?zprava=3">Článek z webu města #3</a>');
});

test("redakce má stránku Web města", () => {
  const page = adminSkola(
    { path: "/redakce/webmesta", copy: {} },
    {
      signedIn: true,
      user: { role: "hlavni", name: "Jana", login: "jana" },
      hasApiKey: true,
      schools: { webmesta: { settings: { enabled: false, autoPublish: false, feedUrls: WEB.defaultFeeds, freshDays: 14, ownPhotos: false, note: "", status: "" }, items: [] } },
    },
    null,
    { importSettings: true },
    WEB,
  );
  assert.match(page, /Kontrolovat web města automaticky/);
  assert.match(page, /Články z webu města/);
  assert.match(page, /kopidlno\.cz\/aktuality\?action=atom<\/textarea>/);
  assert.match(page, /action="\/redakce\/webmesta\/ulozit"/);
});

// Výřez skutečného kanálu z kopidlno.cz/uredni-deska?action=atom: jen nadpis a odkazy na přílohy.
const DESK = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
 <channel>
  <title>Úřední deska | Město Kopidlno</title>
  <description>Úřední deska</description>
  <item>
   <title>Usnesení ze 101. schůze Rady města Kopidlna</title>
   <link>https://www.kopidlno.cz/uredni-deska?id=550&amp;utm_source=%C3%9A%C5%99edn%C3%AD_deska&amp;utm_medium=rss&amp;utm_campaign=550&amp;action=detail</link>
   <description>
Přílohy: 
https://www.kopidlno.cz/file.php?oid=13904853&amp;utm_source=Úřední_deska&amp;utm_medium=rss&amp;utm_campaign=550 
</description>
   <guid>https://www.kopidlno.cz/uredni-deska?id=550&amp;action=detail</guid>
   <pubDate>Tue, 29 Sep 2026 00:00:00 +0200</pubDate>
  </item>
  <item>
   <title>Rozpočtové opatření č. 15/2026</title>
   <link>https://www.kopidlno.cz/uredni-deska?id=549&amp;action=detail</link>
   <description>Přílohy: https://www.kopidlno.cz/file.php?oid=13904000</description>
   <guid>https://www.kopidlno.cz/uredni-deska?id=549&amp;action=detail</guid>
   <pubDate>Mon, 28 Sep 2026 00:00:00 +0200</pubDate>
  </item>
 </channel>
</rss>`;

test("z úřední desky jdou usnesení a zápisy dál, ostatní čekají na předvýběr, klíčem je id dokumentu, přílohy bez utm", () => {
  const { ok, items } = parseDeskFeed(DESK);
  assert.ok(ok);
  assert.deepEqual(items.map((item) => item.screen), [false, true]);
  const [item] = items;
  assert.equal(item.guid, "www.kopidlno.cz/uredni-deska/550");
  assert.equal(item.link, "https://www.kopidlno.cz/uredni-deska?id=550&action=detail");
  assert.deepEqual(item.documents, ["https://www.kopidlno.cz/file.php?oid=13904853"]);
  assert.equal(item.section, DESK_SECTION);
  assert.equal(item.publishedAt, "2026-09-28T22:00:00.000Z");
});

test("web města čte aktuality i úřední desku, stačí jedno z nich", async () => {
  const fetchImpl = async (url) => {
    if (url === DESK_FEED) return new Response(DESK);
    return new Response("nic", { status: 500 });
  };
  const result = await WEB.fetchItems(WEB.defaultFeeds, { fetchImpl });
  assert.ok(result.ok);
  assert.deepEqual(result.items.map((item) => item.guid), ["www.kopidlno.cz/uredni-deska/550", "www.kopidlno.cz/uredni-deska/549"]);
  assert.match(result.warning, /500/);
});

test("PDF z desky jde Claudovi jako dokument, zdroj je úřední deska", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 usnesení");
  const docs = await fetchDocuments(["https://www.kopidlno.cz/file.php?oid=1", "https://www.kopidlno.cz/file.php?oid=2"], {
    fetchImpl: async (url) => (url.endsWith("=1") ? new Response(pdf) : new Response("<html>")),
  });
  assert.equal(docs.length, 1);
  const item = { title: "Usnesení ze 101. schůze", text: "", documents: ["https://www.kopidlno.cz/file.php?oid=1"], section: DESK_SECTION, publishedAt: "2026-09-29T00:00:00Z" };
  const content = skolaContent(item, {}, { today: "2026-10-06", source: WEB, documents: docs });
  assert.ok(content.some((block) => block.type === "document" && block.source.media_type === "application/pdf"));
  assert.match(contentText(content), /v přiloženém dokumentu \(PDF\)/);
  assert.equal(
    skolaSource("https://www.kopidlno.cz/uredni-deska?id=550&action=detail", WEB, DESK_SECTION),
    "úřední deska města Kopidlna https://www.kopidlno.cz/uredni-deska?id=550&action=detail",
  );
  assert.match(skolaPrompt("", { source: WEB }), /Jména lidí, kteří od města kupují/);
});

test("pozvánka na akci daleko dopředu počká, akce, která proběhla, se přeskočí", () => {
  assert.deepEqual(termDays("13. 10. 2026 až 14. 10. 2026"), { from: "2026-10-13", to: "2026-10-14" });
  assert.deepEqual(termDays("22. 11. 2026"), { from: "2026-11-22", to: "2026-11-22" });
  assert.equal(termDays(""), null);
  assert.equal(termDays("31. 2. 2026"), null);
  assert.equal(termOver("24. 9. 2026", "2026-10-06"), true);
  assert.equal(termOver("6. 10. 2026", "2026-10-06"), false);
  assert.equal(termOver("", "2026-10-06"), false);
  // Akce za sedm týdnů: pozvánka deset dní před ní.
  assert.equal(deferDay({}, "2026-11-23", 10, "2026-10-06"), "2026-11-13");
  // Blízká akce se píše hned, odložená položka se podruhé neodkládá.
  assert.equal(deferDay({}, "2026-10-13", 10, "2026-10-06"), "");
  assert.equal(deferDay({ writeOn: "2026-11-13" }, "2026-11-23", 10, "2026-11-13"), "");
  assert.equal(deferDay({}, "", 10, "2026-10-06"), "");
  assert.equal(WEB.defer, true);
  assert.equal(SCHOOLS.skola.defer, undefined);
});

test("při druhém čtení Drběna ví, že akci v kalendáři dala sama", () => {
  const item = { title: "Dušedílna", text: "Zveme.", section: "Aktuality", term: "23. 11. 2026", publishedAt: "2026-10-05T17:45:51Z", writeOn: "2026-11-13", eventId: 11 };
  const text = skolaText(item, {}, { today: "2026-11-13", source: WEB, later: laterNote(item) });
  assert.match(text, /dřív dala do kalendáře \(akce:11\)/);
  assert.match(text, /event dej include false/);
  assert.equal(laterNote({ ...item, writeOn: "" }), "");
  assert.equal(laterNote({ ...item, eventId: null }), "");
});

test("odložená položka čeká a v den psaní se vrátí do fronty jako automatická", async () => {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  const env = { DB: { prepare: (sql) => statement(sql) } };
  for (const sql of schoolTables(WEB)) db.exec(sql);
  db.exec(`insert into ${WEB.itemsTable} (guid, title, term, status, manual) values ('a', 'Dušedílna', '23. 11. 2026', 'nove', 1)`);
  await deferSkolaItem(env, WEB, 1, { writeOn: "2026-11-13", eventId: 11, reason: "Nová akce." });
  assert.deepEqual(await waitingSkolaItems(env, WEB, 5), []);
  await reopenDeferred(env, WEB, "2026-11-12");
  assert.deepEqual(await waitingSkolaItems(env, WEB, 5), []);
  await reopenDeferred(env, WEB, "2026-11-13");
  const [item] = await waitingSkolaItems(env, WEB, 5);
  assert.deepEqual([item.status, item.manual, item.writeOn, item.eventId], ["nove", false, "2026-11-13", 11]);
});

test("změna dní předem přepočítá den psaní čekajících pozvánek podle dne akce", async () => {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
  });
  const env = { DB: { prepare: (sql) => statement(sql) } };
  for (const sql of schoolTables(WEB)) db.exec(sql);
  db.exec("create table events (id integer primary key, starts_on text)");
  db.exec("insert into events values (11, '2026-11-23'), (12, '2026-12-05')");
  db.exec(`insert into ${WEB.itemsTable} (guid, title, status, write_on, event_id) values
    ('a', 'Dušedílna', 'odlozeno', '2026-11-13', 11), ('b', 'Mikuláš', 'hotovo', '2026-11-25', 12), ('c', 'Bez akce', 'odlozeno', '2026-11-20', 99)`);
  await rescheduleDeferred(env, WEB, 5);
  const days = db.prepare(`select write_on from ${WEB.itemsTable} order by id`).all().map((row) => row.write_on);
  assert.deepEqual(days, ["2026-11-18", "2026-11-25", "2026-11-20"]);
});

test("plakáty odložené položky počkají v R2, po pozvánce zůstane jen ten, který zpráva použila", async () => {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  const files = new Map();
  const BUCKET = {
    put: async (key, bytes, { httpMetadata }) => files.set(key, { bytes: new Uint8Array(bytes), httpMetadata }),
    get: async (key) => (files.has(key) ? { httpMetadata: files.get(key).httpMetadata, arrayBuffer: async () => files.get(key).bytes.buffer } : null),
    delete: async (key) => files.delete(key),
  };
  const env = { DB: { prepare: (sql) => statement(sql) }, BUCKET };
  for (const sql of schoolTables(WEB)) db.exec(sql);
  for (const table of ["stock_images", "articles", "proposals", "ads", "ad_proposals"]) db.exec(`create table ${table} (image_key text, attachments text default '')`);
  db.exec(`insert into ${WEB.itemsTable} (guid, title, status) values ('a', 'Drakiáda', 'nove')`);
  const poster = { type: "image/webp", bytes: new Uint8Array([1, 2, 3]).buffer };
  await deferSkolaItem(env, WEB, 1, { writeOn: "2026-11-12", eventId: 13, reason: "", images: [poster, poster] });
  await reopenDeferred(env, WEB, "2026-11-12");
  const [item] = await waitingSkolaItems(env, WEB, 1);
  assert.equal(item.keptImages.length, 2);
  const images = await loadKeptImages(env, item.keptImages);
  assert.deepEqual([...images[0].bytes], [1, 2, 3]);
  assert.equal(images[0].key, item.keptImages[0]);
  db.prepare("insert into proposals (image_key) values (?)").run(item.keptImages[0]);
  await releaseKeptImages(env, WEB, item);
  assert.deepEqual([...files.keys()], [item.keptImages[0]]);
  const [after] = (await waitingSkolaItems(env, WEB, 1)) ?? [];
  assert.deepEqual(after.keptImages, []);
});

test("předvýběr desky: zajímavé nadpisy projdou, nezajímavé se uloží jako přeskočené, známé a neposouzené se nevolají", async () => {
  const item = (id, title, screen = true) => ({ guid: `d/${id}`, link: `l/${id}`, title, screen, documents: ["x"] });
  const items = [item(1, "Usnesení rady", false), item(2, "Anketa o osadních výborech"), item(3, "Rozpočtové opatření"), item(4, "Dražba"), item(5, "Neposouzené")];
  const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ guid: "d/4" }] }) }) }) } };
  let asked = [];
  const ask = async (_env, titles) => {
    asked = titles;
    return { ok: true, found: new Map([["0", { interesting: true, reason: "" }], ["1", { interesting: false, reason: "Formalita." }]]) };
  };
  const out = await screenDesk(env, WEB, items, { ask });
  assert.deepEqual(asked, ["Anketa o osadních výborech", "Rozpočtové opatření", "Neposouzené"]);
  assert.deepEqual(out.map((entry) => entry.guid), ["d/1", "d/2", "d/3"]);
  assert.equal(out[1].screen, undefined);
  assert.equal(out[1].status, undefined);
  assert.equal(out[2].status, "preskoceno");
  assert.match(out[2].reason, /Formalita/);
  const failed = await screenDesk(env, WEB, items, { ask: async () => ({ ok: false, error: "x" }) });
  assert.deepEqual(failed.map((entry) => entry.guid), ["d/1"]);
});
