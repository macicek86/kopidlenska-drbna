import assert from "node:assert/strict";
import test from "node:test";
import { attachmentKeys, attachmentsJson, attachmentsSection, formAttachments, readAttachments } from "../src/attachments.js";
import { outputSchema, readDecision, systemPrompt, visibleImages } from "../src/munipolis/ai.js";
import { mergeImageUrls, pageImages } from "../src/munipolis/page.js";
import { articleAttachments } from "../src/munipolis/run.js";

const STORE = "https://timeline-storage.munipolis.com/images/timeline/6104/15";

// Výřez stránky zprávy z Munipolisu (uzavírka II/280): JSON v atributu, entity a lomítka jako na webu.
function page(images) {
  const data = Object.fromEntries(images.map((path, index) => [String(index), { id: index + 1, path, pathThumbnail: "https://x.cloudfront.net/abc", type: "image" }]));
  const json = JSON.stringify({ id: 3969023, title: "UZAVÍRKA", images: { data }, files: { data: [] } })
    .replace(/\//g, "\\/")
    .replace(/"/g, "&quot;");
  return `<div id="app"><feed-item-detail
                            :item="${json}"
                            :user="null"></feed-item-detail></div>`;
}

test("ze stránky zprávy Munipolisu se vezmou všechny obrázky galerie", () => {
  const html = page([`${STORE}/3969023_6aace5723be37.png`, `${STORE}/3969023_6aace5727a52c.jpg`, `${STORE}/3969023_6aace572ac2bb.jpg`]);
  assert.deepEqual(pageImages(html), [
    `${STORE}/3969023_6aace5723be37.png`,
    `${STORE}/3969023_6aace5727a52c.jpg`,
    `${STORE}/3969023_6aace572ac2bb.jpg`,
  ]);
  assert.deepEqual(pageImages("<html>403 Forbidden</html>"), []);
  assert.deepEqual(pageImages('<feed-item-detail :item="{nejde"></feed-item-detail>'), []);
  // Obrázek z RSS je první a podruhé se nepřidá.
  assert.deepEqual(mergeImageUrls([`${STORE}/a.png`], [`${STORE}/a.png`, `${STORE}/b.jpg`]), [`${STORE}/a.png`, `${STORE}/b.jpg`]);
});

const SLUGS = ["prakticke", "kultura"];

function answer(article) {
  return {
    decision: "vytvorit",
    reason: "Uzavírka.",
    duplicate_of: "",
    article: {
      include: true,
      title: "Uzavírka u náměstí",
      excerpt: "Kus silnice je zavřený.",
      body_html: '<p>Mapa: <a href="https://mapy.com/s/gatejuvaro">objízdná trasa</a>.</p>',
      rubric: "prakticke",
      image_caption: "",
      image_use: "knihovna",
      image_topic: "",
      keywords: [],
      ...article,
    },
    event: { include: false },
    notice: { include: false },
  };
}

test("Drběna vybere přílohy pod článek: čísla obrázků, každé jednou, bez fotky článku", () => {
  const result = readDecision(
    answer({
      attachments: [
        { image: 2, caption: "Výlukový jízdní řád linky 723" },
        { image: 2, caption: "Znovu" },
        { image: 0, caption: "Nula" },
        { image: 3, caption: "  Linka   631585 " },
        { image: 1, caption: "Plakát s mapou" },
      ],
    }),
    { rubricSlugs: SLUGS },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.article.attachments, [
    { index: 2, caption: "Výlukový jízdní řád linky 723" },
    { index: 3, caption: "Linka 631585" },
    { index: 1, caption: "Plakát s mapou" },
  ]);
  assert.match(result.article.body, /<a href="https:\/\/mapy.com\/s\/gatejuvaro"/);
  // Obrázek 1 jako vlastní fotka mezi přílohy nepatří.
  const own = readDecision(answer({ image_use: "vlastni", attachments: [{ image: 1, caption: "Fotka" }] }), { rubricSlugs: SLUGS });
  assert.deepEqual(own.article.attachments, []);
  // Deník a jiné bez příloh.
  const none = readDecision(answer({}), { rubricSlugs: SLUGS });
  assert.deepEqual(none.article.attachments, []);
});

test("schéma Munipolisu chce přílohy, ostatní importy ne; pokyny o uzavírce a městě", () => {
  const schema = outputSchema(SLUGS, { attachments: true });
  assert.ok(schema.properties.article.required.includes("attachments"));
  assert.equal(schema.properties.article.properties.attachments.items.additionalProperties, false);
  assert.equal(outputSchema(SLUGS).properties.article.properties.attachments, undefined);
  const system = systemPrompt("");
  assert.match(system, /attachments:/);
  assert.match(system, /Nevysvětluj, co zavřené není/);
  assert.match(system, /Nepiš, že město nebo radnice něco oznámila/);
});

test("Claude uvidí nejvýš 8 obrázků a dohromady rozumně velkých", () => {
  const small = (size) => ({ bytes: new ArrayBuffer(size), type: "image/jpeg" });
  assert.equal(visibleImages(Array.from({ length: 12 }, () => small(1000))).length, 8);
  const big = [small(3_000_000), small(3_000_000), small(3_000_000), small(3_000_000), small(3_000_000), small(3_000_000), small(3_000_000)];
  assert.equal(visibleImages(big).length, 6);
  assert.equal(visibleImages([small(5_000_000), small(10)]).length, 1);
});

test("vybrané přílohy se uloží do R2 a čísla sedí na obrázky, které Claude viděl", async () => {
  const put = [];
  const env = { BUCKET: { put: async (key, bytes) => put.push([key, bytes.byteLength]) } };
  const images = [
    { bytes: new ArrayBuffer(10), type: "image/png" },
    { bytes: new ArrayBuffer(5_000_000), type: "image/jpeg" },
    { bytes: new ArrayBuffer(20), type: "image/jpeg" },
  ];
  const list = await articleAttachments(env, { attachments: [{ index: 2, caption: "Řád" }, { index: 3, caption: "Nic" }] }, images);
  assert.equal(list.length, 1);
  assert.match(list[0].key, /^prilohy\/[0-9a-f-]+\.jpg$/);
  assert.equal(list[0].caption, "Řád");
  assert.deepEqual(put.map(([, size]) => size), [20]);
});

test("přílohy ve zprávě: čtení, odškrtnutí v redakci a výpis pod článkem", async () => {
  const json = attachmentsJson([
    { key: "prilohy/0a1b-2c.jpg", caption: "Jízdní řád <723>" },
    { key: "prilohy/ffff.png", caption: "" },
  ]);
  const list = readAttachments(`${json.slice(0, -1)},{"key":"../tajne.jpg"}]`);
  assert.deepEqual(list.map((item) => item.key), ["prilohy/0a1b-2c.jpg", "prilohy/ffff.png"]);
  assert.deepEqual(readAttachments("nejde"), []);
  assert.equal(attachmentsJson([]), "");
  assert.deepEqual(attachmentKeys(json), ["prilohy/0a1b-2c.jpg", "prilohy/ffff.png"]);

  // Formulář bez příloh nic nemění, s nimi zůstane jen zaškrtnuté a popisek jde přepsat.
  assert.deepEqual(await formAttachments({}, json, {}), { json, added: [], removed: [] });
  const kept = await formAttachments({}, json, {
    attachmentsShown: true,
    keepAttachments: ["prilohy/ffff.png"],
    attachmentKeys: ["prilohy/0a1b-2c.jpg", "prilohy/ffff.png"],
    attachmentCaptions: ["Jízdní řád", "  Mapa   objížďky "],
  });
  assert.deepEqual(readAttachments(kept.json), [{ key: "prilohy/ffff.png", caption: "Mapa objížďky" }]);
  assert.deepEqual(kept.removed, ["prilohy/0a1b-2c.jpg"]);

  const html = attachmentsSection({ attachments: list });
  assert.match(html, /<h2>Přílohy<\/h2>/);
  assert.match(html, /href="\/media\/prilohy\/0a1b-2c.jpg" target="_blank"/);
  assert.match(html, /Jízdní řád &lt;723&gt;/);
  assert.equal(attachmentsSection({ attachments: [] }), "");
});

test("odkazy ze zdroje zůstanou v textu pro Drběnu jako „popis (adresa)“", async () => {
  const { htmlToText } = await import("../src/munipolis/feed.js");
  const html = `<p>Trasa: <a href="https://mapy.com/s/x">https://mapy.com/s/x</a>, <a href="/prihlaska.pdf">přihláška</a>,
    <a href="mailto:skola@kopidlno.cz">napište</a>, <a href="javascript:alert(1)">zlé</a>, <a href="/foto.jpg"><img src="/foto.jpg"></a></p>`;
  assert.equal(
    htmlToText(html, { links: "https://skola.cz/clanek/5" }),
    "Trasa: https://mapy.com/s/x, přihláška (https://skola.cz/prihlaska.pdf),\nnapište (mailto:skola@kopidlno.cz), zlé,",
  );
  assert.equal(htmlToText(html).includes("prihlaska"), false);
});

test("přílohy nahrané v redakci: uloží se do prilohy/ s popiskem, nad limit a špatný soubor neprojdou", async () => {
  const put = [];
  const env = { BUCKET: { put: async (key) => put.push(key), delete: async () => {} }, DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const file = (name, type = "image/webp") => new File([new Uint8Array(10)], name, { type });
  const json = attachmentsJson([{ key: "prilohy/aaaa.jpg", caption: "Stará" }]);
  const result = await formAttachments(env, json, {
    attachmentsShown: true,
    keepAttachments: ["prilohy/aaaa.jpg"],
    attachmentFiles: [file("rad.webp"), new File([], "prazdny.png")],
    newAttachmentCaptions: ["Jízdní řád 723"],
  });
  assert.equal(put.length, 1);
  assert.match(put[0], /^prilohy\/[0-9a-f-]+\.webp$/);
  assert.deepEqual(readAttachments(result.json), [
    { key: "prilohy/aaaa.jpg", caption: "Stará" },
    { key: put[0], caption: "Jízdní řád 723" },
  ]);
  assert.deepEqual(result.added, [put[0]]);

  const many = Array.from({ length: 8 }, (_, index) => file(`${index}.webp`));
  assert.match((await formAttachments(env, json, { attachmentFiles: many })).error, /nejvýš 8/);
  assert.match((await formAttachments(env, "", { attachmentFiles: [file("x.pdf", "application/pdf")] })).error, /x\.pdf: Fotka musí být/);
});
