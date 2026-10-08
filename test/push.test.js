import assert from "node:assert/strict";
import test from "node:test";
import { articleMessage, binsMessage, changeMessage, eventMessage, yardMessage } from "../src/push/collect.js";
import { b64url, concat, encryptPayload, fromB64url, vapidAuthorization } from "../src/push/crypto.js";
import { MAX_PER_RUN, messagesFor } from "../src/push/dispatch.js";
import { sendOutcome } from "../src/push/send.js";
import { mapPushSettings, readSubscription } from "../src/push/store.js";
import { pushPage } from "../src/push/page.js";
import { readPrefs, wants } from "../src/push/topics.js";

const enc = new TextEncoder();

async function hmac(key, data) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

// Strana prohlížeče podle RFC 8291: rozšifruje, co poslal Worker.
async function decrypt(body, uaKeys, uaPublic, authSecret) {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const cipher = body.slice(21 + idLength);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaKeys.privateKey, 256));
  const ikm = await hmac(await hmac(authSecret, shared), concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), Uint8Array.of(1)))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  assert.equal(plain.at(-1), 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("šifrování aes128gcm prohlížeč rozšifruje", async () => {
  const uaKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", uaKeys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const text = JSON.stringify({ title: "Zítra je otevřeno: Sběrný dvůr", body: "8:00–12:00" });
  const body = await encryptPayload(enc.encode(text), b64url(uaPublic), b64url(auth));
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(body[20], 65);
  assert.equal(await decrypt(body, uaKeys, uaPublic, auth), text);
});

test("VAPID: podpis ES256 sedí s veřejným klíčem a míří na službu prohlížeče", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const env = { VAPID_PUBLIC_KEY: b64url(raw), VAPID_PRIVATE_KEY: jwk.d };
  const header = await vapidAuthorization(env, "https://fcm.googleapis.com/fcm/send/abc", { now: Date.UTC(2026, 9, 7) });
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, env.VAPID_PUBLIC_KEY);
  const [head, claims, signature] = token.split(".");
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(claims)));
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(payload.exp, Date.UTC(2026, 9, 7) / 1000 + 12 * 3600);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, fromB64url(signature), enc.encode(`${head}.${claims}`));
  assert.ok(ok);
});

test("odběr jen ke známým službám prohlížečů a se správnými klíči", () => {
  const keys = { p256dh: b64url(new Uint8Array(65).fill(4)), auth: b64url(new Uint8Array(16)) };
  assert.ok(readSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }));
  assert.ok(readSubscription({ endpoint: "https://web.push.apple.com/abc", keys }));
  assert.ok(readSubscription({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x", keys }));
  assert.equal(readSubscription({ endpoint: "https://evil.example/fcm.googleapis.com", keys }), null);
  assert.equal(readSubscription({ endpoint: "http://fcm.googleapis.com/x", keys }), null);
  assert.equal(readSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "abc" } }), null);
});

test("nastavení: jen známá témata, prázdný výběr znamená všechno", () => {
  const prefs = readPrefs({ topics: ["dvory", "zpravy", "nesmysl"], pick: { yards: ["2", "x"], rubrics: [], kinds: ["voda", "plyn"] } });
  assert.deepEqual(prefs.topics, ["dvory", "zpravy"]);
  assert.deepEqual(prefs.pick.yards, [2]);
  assert.deepEqual(prefs.pick.kinds, ["voda"]);
  assert.ok(wants(prefs, { topic: "dvory", targets: [2] }));
  assert.ok(!wants(prefs, { topic: "dvory", targets: [3] }));
  assert.ok(wants(prefs, { topic: "zpravy", targets: [7, 1] }));
  assert.ok(!wants(prefs, { topic: "akce", targets: [] }));
});

test("zpráva z podrubriky přijde i tomu, kdo vybral hlavní rubriku", () => {
  const message = articleMessage({ id: 5, slug: "nova-lavka", title: "Nová lávka", excerpt: "Přes potok.", rubric_id: 9, parent_id: 3, image_key: "" });
  assert.deepEqual(message.targets, [9, 3]);
  assert.equal(message.url, "/zpravy/nova-lavka");
  assert.ok(wants(readPrefs({ topics: ["zpravy"], pick: { rubrics: [3] } }), message));
});

test("na jeden prohlížeč nejvýš pár upozornění, zbytek souhrnem", () => {
  const prefs = readPrefs({ topics: ["zpravy"] });
  const list = Array.from({ length: 7 }, (_, i) => ({ key: `zprava-${i}`, topic: "zpravy", targets: [], title: `Zpráva ${i}`, body: "", url: "/", tag: `zprava-${i}` }));
  const out = messagesFor(prefs, list);
  assert.equal(out.length, MAX_PER_RUN);
  assert.equal(out.at(-1).title, "Na drbně je toho víc");
  assert.match(out.at(-1).body, /4 další novinky/);
  assert.equal(messagesFor(prefs, list.slice(0, 2)).length, 2);
});

