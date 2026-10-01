import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText, imagesIn, parseFeed, readFeedUrl } from "../src/munipolis/feed.js";
import { contextText, outputSchema, readDecision, systemPrompt, userText, DEFAULT_VOICE } from "../src/munipolis/ai.js";
import { outcomeOf, sourceParagraph } from "../src/munipolis/run.js";
import { sinceFor } from "../src/munipolis/store.js";
import { noticeBoard, noticePhase, noticeSpan, parseNoticeInput } from "../src/notices.js";
import { outagesPage, homePage } from "../src/view.js";
import { adminMunipolis, adminOutages } from "../src/admin/index.js";
import { refLink } from "../src/admin/munipolis.js";

const FEED = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel><title>RSS 2.0 Feed</title>
<item>
<title>INFORMACE PRO OBČANY</title>
<description><![CDATA[<p>Ve <strong>čtvrtek 1. 10. 2026 od 7:30 do 15:00</strong> nepoteče voda v ulicích:</p>
<p><strong>Hilmarova, Husova</strong> a&nbsp;polovina náměstí.</p><img src="https://timeline-storage.munipolis.com/images/a.jpg">]]></description>
<pubDate>Tue, 29 Sep 2026 16:48:29 +0200</pubDate>
<link>https://kopidlno.munipolis.cz/nastenka/3987015</link>
<guid isPermaLink="false">https://kopidlno.munipolis.cz/nastenka/3987015</guid>
</item>
<item>
<title>Podzimní bazárek &amp; burza 🍂</title>
<description><![CDATA[<ul><li>oblečení</li><li>hračky</li></ul>]]></description>
<pubDate>Mon, 28 Sep 2026 10:00:00 +0200</pubDate>
<link>https://kopidlno.munipolis.cz/nastenka/1</link>
<guid isPermaLink="false">https://kopidlno.munipolis.cz/nastenka/1</guid>
</item>
</channel></rss>`;

const SLUGS = ["zpravy", "komunita", "kultura", "prakticke", "sport"];

test("RSS z Munipolisu se rozloží na zprávy s textem a obrázky", () => {
  const parsed = parseFeed(FEED);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items.length, 2);
  const [water, bazaar] = parsed.items;
  assert.equal(water.guid, "https://kopidlno.munipolis.cz/nastenka/3987015");
  assert.equal(water.publishedAt, "2026-09-29T14:48:29.000Z");
  assert.match(water.text, /od 7:30 do 15:00/);
  assert.match(water.text, /a polovina náměstí/);
  assert.deepEqual(water.images, ["https://timeline-storage.munipolis.com/images/a.jpg"]);
  assert.equal(bazaar.title, "Podzimní bazárek & burza 🍂");
  assert.match(bazaar.text, /• oblečení\n• hračky/);
  assert.equal(parseFeed("<html>403</html>").ok, false);
});

test("text a obrázky z HTML zprávy", () => {
  assert.equal(htmlToText("<p>A<br>B</p><p>C</p>"), "A\nB\n\nC");
  assert.deepEqual(imagesIn('<img src="http://x/a.png"><img src="https://x/b.png">'), ["https://x/b.png"]);
  assert.equal(readFeedUrl(""), "https://kopidlno.munipolis.cz/rss");
  assert.equal(readFeedUrl("http://kopidlno.munipolis.cz/rss"), "");
});

test("schéma pro Claude má u všech objektů zakázané další vlastnosti a rubriky z webu", () => {
  const schema = outputSchema(SLUGS);
  const objects = [schema, schema.properties.article, schema.properties.event, schema.properties.notice];
  for (const object of objects) {
    assert.equal(object.additionalProperties, false);
    assert.deepEqual([...object.required].sort(), Object.keys(object.properties).sort());
  }
  assert.deepEqual(schema.properties.article.properties.rubric.enum, SLUGS);
});

test("pokyny pro Claude obsahují hlas Drběny, přehled webu a zprávu", () => {
  assert.match(systemPrompt(""), /koza Drběna/);
  assert.match(systemPrompt("Piš jako básník."), /Piš jako básník\./);
  const known = {
    articles: [{ id: 12, createdOn: "2026-09-28", title: "Bazárek je tu", excerpt: "Přineste věci." }],
    proposals: [],
    events: [{ id: 3, startsOn: "2026-10-05", startsTime: "17:00", title: "Rodokmeny", place: "KVC" }],
    notices: [{ id: 4, kind: "voda", startsOn: "2026-10-01", startsTime: "07:30", title: "Nepoteče voda", places: ["Husova"] }],
    imports: [],
  };
  const context = contextText(known);
  assert.match(context, /\[zprava:12\] 2026-09-28 · Bazárek je tu/);
  assert.match(context, /\[akce:3\] 2026-10-05 17:00 · Rodokmeny · KVC/);
  assert.match(context, /\[odstavka:4\] voda 2026-10-01 07:30/);
  const text = userText({ title: "Bazárek", text: "Text", publishedAt: "2026-09-29T10:00:00Z" }, known, { today: "2026-10-01" });
  assert.match(text, /Dnes je 2026-10-01\./);
  assert.match(text, /zveřejněno 2026-09-29/);
  assert.doesNotMatch(text, /Nevracej/);
  assert.match(userText({ title: "x", text: "" }, known, { today: "2026-10-01", force: true }), /Nevracej/);
});

function answer(overrides = {}) {
  return {
    decision: "vytvorit",
    reason: "Pozvánka na přednášku.",
    duplicate_of: "",
    article: { include: false, title: "", excerpt: "", body_html: "", rubric: "zpravy", image_caption: "" },
    event: { include: false, title: "", place: "", date: "", time: "", description: "" },
    notice: { include: false, kind: "voda", title: "", starts_on: "", starts_time: "", ends_on: "", ends_time: "", places: [], note: "" },
    ...overrides,
  };
}

test("rozhodnutí Claude se ověří a převede na zprávu, akci a odstávku", () => {
  const result = readDecision(
    answer({
      article: {
        include: true,
        title: "Mééé, kdo jsou naši předci?",
        excerpt: "V pondělí přednáška o rodokmenech.",
        body_html: '<p>Přijďte!</p><script>alert(1)</script><img src="x">',
        rubric: "kultura",
        image_caption: "Plakát",
      },
      event: { include: true, title: "Rodokmeny", place: "KVC Kopidlno", date: "2026-10-05", time: "17:00", description: "Vstup zdarma." },
      notice: {
        include: true,
        kind: "voda",
        title: "",
        starts_on: "2026-10-01",
        starts_time: "7:30",
        ends_on: "",
        ends_time: "15:00",
        places: ["Hilmarova", "Husova", "hilmarova"],
        note: "Cisterna projíždí.",
      },
    }),
    { rubricSlugs: SLUGS },
  );
  assert.equal(result.ok, true);
  assert.equal(result.article.body, "<p>Přijďte!</p>");
  assert.equal(result.article.rubric, "kultura");
  assert.deepEqual(result.event, { title: "Rodokmeny", place: "KVC Kopidlno", startsOn: "2026-10-05", startsTime: "17:00", description: "Vstup zdarma." });
  assert.equal(result.notice.title, "Nepoteče voda");
  assert.equal(result.notice.startsTime, "07:30");
  assert.deepEqual(result.notice.places, ["Hilmarova", "Husova"]);
});

test("duplicita a přeskočení nic nevytvoří, vynucené zpracování ano", () => {
  const duplicate = readDecision(answer({ decision: "duplicita", duplicate_of: "zprava:12", reason: "Už je tam." }), { rubricSlugs: SLUGS });
  assert.deepEqual(
    { decision: duplicate.decision, duplicateOf: duplicate.duplicateOf, article: duplicate.article },
    { decision: "duplicita", duplicateOf: "zprava:12", article: null },
  );
  assert.equal(readDecision(answer({ decision: "duplicita", duplicate_of: "cokoli" }), { rubricSlugs: SLUGS }).duplicateOf, "");
  const forced = readDecision(
    answer({
      decision: "duplicita",
      article: { include: true, title: "Nadpis", excerpt: "Perex.", body_html: "<p>Text.</p>", rubric: "zpravy", image_caption: "" },
    }),
    { rubricSlugs: SLUGS, force: true },
  );
  assert.equal(forced.decision, "vytvorit");
  assert.ok(forced.article);
});

test("neplatná odpověď Claude skončí chybou", () => {
  assert.equal(readDecision(null, { rubricSlugs: SLUGS }).ok, false);
  assert.equal(readDecision({ decision: "nevim" }, { rubricSlugs: SLUGS }).ok, false);
  const badRubric = readDecision(
    answer({ article: { include: true, title: "Nadpis", excerpt: "Perex.", body_html: "<p>Text.</p>", rubric: "neni", image_caption: "" } }),
    { rubricSlugs: SLUGS },
  );
  assert.equal(badRubric.ok, false);
  const badEvent = readDecision(answer({ event: { include: true, title: "Akce", place: "Sokolovna", date: "5. 10.", time: "", description: "" } }), {
    rubricSlugs: SLUGS,
  });
  assert.equal(badEvent.ok, false);
});

test("odkaz na zdroj a shrnutí výsledku pro další zprávy", () => {
  assert.equal(
    sourceParagraph('https://kopidlno.munipolis.cz/nastenka/1?a=1&b="2"'),
    '<p><em>Zdroj: <a href="https://kopidlno.munipolis.cz/nastenka/1?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noopener noreferrer">Munipolis města Kopidlna</a></em></p>',
  );
  assert.equal(outcomeOf({ status: "hotovo", proposalId: 5, eventId: 3 }), "zpracováno (navrh:5, akce:3)");
  assert.equal(outcomeOf({ status: "duplicita", duplicateOf: "zprava:12" }), "duplicita s zprava:12");
});

test("při prvním zapnutí se import omezí na poslední tři dny", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  assert.equal(sinceFor("", true, now), "2026-09-28T10:00:00.000Z");
  assert.equal(sinceFor("2026-01-01T00:00:00.000Z", true, now), "2026-01-01T00:00:00.000Z");
  assert.equal(sinceFor("", false, now), "");
});

test("oznámení o vodě se ověří a dostane fázi a čas", () => {
  assert.equal(parseNoticeInput({ kind: "plyn" }).ok, false);
  assert.equal(parseNoticeInput({ kind: "voda", startsOn: "2026-10-01", places: "" }).ok, false);
  assert.equal(parseNoticeInput({ kind: "voda", startsOn: "2026-10-02", endsOn: "2026-10-01", places: "A" }).ok, false);
  assert.equal(parseNoticeInput({ kind: "voda", startsOn: "2026-10-01", startsTime: "15:00", endsTime: "07:30", places: "A" }).ok, false);
  const { notice } = parseNoticeInput({
    kind: "voda",
    startsOn: "2026-10-01",
    startsTime: "07:30",
    endsOn: "2026-10-01",
    endsTime: "15:00",
    places: "Hilmarova\n\nHusova",
    sourceUrl: "javascript:alert(1)",
    published: true,
  });
  assert.equal(notice.endsOn, "");
  assert.equal(notice.sourceUrl, "");
  assert.deepEqual(notice.places, ["Hilmarova", "Husova"]);
  assert.equal(noticeSpan(notice), "Čtvrtek 1. října, 07:30–15:00");
  assert.equal(noticePhase(notice, new Date("2026-10-01T04:00:00Z")), "soon");
  assert.equal(noticePhase(notice, new Date("2026-10-01T08:00:00Z")), "now");
  assert.equal(noticePhase(notice, new Date("2026-10-01T14:00:00Z")), "past");
  assert.equal(noticePhase(notice, new Date("2026-09-01T08:00:00Z")), "later");
  assert.equal(noticeSpan({ startsOn: "2026-10-01", startsTime: "", endsOn: "2026-10-03", endsTime: "12:00" }), "Čtvrtek 1. října – sobota 3. října 12:00");
});

test("na web jde jen zveřejněná voda, uzavírky zatím ne", () => {
  const base = { startsOn: "2026-10-01", startsTime: "07:30", endsOn: "", endsTime: "15:00", places: ["Husova"], note: "", sourceUrl: "" };
  const board = noticeBoard(
    [
      { ...base, id: 1, kind: "voda", title: "Nepoteče voda", published: true },
      { ...base, id: 2, kind: "voda", title: "Skrytá", published: false },
      { ...base, id: 3, kind: "uzavirka", title: "Uzavírka", published: true },
      { ...base, id: 4, kind: "voda", title: "Proběhlá", published: true, startsOn: "2026-09-01" },
    ],
    new Date("2026-10-01T08:00:00Z"),
  );
  assert.deepEqual(board.map((item) => item.id), [1]);
  assert.equal(board[0].state, "Právě neteče");
});

const CTX = { path: "/odstavky", copy: {}, mainOrigin: "", origin: "" };

test("stránka odstávek a titulka ukážou vodu", () => {
  const water = noticeBoard(
    [{ id: 1, kind: "voda", title: "Nepoteče voda", startsOn: "2026-10-01", startsTime: "07:30", endsOn: "", endsTime: "15:00", places: ["Husova"], note: "Cisterna projíždí.", sourceUrl: "https://kopidlno.munipolis.cz/nastenka/1", published: true }],
    new Date("2026-10-01T08:00:00Z"),
  );
  const page = outagesPage({ outages: { items: [], areas: [{ code: "573060", name: "Kopidlno" }], fetchedAt: "2026-10-01T08:00:00Z", checked: "" }, water }, CTX);
  assert.match(page, /<h2>Nepoteče voda<\/h2>/);
  assert.match(page, /Právě neteče/);
  assert.match(page, /Cisterna projíždí\./);
  assert.match(page, /href="https:\/\/kopidlno\.munipolis\.cz\/nastenka\/1"/);
  const empty = outagesPage({ outages: { items: [], areas: [], fetchedAt: null }, water: [] }, CTX);
  assert.doesNotMatch(empty, /Nepoteče voda/);
});

test("redakce Munipolisu ukáže stav, zprávy a detail", () => {
  const data = {
    signedIn: true,
    user: { id: 1, role: "hlavni", name: "Redakce", permissions: [] },
    hasApiKey: false,
    importSettings: { enabled: true, autoPublish: false, feedUrl: "https://kopidlno.munipolis.cz/rss", voice: "", checkedAt: "2026-10-01T09:00:00Z", status: "ok", note: "Nic nového." },
    importItems: [
      { id: 7, guid: "g", link: "https://kopidlno.munipolis.cz/nastenka/1", title: "Bazárek", text: "Přineste věci.\n\nDíky.", images: [], publishedAt: "2026-09-29T10:00:00Z", status: "duplicita", reason: "Už je tam.", duplicateOf: "zprava:12", articleId: null, proposalId: null, eventId: null, noticeId: null },
      { id: 8, guid: "h", link: "", title: "Voda", text: "", images: [], publishedAt: "2026-09-30T10:00:00Z", status: "chyba", reason: "Claude neodpověděl.", duplicateOf: "", articleId: null, proposalId: null, eventId: null, noticeId: null },
    ],
  };
  const page = adminMunipolis(CTX, data, { text: "", kind: "ok" }, { importId: 7 });
  assert.match(page, /Naposledy zkontrolováno 1\. 10\. 2026 v 11:00\./);
  assert.match(page, /ANTHROPIC_API_KEY/);
  assert.match(page, /Stejné jako <a href="\/redakce\/zpravy\?id=12">Zpráva #12<\/a>/);
  assert.match(page, /Přesto zpracovat/);
  assert.match(page, /<p>Přineste věci\.<\/p><p>Díky\.<\/p>/);
  assert.match(page, /adm-count[^>]*>1</);
  assert.equal(refLink("nic:1"), "");
  assert.equal(refLink("akce:3"), '<a href="/redakce/akce?id=3">Akce #3</a>');
});

test("redakce odstávek ukáže vodu ke schválení a uzavírky bokem", () => {
  const data = {
    signedIn: true,
    user: { id: 1, role: "hlavni", name: "Redakce", permissions: [] },
    outageAreas: [],
    outages: { items: [], areas: [], checked: "", note: "" },
    notices: [
      { id: 1, kind: "voda", title: "Nepoteče voda", startsOn: "2099-10-01", startsTime: "07:30", endsOn: "", endsTime: "15:00", places: ["Husova"], note: "", sourceUrl: "https://kopidlno.munipolis.cz/nastenka/1", published: false },
      { id: 2, kind: "uzavirka", title: "Uzavírka II/280", startsOn: "2099-10-01", startsTime: "", endsOn: "2099-10-20", endsTime: "", places: ["Hilmarovo náměstí"], note: "", sourceUrl: "", published: true },
    ],
  };
  const page = adminOutages(CTX, data, { text: "", kind: "ok" }, { noticeId: 1 });
  assert.match(page, /Čeká na schválení/);
  assert.match(page, /Uzavírky se zatím na webu neukazují/);
  assert.match(page, /Zkontrolovat oznámení/);
  assert.match(page, /připravila Koza Drběna/);
});

test("titulka ukáže odstávku vody mezi odstávkami", () => {
  const water = noticeBoard(
    [{ id: 1, kind: "voda", title: "Nepoteče voda", startsOn: "2026-10-01", startsTime: "07:30", endsOn: "", endsTime: "15:00", places: ["Husova"], note: "", sourceUrl: "", published: true }],
    new Date("2026-10-01T08:00:00Z"),
  );
  const waste = { today: "2026-10-01", nextDate: "2026-10-05", daysUntil: 4, note: "", holidayNote: "", weekday: 1, weekParity: 1, stepDays: 14 };
  const bare = { articles: [], events: [], yards: [], doctors: [], waste, ads: [], contactNote: "", now: { date: "2026-10-01", time: "10:00" } };
  const home = homePage({ ...bare, water }, { ...CTX, path: "/" });
  assert.match(home, /<p class="yard-home-name">Nepoteče voda<\/p>\s*<p class="yard-home-state">Právě neteče<\/p>/);
  assert.match(home, /href="\/odstavky"/);
  assert.doesNotMatch(homePage(bare, { ...CTX, path: "/" }), /Nepoteče voda/);
  assert.ok(DEFAULT_VOICE.length > 50);
});
