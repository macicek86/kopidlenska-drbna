import assert from "node:assert/strict";
import test from "node:test";
import { adminDenik } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { copiedRun, denikPrompt, denikProblem, denikText } from "../src/denik/ai.js";
import { aboutKopidlno, articleText, cleanLink, isFootball, pickItems } from "../src/denik/feed.js";
import { denikSource } from "../src/denik/run.js";
import { parseFeed } from "../src/munipolis/feed.js";

const FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>Jičínský deník</title>
<item>
<title>Kříž na návsi v Žitětíně září novotou</title>
<link>https://jicinsky.denik.cz/zpravy_region/kriz-zitetin.html?utm_source=rss&amp;utm_medium=feed</link>
<description>Obec Jičíněves nechala zrestaurovat kříž.</description>
<pubDate>Wed, 30 Sep 2026 09:00:00 +0200</pubDate>
</item>
<item>
<title>Hasiči z Drahorazi slaví 130 let</title>
<link>https://jicinsky.denik.cz/zpravy_region/hasici-drahoraz.html?utm_source=rss</link>
<description>Sbor oslaví výročí v sobotu na hřišti.</description>
<pubDate>Wed, 30 Sep 2026 10:00:00 +0200</pubDate>
</item>
<item>
<title>Třináct gólů! Domácí přežili divokou přestřelku</title>
<link>https://jicinsky.denik.cz/fotbal-okres/trinact-golu-v-kopidlne/?utm_source=rss</link>
<description>Úplně nejvíc gólů padlo v Kopidlně.</description>
<pubDate>Wed, 30 Sep 2026 11:00:00 +0200</pubDate>
</item>
</channel></rss>`;

test("z Deníku se berou jen články o Kopidlnu a jeho částech, fotbal jen na přání", () => {
  const { items } = parseFeed(FEED);
  assert.deepEqual(pickItems(items).map((item) => item.title), ["Hasiči z Drahorazi slaví 130 let"]);
  const all = pickItems(items, { football: true });
  assert.equal(all.length, 2);
  assert.equal(all[1].guid, "https://jicinsky.denik.cz/fotbal-okres/trinact-golu-v-kopidlne/");
  assert.equal(isFootball(all[1]), true);
});

test("pozná Kopidlno a části ve všech pádech, ale ne obyčejný mlýnek", () => {
  const about = (title) => aboutKopidlno({ title, text: "", link: "" });
  for (const title of ["V Kopidlně", "Kopidlenská pouť", "z Drahorazi", "v Mlýnci", "Mlýnec", "v Pševsi", "Pševes", "v Ledkově"]) {
    assert.equal(about(title), true, title);
  }
  assert.equal(about("Nový mlýnec na kávu"), false);
  assert.equal(about("Jičín"), false);
  assert.equal(cleanLink("https://x.cz/a/?utm_source=rss&amp;b=1#c"), "https://x.cz/a/");
});

test("ze stránky článku jen perex a volná část před paywallem", () => {
  const page = `<h1>Nadpis</h1><p class="text-xl js-article-perex"><strong>Perex článku.</strong></p>
    <section class="article-body"><div class="article-body-blocks js-article-perex"><h3>Mezititulek</h3><p>Volný odstavec.</p>
    <script>track()</script><div id="content_break" class="js-paywall"></div><p>Placený text.</p></div></section>`;
  const text = articleText(page);
  assert.match(text, /^Perex článku\./);
  assert.match(text, /Volný odstavec\./);
  assert.doesNotMatch(text, /Placený|track|content_break/);
});

test("pokyny zakazují citace a zmínky o Deníku", () => {
  const prompt = denikPrompt("");
  assert.match(prompt, /Žádné citace/);
  assert.match(prompt, /jak píše Jičínský deník/);
  assert.match(prompt, /koza Drběna/);
  const text = denikText({ title: "Hasiči", text: "Text", publishedAt: "2026-09-30T08:00:00Z" }, { imports: [{ id: 2, tag: "denik", publishedOn: "2026-09-29", title: "Pouť", outcome: "přeskočeno" }] }, { today: "2026-10-01" });
  assert.match(text, /zveřejněno 2026-09-30/);
  assert.match(text, /\[denik:2\] 2026-09-29 · Pouť/);
});

test("výsledek, který cituje nebo zmiňuje Deník, neprojde", () => {
  const source = { title: "Hasiči z Drahorazi slaví 130 let", text: "Sbor dobrovolných hasičů z Drahorazi oslaví v sobotu na hřišti sto třicet let od svého založení." };
  const answer = (body, title = "Drahorazští hasiči mají kulatiny") => ({ article: { title, excerpt: "V sobotu se slaví.", body } });
  assert.equal(denikProblem(answer("<p>Drahorazský sbor má v sobotu narozeniny, slavit se bude na hřišti.</p>"), source), "");
  assert.match(denikProblem(answer("<p>Jak píše Jičínský deník, slaví se.</p>"), source), /zmínila zdroj/);
  assert.match(denikProblem(answer("<p>Podle médií se slaví.</p>"), source), /zmínila zdroj/);
  assert.match(denikProblem(answer("<p>Slaví se.</p>", "Hasiči z Drahorazi slaví 130 let"), source), /nadpis/);
  assert.match(denikProblem(answer("<p>Sbor dobrovolných hasičů z Drahorazi oslaví v sobotu na hřišti výročí.</p>"), source), /opsala/);
  assert.equal(copiedRun("jedna dva tři", "jedna dva tři"), "");
});

test("odkaz na zdroj jen se zapnutým nastavením a redakce má stránku Deník", () => {
  assert.equal(denikSource("https://jicinsky.denik.cz/a", false), "");
  assert.match(denikSource("https://jicinsky.denik.cz/a?x=1&y=2", true), /href="https:\/\/jicinsky\.denik\.cz\/a\?x=1&amp;y=2"/);
  assert.equal(refLink("denik:4"), '<a href="/redakce/denik?zprava=4">Zpráva z Deníku #4</a>');
  const page = adminDenik(
    { path: "/redakce/denik", copy: {} },
    {
      signedIn: true,
      user: { role: "hlavni", name: "Jana", login: "jana" },
      hasApiKey: true,
      denikSettings: { enabled: false, autoPublish: false, feedUrl: "", freshDays: 3, football: false, sourceLink: false, note: "", status: "" },
      denikItems: [{ id: 4, title: "Hasiči z Drahorazi", text: "Perex", link: "https://jicinsky.denik.cz/a", publishedAt: "2026-09-30T08:00:00Z", status: "nacteno", reason: "", duplicateOf: "", manual: false, attempts: 0 }],
    },
    null,
    { importId: 4 },
  );
  assert.match(page, /Články o Kopidlnu/);
  assert.match(page, /Hasiči z Drahorazi/);
  assert.match(page, /name="withFootball"/);
  assert.match(page, /name="sourceLink"/);
  assert.match(page, /Článek na Deníku/);
});
