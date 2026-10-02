import assert from "node:assert/strict";
import test from "node:test";
import { articlePage } from "../src/news.js";
import { jsonLdTag, pragueOffset, robotsTxt, sitemapXml } from "../src/seo.js";
import { eventsPage, homePage, missingPage } from "../src/view.js";

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

test("chybějící stránka se nemá indexovat", () => {
  const html = missingPage(ctx);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.equal(html.includes('rel="canonical"'), false);
});
