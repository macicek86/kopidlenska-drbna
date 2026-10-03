import assert from "node:assert/strict";
import test from "node:test";
import { adminSkola } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { skolaPrompt, skolaText } from "../src/skola/ai.js";
import { photoCaption, skolaSource } from "../src/skola/run.js";
import { SCHOOLS } from "../src/skola/sources.js";
import { fetchWordpressPosts, parseWordpressPosts } from "../src/skola/wordpress.js";

const ZAHRADKA = SCHOOLS.zahradka;

// Výřez skutečné odpovědi z wp-json/wp/v2/posts?_embed=1 webu zahradnické školy.
const post = (id, title, category, extra = {}) => ({
  id,
  date: "2026-06-05T11:10:08",
  date_gmt: "2026-06-05T09:10:08",
  link: `http://www.zahradnicka-skola-kopidlno.cz/aktuality/${title.toLowerCase().replace(/[^a-z]+/g, "-")}/`,
  title: { rendered: title },
  content: {
    rendered: `<p>Studentky obsadily 2.&nbsp;místo.</p><a href='http://www.zahradnicka-skola-kopidlno.cz/img/'><img width="150" height="150" src="http://www.zahradnicka-skola-kopidlno.cz/wp-content/uploads/2026/06/kotva-150x150.jpg" /></a>`,
  },
  _embedded: {
    "wp:featuredmedia": [
      {
        source_url: "https://www.zahradnicka-skola-kopidlno.cz/wp-content/uploads/2026/06/kotva.jpg",
        media_details: {
          sizes: {
            thumbnail: { source_url: "https://www.zahradnicka-skola-kopidlno.cz/wp-content/uploads/2026/06/kotva-150x150.jpg" },
            large: { source_url: "https://www.zahradnicka-skola-kopidlno.cz/wp-content/uploads/2026/06/kotva-1024x768.jpg" },
          },
        },
      },
    ],
    "wp:term": [[{ taxonomy: "category", name: category }], []],
  },
  ...extra,
});

test("z WordPressu se bere text, rubrika, velká hlavní fotka a adresy přes https", () => {
  const { ok, items } = parseWordpressPosts([post(6770, "Děčínská kotva 2026 &#8211; Mistrovství floristů ČR", "Aktuality")]);
  assert.equal(ok, true);
  const [item] = items;
  assert.equal(item.title, "Děčínská kotva 2026 – Mistrovství floristů ČR");
  assert.equal(item.section, "Aktuality");
  assert.equal(item.publishedAt, "2026-06-05T09:10:08.000Z");
  assert.match(item.link, /^https:\/\/www\.zahradnicka-skola-kopidlno\.cz\/aktuality\//);
  assert.match(item.guid, /^www\.zahradnicka-skola-kopidlno\.cz\//);
  assert.match(item.text, /2\. místo/);
  assert.deepEqual(item.images, [
    "https://www.zahradnicka-skola-kopidlno.cz/wp-content/uploads/2026/06/kotva-1024x768.jpg",
    "https://www.zahradnicka-skola-kopidlno.cz/wp-content/uploads/2026/06/kotva-150x150.jpg",
  ]);
});

test("projekty k dotacím se vůbec nenačtou, nefunkční web je chyba", async () => {
  const json = [post(1, "Šablony OP JAK", "Projekty"), post(2, "Jarní seminář", "Semináře pro veřejnost")];
  const ok = await ZAHRADKA.fetchItems(ZAHRADKA.defaultFeeds, { fetchImpl: async () => new Response(JSON.stringify(json)) });
  assert.deepEqual(ok.items.map((item) => item.title), ["Jarní seminář"]);
  const broken = await fetchWordpressPosts(ZAHRADKA.defaultFeeds, { fetchImpl: async () => new Response("<html>", { status: 200 }) });
  assert.equal(broken.ok, false);
});

test("pokyny zahradnické školy: jen úspěchy, trhy a semináře, vlastní rubrika", () => {
  const prompt = skolaPrompt("", { source: ZAHRADKA });
  assert.match(prompt, /úspěchy studentů, zahradnické trhy a semináře pro veřejnost/);
  assert.match(prompt, /dražba nebo prodej majetku školy/);
  assert.match(prompt, /Trhy jinde než v Kopidlně: jen článek/);
  assert.match(prompt, /dokdy se přihlásit/);
  assert.match(prompt, /rubriky "zahradnicka-skola"/);
  assert.doesNotMatch(prompt, /Základní a mateřské školy/);
  const text = skolaText({ title: "Jarní seminář", text: "Vítání jara", section: "Semináře pro veřejnost", publishedAt: "2026-02-03T08:53:51Z" }, {}, { today: "2026-02-04", source: ZAHRADKA });
  assert.match(text, /Článek z webu zahradnické školy Kopidlno, rubrika Semináře pro veřejnost/);
  // ZŠ zůstává, jak byla.
  assert.match(skolaPrompt(""), /Základní a mateřské školy Kopidlno/);
  assert.match(skolaPrompt(""), /rubriky "skola"/);
});

test("odkaz a popisek fotky jmenují zahradnickou školu, duplicita vede na její stránku", () => {
  assert.match(skolaSource("https://www.zahradnicka-skola-kopidlno.cz/aktuality/a/", ZAHRADKA), />web zahradnické školy Kopidlno</);
  assert.equal(photoCaption("", ZAHRADKA), "Foto: web zahradnické školy Kopidlno");
  assert.match(refLink("zahradka:3"), /href="\/redakce\/zahradka\?zprava=3"/);
});

test("redakce má stránku Zahradnická škola bez pole adres", () => {
  const page = adminSkola(
    { path: "/redakce/zahradka", copy: {} },
    {
      signedIn: true,
      user: { role: "hlavni", name: "Jana", login: "jana" },
      hasApiKey: true,
      schools: { zahradka: { settings: { enabled: true, autoPublish: false, feedUrls: ZAHRADKA.defaultFeeds, freshDays: 14, ownPhotos: false, note: "", status: "" }, items: [] } },
    },
    null,
    { importSettings: true },
    ZAHRADKA,
  );
  assert.match(page, /<h1[^>]*>Zahradnická škola/);
  assert.match(page, /action="\/redakce\/zahradka\/ulozit"/);
  assert.match(page, /action="\/redakce\/zahradka\/zkontrolovat"/);
  assert.match(page, /value="14"/);
  assert.doesNotMatch(page, /name="feedUrls"/);
  assert.match(page, /href="\/redakce\/zahradka"[^>]*aria-current="page"/);
});
