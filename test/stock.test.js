import assert from "node:assert/strict";
import test from "node:test";
import { outputSchema, readDecision, userText } from "../src/munipolis/ai.js";
import { STOCK_SEEDS, stockCaption, topicsText } from "../src/stock.js";

const SLUGS = ["zpravy", "kultura"];
const TOPICS = [
  { slug: "obecne", name: "Kopidlno obecně", hint: "Náměstí, zámek." },
  { slug: "kultura", name: "Kultura a akce", hint: "" },
];

function answer(article) {
  return {
    decision: "vytvorit",
    reason: "Novinka.",
    duplicate_of: "",
    article: { include: true, title: "Pouť", excerpt: "V sobotu je pouť.", body_html: "<p>Pouť.</p>", rubric: "kultura", image_caption: "", image_topic: "", ...article },
    event: { include: false },
    notice: { include: false },
  };
}

test("fotka z knihovny má popisek Ilustrační foto", () => {
  assert.equal(stockCaption(""), "Ilustrační foto");
  assert.equal(stockCaption("  Foto: Jana  Nováková "), "Ilustrační foto · Foto: Jana Nováková");
});

test("výchozí témata mají jedinečné značky a obecné téma", () => {
  const slugs = STOCK_SEEDS.map((seed) => seed.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.includes("obecne"));
});

test("Claude dostane témata knihovny a smí vybrat jen z nich", () => {
  assert.match(topicsText(TOPICS), /- obecne: Kopidlno obecně \(Náměstí, zámek\.\)\n- kultura: Kultura a akce\nTéma vyber podle toho, čeho se článek týká/);
  assert.match(topicsText([]), /žádná/);
  const text = userText({ title: "Pouť", text: "Text" }, {}, { today: "2026-10-02", topics: TOPICS, images: 1 });
  assert.match(text, /kultura: Kultura a akce/);
  assert.match(text, /Přiložené obrázky: 1/);
  const schema = outputSchema(SLUGS, { topics: ["obecne", "kultura"] }).properties.article;
  assert.deepEqual(schema.properties.image_topic.enum, ["obecne", "kultura", ""]);
  assert.deepEqual(schema.properties.image_use.enum, ["vlastni", "plakat", "knihovna"]);
  assert.ok(schema.required.includes("image_use") && schema.required.includes("image_topic"));
});

test("Deník vlastní fotku vybrat nemůže", () => {
  const schema = outputSchema(SLUGS, { topics: ["obecne"], ownImage: false }).properties.article;
  assert.equal(schema.properties.image_use, undefined);
  assert.ok(!schema.required.includes("image_use"));
});

test("textový plakát jde do knihovny a jeho popisek se zahodí, pěkný zůstane", () => {
  const poster = readDecision(answer({ image_use: "knihovna", image_topic: "kultura", image_caption: "Plakát na pouť" }), { rubricSlugs: SLUGS });
  assert.equal(poster.article.imageUse, "knihovna");
  assert.equal(poster.article.imageTopic, "kultura");
  assert.equal(poster.article.imageCaption, "");
  const photo = readDecision(answer({ image_use: "vlastni", image_caption: "Kolotoče" }), { rubricSlugs: SLUGS });
  assert.equal(photo.article.imageUse, "vlastni");
  assert.equal(photo.article.imageCaption, "Kolotoče");
  const nice = readDecision(answer({ image_use: "plakat", image_caption: "Plakát bazárku" }), { rubricSlugs: SLUGS });
  assert.equal(nice.article.imageUse, "plakat");
  assert.equal(nice.article.imageCaption, "Plakát bazárku");
  // Bez image_use (Deník) je obrázek vždy z knihovny.
  assert.equal(readDecision(answer({}), { rubricSlugs: SLUGS }).article.imageUse, "knihovna");
});
