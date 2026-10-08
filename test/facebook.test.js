import assert from "node:assert/strict";
import test from "node:test";
import { fetchFacebookPages, pageIdentifier, pageProblem, publicPost } from "../src/facebook/api.js";
import { FACEBOOK_SOURCE } from "../src/facebook/source.js";
import { SCHOOLS } from "../src/skola/sources.js";
import { photoCaption, skolaSource } from "../src/skola/run.js";
import { skolaItemText } from "../src/skola/ai.js";

const page = { id: "12", name: "Kopidlenské listy" };
const row = {
  id: "12_34",
  message: "V sobotu je sousedské setkání.\n\nPřijďte!",
  created_time: "2026-10-08T08:00:00+0000",
  permalink_url: "https://www.facebook.com/12/posts/34",
  is_published: true,
  attachments: {
    data: [{
      media: { image: { src: "https://scontent.fbcdn.net/a.jpg" } },
      subattachments: { data: [{ media: { image: { src: "https://scontent.fbcdn.net/b.jpg" } } }] },
    }],
  },
};
const json = (data, status = 200) => Response.json(data, { status });

test("zdrojem může být jen přímé ID nebo alias Page, ne jiný server či Graph cesta", () => {
  assert.equal(pageIdentifier("https://www.facebook.com/JicinevesCZ/"), "JicinevesCZ");
  assert.equal(pageIdentifier("https://www.facebook.com/profile.php?id=123"), "123");
  assert.equal(pageIdentifier("https://www.facebook.com/people/Obec-Xy/61550000000000/"), "61550000000000");
  assert.equal(pageIdentifier("https://www.facebook.com/p/Obec-Xy-61550000000000/"), "61550000000000");
  assert.equal(pageIdentifier("https://m.facebook.com/Obec-Jicineves-123456789/"), "123456789");
  assert.equal(pageIdentifier("https://www.facebook.com/people/Obec/abc/"), "");
  for (const value of ["me", "..", ".", "123/posts", "https://example.com/page", "https://www.facebook.com/groups/123", "https://name@facebook.com/Page", "http://facebook.com/Page"]) assert.equal(pageIdentifier(value), "");
});

test("příspěvek je položka importu i s fotkami, jménem Page a nadpisem z prvního řádku", () => {
  const item = publicPost(row, page);
  assert.equal(item.guid, "12_34");
  assert.equal(item.title, "V sobotu je sousedské setkání.");
  assert.equal(item.section, "Kopidlenské listy");
  assert.deepEqual(item.images, ["https://scontent.fbcdn.net/a.jpg", "https://scontent.fbcdn.net/b.jpg"]);
  assert.equal(item.publishedAt, "2026-10-08T08:00:00.000Z");
});

test("nepublikované, netextové, cizí a nebezpečné odkazy se neberou", () => {
  for (const change of [{ is_published: false }, { is_published: undefined }, { message: "" }, { id: "99_34" }, { created_time: "bad" }, { permalink_url: "https://example.com/" }, { permalink_url: "https://facebook.com/posts/34?access_token=secret" }]) assert.equal(publicPost({ ...row, ...change }, page), null);
  assert.deepEqual(publicPost({ ...row, attachments: { data: [{ media: { image: { src: "http://x/a.jpg" } } }] } }, page).images, []);
});

const fresh = { ...row, created_time: new Date().toISOString() };
const pageInfo = (posts) => ({ id: "12", name: "Město", category: "Government organization", ...(posts ? { posts } : {}) });

