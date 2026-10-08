import assert from "node:assert/strict";
import test from "node:test";
import { fetchFacebookPages, pageIdentifier, publicPost } from "../src/facebook/api.js";
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

test("token jde jen v hlavičce a paging.next se neotevře", async () => {
  const calls = [];
  const result = await fetchFacebookPages(["https://www.facebook.com/Mesto"], { env: { FACEBOOK_ACCESS_TOKEN: "secret" }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return json({ id: "12", name: "Město", category: "Government organization" });
    return json({ data: [row, { ...row, id: "12_35", is_published: false }], paging: { cursors: { after: "next-cursor" }, next: "https://evil.example/?access_token=secret" } });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].section, "Město");
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[2].url).searchParams.get("after"), "next-cursor");
  for (const call of calls) {
    assert.equal(new URL(call.url).hostname, "graph.facebook.com");
    assert.equal(call.url.includes("secret"), false);
    assert.equal(call.options.headers.Authorization, "Bearer secret");
    assert.equal(call.options.redirect, "error");
  }
});

test("jedna nefunkční Page ostatní nezastaví a chyba nenese text od Mety", async () => {
  const env = { FACEBOOK_ACCESS_TOKEN: "secret" };
  const fetchImpl = async (url) => {
    if (url.includes("/Zla")) return json({ error: { code: 100, message: "secret details" } }, 400);
    if (url.includes("/posts")) return json({ data: [row] });
    return json({ id: "12", name: "Město", category: "Government organization" });
  };
  const result = await fetchFacebookPages(["https://www.facebook.com/Zla", "https://www.facebook.com/Mesto"], { env, fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.match(result.warning, /nepovolil/);
  assert.equal(result.warning.includes("secret"), false);
  const none = await fetchFacebookPages(["https://www.facebook.com/Zla"], { env, fetchImpl });
  assert.equal(none.ok, false);
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
