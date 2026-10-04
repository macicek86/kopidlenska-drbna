import assert from "node:assert/strict";
import test from "node:test";
import { articlePage } from "../src/news.js";
import { jsonLdTag, pragueOffset, robotsTxt, sitemapXml } from "../src/seo.js";
import { eventsPage, homePage } from "../src/view.js";
import { notFoundPage } from "../src/notfound-view.js";

const ctx = { path: "/", copy: {}, minimal: false, mainOrigin: "https://drbna.test", origin: "https://drbna.test" };

function ldOf(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

test("robots.txt zakáže redakci a ukáže sitemapu", () => {
  const text = robotsTxt("https://drbna.test");
  assert.match(text, /Disallow: \/redakce/);
  assert.match(text, /Sitemap: https:\/\/drbna.test\/sitemap.xml/);
});

test("sitemap má stránky, rubriky, zprávy i reklamy", () => {
  const data = {
    articles: [{ slug: "nova-lavicka", createdOn: "2026-10-01" }],
    ads: [{ slug: "kolo", createdOn: "2026-09-20" }],
    rubrics: [{ slug: "sport" }],
  };
  const xml = sitemapXml("https://drbna.test", data);
  assert.match(xml, /<loc>https:\/\/drbna.test\/zpravy\/nova-lavicka<\/loc><lastmod>2026-10-01<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/drbna.test\/zpravy\?rubrika=sport<\/loc>/);
  assert.match(xml, /<loc>https:\/\/drbna.test\/reklamy\/kolo<\/loc>/);
  assert.match(xml, /<loc>https:\/\/drbna.test\/lekari<\/loc>/);
  const minimal = sitemapXml("https://popelnice.drbna.test", data, { minimal: true });
  assert.equal(minimal.match(/<url>/g).length, 1);
});

test("JSON-LD neuzavře značku textem z článku", () => {
  const tag = jsonLdTag({ "@type": "Thing", name: "</script><b>" });
  assert.equal(tag.includes("</script><b>"), false);
  assert.match(tag, /\\u003c\/script>/);
});

test("titulka nese WebSite a vydavatele", () => {
  const waste = { today: "2026-10-02", nextDate: "2026-10-05", daysUntil: 3, upcoming: [], note: "", holidayNote: "" };
  const html = homePage({ articles: [], events: [], yards: [], doctors: [], waste, ads: [], contactNote: "" }, ctx);
  const [ld] = ldOf(html);
  assert.deepEqual(ld["@graph"].map((item) => item["@type"]), ["WebSite", "NewsMediaOrganization"]);
  assert.match(html, /<link rel="canonical" href="https:\/\/drbna.test\/">/);
});

test("zpráva má NewsArticle, drobečky, fotku a og:type article", () => {
  const article = {
    slug: "nova-lavicka",
    title: "Nová lavička",
    excerpt: "Na náměstí přibyla lavička.",
    body: "<p>Text</p>",
    category: "Obec",
    rubricSlug: "obec",
    parentName: "",
    parentSlug: "",
    imageKey: "zpravy/lavicka.webp",
    createdOn: "2026-10-01",
    authorName: "Jana",
  };
  const html = articlePage(article, { ...ctx, path: "/zpravy/nova-lavicka" }, { ad: null });
  const [news, crumbs] = ldOf(html)[0]["@graph"];
  assert.equal(news["@type"], "NewsArticle");
  assert.equal(news.datePublished, "2026-10-01");
  assert.deepEqual(news.image, ["https://drbna.test/media/zpravy/lavicka.webp"]);
  assert.equal(news.author.name, "Jana");
  assert.equal(crumbs.itemListElement.length, 3);
  assert.match(html, /<meta property="og:type" content="article">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/drbna.test\/media\/zpravy\/lavicka.webp">/);
});

test("akce mají Event s časem v pražském pásmu", () => {
  assert.equal(pragueOffset("2026-07-01"), "+02:00");
  assert.equal(pragueOffset("2026-12-01"), "+01:00");
  const waste = { today: "2026-10-02" };
  const events = [{ title: "Posvícení", place: "Náměstí", startsOn: "2026-10-10", startsTime: "14:00", description: "" }];
  const [ld] = ldOf(eventsPage({ events, waste, ads: [] }, { ...ctx, path: "/akce" }));
  assert.equal(ld["@type"], "Event");
  assert.equal(ld.startDate, "2026-10-10T14:00+02:00");
});

test("akce odkazuje na svou zprávu a na odkaz jinam", () => {
  const waste = { today: "2026-10-02" };
  const events = [
    { title: "Posvícení", place: "Náměstí", startsOn: "2026-10-10", startsTime: "", description: "", articleSlug: "posviceni", link: "https://www.kopidlno.cz/posviceni" },
    { title: "Drakiáda", place: "Louka", startsOn: "2026-10-11", startsTime: "", description: "", articleSlug: "", link: "javascript:alert(1)" },
  ];
  const html = eventsPage({ events, waste, ads: [] }, { ...ctx, path: "/akce" });
  assert.match(html, /<a href="\/zpravy\/posviceni">Víc ve zprávě ›<\/a>/);
  assert.match(html, /href="https:\/\/www.kopidlno.cz\/posviceni" target="_blank" rel="noopener nofollow">kopidlno.cz ↗/);
  assert.equal(html.includes("javascript:"), false);
  const [ld] = ldOf(html);
  assert.equal(ld["@graph"][0].url, "https://drbna.test/zpravy/posviceni");
  assert.equal(ld["@graph"][1].url, "https://drbna.test/akce");
});

test("chybějící stránka se nemá indexovat", () => {
  const html = notFoundPage(ctx, { ad: { id: 1, title: "Pekárna", body: "Rohlíky", slug: "pekarna" } });
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /drbena-404\.webp/);
  assert.match(html, /<a class="btn btn-primary" href="\/">/);
  assert.match(html, /<a href="\/akce">/);
  assert.match(html, /class="ad-panel/);
  assert.equal(html.includes('rel="canonical"'), false);
});
