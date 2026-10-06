import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  deviceLabel,
  endOtherSessions,
  ensureLoginTables,
  linkLive,
  listSessions,
  pendingLogin,
  pruneLogin,
  requestCode,
  saveLoginSettings,
  sessionAccount,
  startSession,
  verifyCode,
  verifyLink,
} from "../src/login-db.js";
import { loginPage } from "../src/admin/login.js";

// Malá náhrada D1 nad SQLite v paměti.
function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { results: [], meta: { changes: result.changes ?? 0, last_row_id: Number(result.lastInsertRowid) } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return { prepare: (sql) => statement(sql) };
}

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 4, 12);

async function freshEnv() {
  const env = { DB: d1() };
  const run = (sql) => env.DB.prepare(sql).run();
  await run("create table users (id integer primary key, login text, name text, alias text default '', email text, role text, active integer default 1)");
  await run("insert into users values (1, 'jana', 'Jana', '', 'jana@example.cz', 'hlavni', 1)");
  await run("insert into users values (2, 'petr', 'Petr', '', 'petr@example.cz', 'prispevatel', 0)");
  await ensureLoginTables(env);
  return env;
}

test("kód přihlásí jednou, druhé použití už ne", async () => {
  const env = await freshEnv();
  const sent = await requestCode(env, { email: "jana@example.cz", ip: "1.2.3.4", now: NOW });
  assert.equal(sent.user.id, 1);
  assert.match(sent.code, /^\d{6}$/);
  assert.deepEqual(await pendingLogin(env, sent.challenge, NOW + MIN), { email: "jana@example.cz" });
  const ok = await verifyCode(env, sent.challenge, ` ${sent.code.slice(0, 3)} ${sent.code.slice(3)} `, NOW + MIN);
  assert.equal(ok.ok, true);
  assert.equal(ok.user.id, 1);
  assert.equal((await verifyCode(env, sent.challenge, sent.code, NOW + MIN)).ok, false);
  assert.equal(await pendingLogin(env, sent.challenge, NOW + MIN), null);
});

test("kód platí 10 minut a pět pokusů", async () => {
  const env = await freshEnv();
  const late = await requestCode(env, { email: "jana@example.cz", now: NOW });
  assert.equal((await verifyCode(env, late.challenge, late.code, NOW + 11 * MIN)).done, true);

  const sent = await requestCode(env, { email: "jana@example.cz", now: NOW });
  const wrong = sent.code === "000000" ? "111111" : "000000";
  for (let i = 1; i <= 4; i++) {
    const result = await verifyCode(env, sent.challenge, wrong, NOW);
    assert.equal(result.error, `Kód nesedí. Zbývá pokusů: ${5 - i}.`);
  }
  assert.equal((await verifyCode(env, sent.challenge, wrong, NOW)).done, true);
  assert.equal((await verifyCode(env, sent.challenge, sent.code, NOW)).ok, false, "po pěti chybách neplatí ani správný");
});

test("neznámý i vypnutý účet dostane výzvu, ale žádný kód nesedí", async () => {
  const env = await freshEnv();
  for (const email of ["nikdo@example.cz", "petr@example.cz"]) {
    const sent = await requestCode(env, { email, now: NOW });
    assert.equal(sent.user, null);
    assert.deepEqual(await pendingLogin(env, sent.challenge, NOW), { email });
    const result = await verifyCode(env, sent.challenge, sent.code, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.error, "Kód nesedí. Zbývá pokusů: 4.");
  }
});

test("nový kód zneplatní starý, limity na e-mail a IP za hodinu", async () => {
  const env = await freshEnv();
  const first = await requestCode(env, { email: "jana@example.cz", now: NOW });
  await requestCode(env, { email: "jana@example.cz", now: NOW });
  assert.equal((await verifyCode(env, first.challenge, first.code, NOW)).ok, false);
  for (let i = 0; i < 3; i++) await requestCode(env, { email: "jana@example.cz", now: NOW });
  assert.equal((await requestCode(env, { email: "jana@example.cz", now: NOW })).limited, true);
  assert.equal((await requestCode(env, { email: "jana@example.cz", now: NOW + 61 * MIN })).limited, undefined);

  for (let i = 0; i < 20; i++) await requestCode(env, { email: `x${i}@example.cz`, ip: "9.9.9.9", now: NOW });
  assert.equal((await requestCode(env, { email: "jina@example.cz", ip: "9.9.9.9", now: NOW })).limited, true);
});

