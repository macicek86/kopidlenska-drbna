import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { adminSkola } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { skolaPrompt, skolaText } from "../src/skola/ai.js";
import { pastedTitle, readPostDate, savePastedItem } from "../src/skola/paste.js";
import { chosenImage, readSchedule, redoText } from "../src/skola/paste-run.js";
import { pastedDetail } from "../src/admin/paste.js";
import { photoCaption, skolaSource } from "../src/skola/run.js";
import { SCHOOLS } from "../src/skola/sources.js";
import { schoolTables, waitingSkolaItems } from "../src/skola/store.js";

const PASTED = SCHOOLS.vlozene;

function fakeEnv() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  const files = new Map();
  const BUCKET = {
    put: async (key, bytes) => files.set(key, bytes),
    get: async (key) => (files.has(key) ? { httpMetadata: { contentType: "image/jpeg" }, arrayBuffer: async () => files.get(key) } : null),
    delete: async (key) => files.delete(key),
  };
  for (const sql of schoolTables(PASTED)) db.exec(sql);
  return { db, files, env: { DB: { prepare: (sql) => statement(sql) }, BUCKET } };
}

test("nadpis vloženého příspěvku je první řádek, dlouhý se ořízne na slovo", () => {
  assert.equal(pastedTitle("\n  Pouťové odpoledne 🎠 \nV sobotu…"), "Pouťové odpoledne 🎠");
  const long = pastedTitle(`${"slovo ".repeat(30)}konec`);
  assert.ok(long.length <= 91 && long.endsWith("…") && !long.includes("slov…"));
  assert.equal(pastedTitle(""), "Příspěvek s obrázkem");
});

test("den zveřejnění: prázdný je dnešek, budoucí a nesmysl neplatí", () => {
  assert.equal(readPostDate("", "2026-10-07"), "2026-10-07");
  assert.equal(readPostDate("2026-10-01", "2026-10-07"), "2026-10-01");
  assert.equal(readPostDate("2026-10-08", "2026-10-07"), "");
  assert.equal(readPostDate("1. 10.", "2026-10-07"), "");
});

test("vložený příspěvek jde do fronty i s fotkou v R2, odkud je a odkazem", async () => {
  const { env, files } = fakeEnv();
  const photo = new File([new Uint8Array([1, 2, 3])], "plakat.jpg", { type: "image/jpeg" });
  const saved = await savePastedItem(
    env,
    PASTED,
    { postText: "Drakiáda v sobotu 🪁\r\nNa kopci u rozhledny od 14 h.", postLink: "https://www.facebook.com/kopidlenskelisty/posts/1", postFrom: "", postDate: "2026-10-05", images: [photo] },
    { today: "2026-10-07" },
  );
  assert.ok(saved.ok);
  const [item] = await waitingSkolaItems(env, PASTED, 5);
  assert.equal(item.title, "Drakiáda v sobotu 🪁");
  assert.equal(item.text, "Drakiáda v sobotu 🪁\nNa kopci u rozhledny od 14 h.");
  assert.equal(item.section, "Facebook Kopidlenských listů");
  assert.equal(item.publishedAt, "2026-10-05T10:00:00Z");
  assert.equal(item.keptImages.length, 1);
  assert.ok(files.has(item.keptImages[0]));
});

test("vložení bez textu i fotky, se špatným odkazem nebo s budoucím dnem neprojde", async () => {
  const { env } = fakeEnv();
  const today = { today: "2026-10-07" };
  assert.equal((await savePastedItem(env, PASTED, { postText: "  " }, today)).ok, false);
  assert.equal((await savePastedItem(env, PASTED, { postText: "Text", postLink: "facebook.com/x" }, today)).ok, false);
  assert.equal((await savePastedItem(env, PASTED, { postText: "Text", postDate: "2026-10-09" }, today)).ok, false);
  const pdf = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
  assert.equal((await savePastedItem(env, PASTED, { postText: "Text", images: [pdf] }, today)).ok, false);
  assert.deepEqual(await waitingSkolaItems(env, PASTED, 5), []);
});

test("zdroj pod zprávou a popisek fotky jmenují, odkud příspěvek je", () => {
  assert.equal(skolaSource("https://www.facebook.com/x/posts/1", PASTED, "Facebook Kopidlenských listů"), "Facebook Kopidlenských listů https://www.facebook.com/x/posts/1");
  assert.equal(skolaSource("", PASTED, ""), "Facebook Kopidlenských listů");
  assert.equal(photoCaption("Draci nad Kopidlnem", PASTED, "Facebook SDH Kopidlno"), "Draci nad Kopidlnem (foto: Facebook SDH Kopidlno)");
  assert.equal(refLink("vlozene:4"), '<a href="/redakce/vlozene?zprava=4">Vložený příspěvek #4</a>');
});

test("Drběna dostane příspěvek bez nadpisu a pokyn porovnat s Munipolisem a webem města", () => {
  const text = skolaText({ title: "Drakiáda", text: "Drakiáda v sobotu", section: "Facebook Kopidlenských listů", publishedAt: "2026-10-05T10:00:00Z" }, {}, { today: "2026-10-07", source: PASTED });
  assert.match(text, /Příspěvek, který redakce vložila z: Facebook Kopidlenských listů \(zveřejněno 2026-10-05\)/);
  assert.doesNotMatch(text, /Nadpis:/);
  const prompt = skolaPrompt("", { source: PASTED, rubricSlugs: ["zpravy"] });
  assert.match(prompt, /munipolis:… a webmesta:…/);
  assert.match(prompt, /rubric: vyber rubriku ze seznamu/);
  assert.match(prompt, /emoji, hashtagy/);
});