test("večer: sběrný dvůr otevřený zítra, akce zítra a svoz", () => {
  const week = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, open: day === 4, from: "08:00", to: "12:00" }));
  const yard = { id: 2, name: "Sběrný dvůr Kopidlno", place: "Jičínská", week, closures: [] };
  // 2026-10-08 je čtvrtek.
  const open = yardMessage(yard, "2026-10-08");
  assert.equal(open.title, "Zítra je otevřeno: Sběrný dvůr Kopidlno");
  assert.equal(open.body, "08:00–12:00, Jičínská");
  assert.equal(open.key, "dvur-2-2026-10-08");
  assert.equal(yardMessage(yard, "2026-10-09"), null);
  assert.equal(yardMessage({ ...yard, closures: [{ startsOn: "2026-10-08", endsOn: "2026-10-08" }] }, "2026-10-08"), null);

  const event = { id: 4, title: "Drakiáda", place: "Na Vrších", startsOn: "2026-10-08", startsTime: "14:00", published: true, cancelled: false, articleSlug: "" };
  assert.equal(eventMessage(event, "2026-10-08").body, "14:00, Na Vrších");
  assert.equal(eventMessage({ ...event, cancelled: true }, "2026-10-08"), null);
  assert.equal(eventMessage(event, "2026-10-09"), null);

  assert.equal(binsMessage({ nextDate: "2026-10-08" }, "2026-10-08").topic, "svoz");
  assert.equal(binsMessage({ nextDate: "2026-10-15" }, "2026-10-08"), null);
});

test("změna hodin jde do tématu podle sekce a k vybranému lékaři", () => {
  const change = { section: "lekar", id: 3, ownerId: 8, kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-16", note: "Dovolená", week: [], name: "MUDr. Nová", detail: "Praktická lékařka" };
  const message = changeMessage(change);
  assert.equal(message.topic, "lekari");
  assert.equal(message.key, "zmena-lekar-3");
  assert.match(message.title, /MUDr\. Nová: zavřeno/);
  assert.ok(wants(readPrefs({ topics: ["lekari"], pick: { doctors: [8] } }), message));
  assert.ok(!wants(readPrefs({ topics: ["lekari"], pick: { doctors: [9] } }), message));
});

test("stav ze služby prohlížeče", () => {
  assert.equal(sendOutcome(201), "ok");
  assert.equal(sendOutcome(410), "gone");
  assert.equal(sendOutcome(404), "gone");
  assert.equal(sendOutcome(413), "drop");
  assert.equal(sendOutcome(429), "retry");
  assert.equal(sendOutcome(0), "retry");
});

test("stránka Upozornění: vypnutá témata chybí, bez klíčů nejde zapnout a nepatří do vyhledávačů", () => {
  const ctx = { path: "/upozorneni", origin: "https://drbna.test", mainOrigin: "https://drbna.test", copy: {} };
  const lists = { rubrics: [], places: [{ id: 1, label: "Úřad" }], doctors: [], yards: [] };
  const settings = mapPushSettings({ enabled: 1, topics_off: "svoz" });
  const page = pushPage(ctx, { lists, settings, publicKey: "KEY" });
  assert.doesNotMatch(page, /noindex/);
  assert.match(page, /<meta property="og:image" content="https:\/\/drbna\.test\/og-upozorneni\.webp">/);
  assert.match(page, /<meta property="og:image:width" content="1200">/);
  assert.match(page, /data-key="KEY"/);
  assert.match(page, /value="hodiny"/);
  assert.doesNotMatch(page, /value="svoz"/);
  assert.match(page, /name="places" value="1"/);
  const off = pushPage(ctx, { lists, settings, publicKey: "" });
  assert.doesNotMatch(off, /data-push /);
  assert.match(off, /<meta name="robots" content="noindex">/);
});

test("manifest: Safari dostane standalone kvůli upozorněním na iPhonu, ostatní browser, ať se drbna nenabízí k instalaci", async () => {
  const { manifestFor, manifestResponse } = await import("../src/manifest.js");
  const UA = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1",
    ipadDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
    chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  };
  for (const key of ["iphone", "chromeIos", "ipadDesktop"]) assert.equal(manifestFor(UA[key]).display, "standalone", key);
  for (const key of ["chromeMac", "edge", "android", "firefoxMac"]) assert.equal(manifestFor(UA[key]).display, "browser", key);
  assert.equal(manifestFor("").display, "browser");
  const response = manifestResponse(new Request("https://drbna.test/site.webmanifest", { headers: { "user-agent": UA.android } }));
  assert.equal(response.headers.get("vary"), "User-Agent");
  assert.equal((await response.json()).icons.length, 3);
});

test("zvoneček a nabídka jen se zapnutými upozorněními, v patičce odkaz není", async () => {
  const { layout } = await import("../src/view.js");
  const base = { title: "T", description: "D", path: "/", origin: "https://drbna.test", mainOrigin: "https://drbna.test", body: "", copy: {} };
  const on = layout({ ...base, push: { enabled: true } });
  assert.match(on, /data-push-bell/);
  assert.doesNotMatch(on, /<footer>[\s\S]*upozorneni[\s\S]*<\/footer>/);
  assert.match(on, /<template data-push-offer>/);
  assert.match(on, /push-bell\.js/);
  // Na stránce Upozornění zvoneček ano, nabídka ne.
  const own = layout({ ...base, path: "/upozorneni", push: { enabled: true } });
  assert.match(own, /data-push-bell/);
  assert.doesNotMatch(own, /data-push-offer/);
  for (const push of [null, { enabled: false }]) {
    const page = layout({ ...base, push });
    assert.doesNotMatch(page, /data-push-bell|upozorneni|push-bell/);
  }
});
