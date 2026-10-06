import assert from "node:assert/strict";
import test from "node:test";
import { adminSkola } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { skolaPrompt, skolaText } from "../src/skola/ai.js";
import { parseSchoolFeed } from "../src/skola/feed.js";
import { photoCaption, skolaSource } from "../src/skola/run.js";
import { SCHOOLS } from "../src/skola/sources.js";

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