test("odkaz z e-mailu přihlásí jednou", async () => {
  const env = await freshEnv();
  const sent = await requestCode(env, { email: "jana@example.cz", now: NOW });
  assert.equal(await linkLive(env, sent.link, NOW), true);
  assert.equal((await verifyLink(env, sent.link, NOW)).user.id, 1);
  assert.equal(await linkLive(env, sent.link, NOW), false);
  assert.equal((await verifyLink(env, sent.link, NOW)).ok, false);
});

test("přihlášení vyprší po nečinnosti a po nejdelší době, aktivita ho prodlužuje", async () => {
  const env = await freshEnv();
  const token = await startSession(env, 1, "Chrome · Windows", NOW);
  assert.equal((await sessionAccount(env, token, NOW + 100 * MIN)).row.id, 1, "do 2 hodin platí");
  assert.equal((await sessionAccount(env, token, NOW + 200 * MIN)).row.id, 1, "aktivita před 100 minutami ho prodloužila");
  assert.equal(await sessionAccount(env, token, NOW + 400 * MIN), null, "po 2 hodinách nečinnosti konec");
  assert.equal(await sessionAccount(env, token, NOW + 401 * MIN), null, "a řádek je smazaný");

  await saveLoginSettings(env, { idleMinutes: "0", maxDays: "1" });
  const day = await startSession(env, 1, "", NOW);
  assert.equal((await sessionAccount(env, day, NOW + 20 * 60 * MIN)).row.id, 1, "bez odhlášení po nečinnosti");
  assert.equal(await sessionAccount(env, day, NOW + 25 * 60 * MIN), null, "nejdelší přihlášení je den");
  assert.equal((await saveLoginSettings(env, { idleMinutes: "7", maxDays: "1" })).ok, false);
});

test("„Neodhlašovat na tomto zařízení“: bez odhlášení po nečinnosti, vydrží rok", async () => {
  const env = await freshEnv();
  const token = await startSession(env, 1, "", NOW, true);
  const later = NOW + 100 * 24 * 60 * MIN;
  assert.equal((await sessionAccount(env, token, later)).row.id, 1, "po 100 dnech nečinnosti platí");
  await pruneLogin(env, NOW + 200 * 24 * 60 * MIN);
  assert.equal((await listSessions(env, 1))[0].remember, true, "cron ho nesmaže");
  assert.equal(await sessionAccount(env, token, NOW + 366 * 24 * 60 * MIN), null, "po roce konec");
});

test("vypnutý účet se nepřihlásí ani starým zařízením, ostatní zařízení jde odhlásit", async () => {
  const env = await freshEnv();
  const petr = await startSession(env, 2, "", NOW);
  assert.equal(await sessionAccount(env, petr, NOW), null);
  const here = await startSession(env, 1, "tady", NOW);
  await startSession(env, 1, "jinde", NOW);
  const mine = await sessionAccount(env, here, NOW);
  await endOtherSessions(env, 1, mine.sessionId);
  assert.deepEqual((await listSessions(env, 1)).map((row) => row.device), ["tady"]);
  await pruneLogin(env, NOW + 3 * 60 * MIN);
  assert.deepEqual(await listSessions(env, 1), []);
});

test("zařízení: krátký popis prohlížeče a systému", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"), "Chrome · Windows");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari · iPhone");
  assert.equal(deviceLabel(""), "Neznámé zařízení");
});

test("přihlašovací stránka: e-mail s Turnstile, potom kód", () => {
  const ctx = { path: "/redakce/zpravy" };
  const flash = { text: "", kind: "" };
  const email = loginPage(ctx, { login: { pending: null, siteKey: "klic", setupNeeded: false } }, flash);
  assert.match(email, /action="\/redakce\/prihlasit"/);
  assert.match(email, /name="next" value="\/redakce\/zpravy"/);
  assert.match(email, /data-sitekey="klic"/);
  assert.match(email, /turnstile\/v0\/api\.js/);
  const code = loginPage(ctx, { login: { pending: { email: "jana@example.cz" }, siteKey: "klic", echo: "123456" } }, flash);
  assert.match(code, /action="\/redakce\/overit"/);
  assert.match(code, /jana@example\.cz/);
  assert.match(code, /data-login-code>123456</);
  assert.doesNotMatch(code, /turnstile/);
});
