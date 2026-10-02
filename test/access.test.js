import assert from "node:assert/strict";
import test from "node:test";
import { accessConfig, accessEmail, verifyAccessToken } from "../src/access.js";
import { loginBase, readEmail } from "../src/users-db.js";
import { adminPeople, adminPassword } from "../src/admin/index.js";

const config = { issuer: "https://drbna.cloudflareaccess.com", aud: "aud-123" };
const now = Date.UTC(2026, 9, 2, 12, 0, 0);
const seconds = Math.floor(now / 1000);

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
const other = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);

function b64(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

async function sign(claims, { key = pair.privateKey, kid = "k1" } = {}) {
  const head = b64(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(signature)}`;
}

const good = { aud: ["aud-123"], iss: config.issuer, exp: seconds + 600, iat: seconds, email: "Jana@Example.cz" };
const load = async () => [publicJwk];

test("Access se zapne jen s týmem i AUD a tým může být zkratka i celá adresa", () => {
  assert.equal(accessConfig({}), null);
  assert.equal(accessConfig({ ACCESS_TEAM: "drbna" }), null);
  assert.deepEqual(accessConfig({ ACCESS_TEAM: "drbna", ACCESS_AUD: " aud-123 " }), config);
  assert.deepEqual(accessConfig({ ACCESS_TEAM: "https://drbna.cloudflareaccess.com/", ACCESS_AUD: "aud-123" }), config);
});

test("platný token od Access vrátí e-mail malými písmeny", async () => {
  assert.equal(await verifyAccessToken(await sign(good), config, { load, now }), "jana@example.cz");
});

test("token s cizím podpisem, adresátem, vydavatelem nebo prošlý neprojde", async () => {
  const cases = [
    await sign(good, { key: other.privateKey }),
    await sign({ ...good, aud: ["jina-aplikace"] }),
    await sign({ ...good, iss: "https://cizi.cloudflareaccess.com" }),
    await sign({ ...good, exp: seconds - 1 }),
    await sign({ ...good, email: "" }),
    await sign(good, { kid: "neznamy" }),
    "nesmysl",
    "",
  ];
  for (const token of cases) assert.equal(await verifyAccessToken(token, config, { load, now: now + 120_000 }), null);
  const none = `${b64(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64(JSON.stringify(good))}.`;
  assert.equal(await verifyAccessToken(none, config, { load, now }), null);
});

test("token se čte z hlavičky i z cookie CF_Authorization", async () => {
  const token = await sign(good);
  const header = new Request("https://kopidlenskadrbna.org/redakce", { headers: { "cf-access-jwt-assertion": token } });
  const cookie = new Request("https://kopidlenskadrbna.org/redakce", { headers: { cookie: `a=b; CF_Authorization=${token}` } });
  assert.equal(await accessEmail(header, config, { load, now }), "jana@example.cz");
  assert.equal(await accessEmail(cookie, config, { load, now }), "jana@example.cz");
  assert.equal(await accessEmail(new Request("https://kopidlenskadrbna.org/redakce"), config, { load, now }), null);
});

test("e-mail přispěvatele: s Accessem povinný, přihlašovací jméno se z něj odvodí", () => {
  assert.deepEqual(readEmail(" Jana@Example.CZ ", true), { email: "jana@example.cz" });
  assert.deepEqual(readEmail("", false), { email: null });
  assert.ok(readEmail("", true).error);
  assert.ok(readEmail("jana", false).error);
  assert.equal(loginBase("jana.novakova@example.cz"), "jananovakova");
  assert.equal(loginBase("jo@example.cz"), "clenjo");
});

test("s Accessem redakce nechce hesla a u lidí ukáže e-mail", () => {
  const chief = { id: 1, role: "hlavni", name: "Redakce", login: "redakce", email: "sef@example.cz", alias: "", permissions: [] };
  const jana = { id: 2, role: "prispevovatel", name: "Jana", login: "jana", email: "jana@example.cz", alias: "", active: true, permissions: [] };
  const data = { signedIn: true, access: true, user: chief, users: [chief, jana], showDefaultPassword: false };
  const people = adminPeople({}, data, { text: "", kind: "ok" }, { fresh: true });
  assert.match(people, /jana@example\.cz/);
  assert.match(people, /type="email" name="email"[^>]* required/);
  assert.doesNotMatch(people, /name="password"/);
  assert.doesNotMatch(people, /\?heslo=2/);
  const account = adminPassword({}, data, { text: "", kind: "ok" });
  assert.match(account, /sef@example\.cz/);
  assert.doesNotMatch(account, /\/redakce\/heslo\/ulozit/);
  const off = adminPassword({}, { ...data, access: false }, { text: "", kind: "ok" });
  assert.match(off, /\/redakce\/heslo\/ulozit/);
});