test("token jde jen v hlavičce a paging.next se neotevře", async () => {
  const calls = [];
  const posts = { data: [fresh, { ...fresh, id: "12_35", is_published: false }], paging: { cursors: { after: "next-cursor" }, next: "https://evil.example/?access_token=secret" } };
  const result = await fetchFacebookPages(["https://www.facebook.com/Mesto"], { env: { FACEBOOK_ACCESS_TOKEN: "secret" }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return json(pageInfo(posts));
    return json({ data: [{ ...fresh, id: "12_36" }], paging: { cursors: { after: "dalsi" }, next: "https://graph.facebook.com/x" } });
  } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map((item) => item.guid), ["12_34", "12_36"]);
  assert.equal(result.items[0].section, "Město");
  // Údaje Page a první příspěvky jedním dotazem, pak nejvýš jedna další stránka.
  assert.equal(calls.length, 2);
  assert.match(new URL(calls[0].url).searchParams.get("fields"), /^id,name,category,posts\.limit\(25\)\{id,message/);
  assert.equal(new URL(calls[1].url).searchParams.get("after"), "next-cursor");
  for (const call of calls) {
    assert.equal(new URL(call.url).hostname, "graph.facebook.com");
    assert.equal(call.url.includes("secret"), false);
    assert.equal(call.options.headers.Authorization, "Bearer secret");
    assert.equal(call.options.redirect, "manual");
  }
});

test("jedna nefunkční Page ostatní nezastaví a chyba nenese text od Mety", async () => {
  const env = { FACEBOOK_ACCESS_TOKEN: "secret" };
  const fetchImpl = async (url) => {
    if (url.includes("/Zla")) return json({ error: { code: 100, message: "secret details" } }, 400);
    return json(pageInfo({ data: [row] }));
  };
  const result = await fetchFacebookPages(["https://www.facebook.com/Zla", "https://www.facebook.com/Mesto"], { env, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.match(result.warning, /nepovolil/);
  assert.equal(result.warning.includes("secret"), false);
  const none = await fetchFacebookPages(["https://www.facebook.com/Zla"], { env, fetchImpl });
  assert.equal(none.ok, false);
});

test("další stránka příspěvků se nestahuje, když už jsou staré, a Page bez příspěvků je prázdná", async () => {
  const env = { FACEBOOK_ACCESS_TOKEN: "secret" };
  let calls = 0;
  const old = { data: [{ ...row, created_time: "2020-01-01T00:00:00+0000" }], paging: { cursors: { after: "c" }, next: "https://graph.facebook.com/x" } };
  const result = await fetchFacebookPages(["https://www.facebook.com/Mesto"], { env, fetchImpl: async () => (calls++, json(pageInfo(old))) });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  const empty = await fetchFacebookPages(["https://www.facebook.com/Mesto"], { env, fetchImpl: async () => json(pageInfo()) });
  assert.deepEqual(empty, { ok: true, error: "", warning: "", items: [] });
});

test("spadlý fetch jde do logu bez tokenu, do redakce jen naše hláška", async () => {
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(line);
  try {
    const result = await fetchFacebookPages(["https://www.facebook.com/Mesto"], { env: { FACEBOOK_ACCESS_TOKEN: "secret" }, fetchImpl: async () => { throw new TypeError("Invalid redirect value"); } });
    assert.equal(result.ok, false);
    assert.match(result.error, /nepodařilo načíst/);
  } finally {
    console.error = original;
  }
  assert.match(logged.join("\n"), /TypeError: Invalid redirect value/);
  assert.equal(logged.join("\n").includes("secret"), false);
});

test("adresa, která není Page, se pozná podle zdroje už při uložení", () => {
  assert.equal(FACEBOOK_SOURCE.feedProblem, pageProblem);
  assert.equal(pageProblem("https://www.facebook.com/Mesto"), "");
  assert.match(pageProblem("https://www.facebook.com/groups/123"), /groups\/123 není odkaz na facebookovou stránku/);
});

test("nové položky se zapíšou jednou dávkou a počítají se jen nové čerstvé", async () => {
  const { rememberSkolaItems } = await import("../src/skola/store.js");
  const batches = [];
  const env = { DB: { prepare: () => ({ bind: (...args) => args }), batch: async (list) => (batches.push(list), [{ meta: { changes: 1 } }, { meta: { changes: 0 } }, { meta: { changes: 1 } }]) } };
  const items = ["a", "b", "c"].map((guid) => ({ ...publicPost(row, page), guid }));
  assert.equal(await rememberSkolaItems(env, FACEBOOK_SOURCE, items, { isOld: (item) => item.guid === "c" }), 1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0][2][9], "stare");
  assert.equal(await rememberSkolaItems(env, FACEBOOK_SOURCE, []), 0);
});

test("bez tokenu se na Facebook ani nesahá", async () => {
  let called = false;
  const result = await fetchFacebookPages(["https://www.facebook.com/Mesto"], { fetchImpl: async () => { called = true; } });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("Facebook je zdroj importu: zdroj pod zprávou a u fotky podle Page, Drběna ví, odkud příspěvek je", () => {
  assert.equal(SCHOOLS.facebook, FACEBOOK_SOURCE);
  assert.equal(skolaSource(row.permalink_url, FACEBOOK_SOURCE, "Kopidlenské listy"), "Kopidlenské listy na Facebooku https://www.facebook.com/12/posts/34");
  assert.equal(photoCaption("", FACEBOOK_SOURCE, "Kopidlenské listy"), "Foto: Kopidlenské listy na Facebooku");
  const text = skolaItemText({ ...publicPost(row, page), publishedAt: "2026-10-08T08:00:00.000Z" }, FACEBOOK_SOURCE);
  assert.match(text, /^Příspěvek z facebookové stránky Kopidlenské listy \(zveřejněno 2026-10-08\)/);
});

test("Facebook zatím píše jen návrhy: přepínač Rovnou zveřejňovat chybí a uložené zapnutí neplatí", async () => {
  const { loadSkolaSettings } = await import("../src/skola/store.js");
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ auto_publish: 1, enabled: 1 }) }), first: async () => ({ auto_publish: 1, enabled: 1 }) }) } };
  assert.equal((await loadSkolaSettings(env, FACEBOOK_SOURCE)).autoPublish, false);
  assert.equal(FACEBOOK_SOURCE.draftsOnly, true);
});