const DRAFT = {
  decision: "vytvorit",
  reason: "Pozvánka na drakiádu.",
  duplicateOf: "",
  article: { title: "Draci nad rozhlednou", excerpt: "V sobotu drakiáda.", body: "<p>Přijďte.</p>", rubric: "komunita", imageTopic: "deti", keywords: "drakiáda" },
  event: { title: "Drakiáda", startsOn: "2026-10-10", startsTime: "14:00", place: "u rozhledny" },
  eventChange: null,
  target: null,
};

function entry(fields) {
  return { id: 7, title: "Drakiáda", text: "Drakiáda v sobotu", section: "Facebook Kopidlenských listů", link: "", status: "nove", reason: "", duplicateOf: "", keptImages: [], attempts: 0, manual: false, draft: null, previousDraft: null, ...fields };
}

test("napsat znovu: Drběna dostane předchozí verzi a poznámku redakce", () => {
  assert.equal(redoText(entry({})), "");
  const text = redoText(entry({ previousDraft: DRAFT, redoNote: "Piš kratší." }));
  assert.match(text, /předchozí verze:\nNadpis: Draci nad rozhlednou/);
  assert.match(text, /Redakce k tomu píše: Piš kratší\./);
  assert.match(redoText(entry({ previousDraft: DRAFT })), /Redakce chce jinou verzi/);
});

test("naplánovat jde jen na den a čas v budoucnu", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  assert.deepEqual(readSchedule({ publishDate: "2026-10-08", publishTime: "7:30" }, now), { day: "2026-10-08", time: "07:30" });
  assert.ok(readSchedule({ publishDate: "2026-10-07", publishTime: "11:00" }, now).error);
  assert.ok(readSchedule({ publishDate: "", publishTime: "11:00" }, now).error);
  assert.ok(readSchedule({ publishDate: "2026-10-08", publishTime: "" }, now).error);
});

test("fotka ke zprávě: vložená s popiskem odkud, cizí klíč neprojde, bez fotky nic", async () => {
  const item = entry({ keptImages: ["clanky/a.webp"], draft: DRAFT });
  assert.deepEqual(await chosenImage({}, PASTED, item, { photoChoice: "vlozena:clanky/a.webp", photoCaption: "Draci" }), {
    key: "clanky/a.webp",
    focus: "",
    caption: "Draci (foto: Facebook Kopidlenských listů)",
  });
  assert.ok((await chosenImage({}, PASTED, item, { photoChoice: "vlozena:clanky/cizi.webp" })).error);
  assert.equal(await chosenImage({}, PASTED, item, { photoChoice: "bez" }), null);
});

test("okno: Drběna píše, hotový koncept se zveřejněním, duplicita s navazující zprávou", () => {
  const data = { rubrics: [{ id: 3, slug: "komunita", name: "Komunita" }], stock: { topics: [] } };
  assert.match(pastedDetail(PASTED, entry({}), data), /Drběna píše/);
  const ready = pastedDetail(PASTED, entry({ status: "napsano", draft: DRAFT, keptImages: ["clanky/a.webp"], previousDraft: { ...DRAFT, article: { ...DRAFT.article, title: "Starší" } } }), data);
  assert.match(ready, /<h3 class="paste-title">Draci nad rozhlednou<\/h3>/);
  assert.match(ready, /Do kalendáře: <b>Drakiáda<\/b>/);
  assert.match(ready, /<option value="3" selected>Komunita<\/option>/);
  assert.match(ready, /value="vlozena:clanky\/a.webp" checked/);
  assert.match(ready, /value="tema"/);
  for (const action of ["zverejnit", "naplanovat", "upravit"]) assert.match(ready, new RegExp(`name="pasteAction" value="${action}"`));
  assert.match(ready, /Předchozí verze: Starší/);
  assert.match(ready, /action="\/redakce\/vlozene\/zahodit"/);
  const double = pastedDetail(PASTED, entry({ status: "duplicita", duplicateOf: "zprava:12", reason: "Už je." }), data);
  assert.match(double, /value="navazat"/);
  assert.match(double, /value="nova"/);
  assert.doesNotMatch(double, /value="zverejnit"/);
});

test("redakce má stránku Vložené příspěvky s oknem na vložení místo kontroly webu", () => {
  const html = adminSkola({}, { signedIn: true, user: { role: "chief" }, hasApiKey: true, schools: { vlozene: { settings: { autoPublish: false, ownPhotos: false }, items: [] } } }, "", { paste: true }, PASTED);
  assert.match(html, /<dialog[^>]*id="vlozit"[^>]*data-autoopen/);
  assert.match(html, /action="\/redakce\/vlozene\/vlozit" enctype="multipart\/form-data"/);
  assert.match(html, /name="postFrom"[^>]*value="Facebook Kopidlenských listů"/);
  assert.doesNotMatch(html, /Zkontrolovat teď/);
  assert.doesNotMatch(html, /name="enabled"/);
  assert.match(html, /name="showPhotos" value="1">/);
  assert.doesNotMatch(html, /data-open="nastaveni"/);
});
