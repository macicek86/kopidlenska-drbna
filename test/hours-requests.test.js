import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureLoginTables, sha256 } from "../src/login-db.js";
import { blankWeek } from "../src/doctors.js";
import { ensurePlaceTables, PLACE_ACTIONS, removePlaceChange, savePlaceChange } from "../src/places-db.js";
import { removeClosure, saveClosure, YARD_ACTIONS } from "../src/yards-db.js";
import { approveRequest, ensureRequestTables, hoursMode, loadRequests, rejectRequest, withdrawRequest } from "../src/hours-requests-db.js";
import { adminPlaces } from "../src/admin/index.js";
import { ensureNotifyTables } from "../src/notify.js";
import { ensureLinkTables } from "../src/hours-links-db.js";

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

const TOKENS = { chief: "token-hlavni-0000000000", jana: "token-jana-00000000000", petr: "token-petr-00000000000" };

function as(who) {
  return new Request("http://drbna.test/", { headers: { cookie: `drbna_editor=${TOKENS[who]}` } });
}

// Přihlášené zařízení s pevným tokenem z testu.
async function signIn(env, userId, token) {
  await env.DB.prepare("insert into sessions (user_id, token_hash, created_at, last_seen) values (?, ?, ?, ?)")
    .bind(userId, await sha256(token), Date.now(), Date.now())
    .run();
}

async function freshEnv() {
  const env = { DB: d1() };
  const run = (sql, ...values) => env.DB.prepare(sql).bind(...values).run();
  await run(`create table users (id integer primary key, login text, name text, alias text default '', email text default '',
    role text, active integer default 1)`);
  await run("create table user_permissions (user_id integer, code text)");
  await run("create table yards (id integer primary key, name text, place text, accepts text, hours text, sort_order integer default 0, published integer default 1)");
  await run("create table yard_closures (id integer primary key autoincrement, yard_id integer, starts_on text, ends_on text, reason text, hours text, created_by integer)");
  await ensurePlaceTables(env);
  await ensureRequestTables(env);
  await ensureLinkTables(env);
  await ensureLoginTables(env);
  await run("insert into users (id, login, name, role) values (1, 'hlavni', 'Hlavní', 'hlavni')");
  await signIn(env, 1, TOKENS.chief);
  await run("insert into users (id, login, name, role) values (2, 'jana', 'Jana', 'prispevatel')");
  await signIn(env, 2, TOKENS.jana);
  await run("insert into users (id, login, name, role) values (3, 'petr', 'Petr', 'prispevatel')");
  await signIn(env, 3, TOKENS.petr);
  await run("insert into user_permissions values (2, 'oteviraci_doba_navrh'), (2, 'sberny_dvur_navrh'), (3, 'oteviraci_doba'), (3, 'oteviraci_doba_navrh')");
  await run("insert into yards (id, name, place, accepts, hours) values (1, 'Dvůr', 'Kopidlno', 'všechno', '[]')");
  return env;
}

const change = { placeId: 1, kind: "docasna", startsOn: "2026-10-20", endsOn: "", changeNote: "dovolená", doctorWeek: blankWeek() };

test("plné oprávnění má přednost před návrhem, hlavní redaktor smí vždy", () => {
  assert.equal(hoursMode({ role: "hlavni", permissions: [] }, "lekari"), "direct");
  assert.equal(hoursMode({ role: "prispevatel", permissions: ["doktori_navrh"] }, "lekari"), "request");
  assert.equal(hoursMode({ role: "prispevatel", permissions: ["doktori", "doktori_navrh"] }, "lekari"), "direct");
  assert.equal(hoursMode({ role: "prispevatel", permissions: ["doktori_navrh"] }, "dvory"), null);
});

test("návrh změny čeká, schválení ji zapíše i s úpravou a autorem zůstane žadatel", async () => {
  const env = await freshEnv();
  const sent = await savePlaceChange(env, as("jana"), change);
  assert.equal(sent.requested, true);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);

  const pending = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"];
  assert.equal(pending.length, 1);
  assert.equal(pending[0].author, "Jana");
  assert.equal(pending[0].value.note, "dovolená");

  // Žadatel schválit nesmí.
  assert.equal((await approveRequest(env, as("jana"), { section: "oteviraci-doba", actions: PLACE_ACTIONS, id: pending[0].id, input: change })).ok, false);
  const done = await approveRequest(env, as("chief"), { section: "oteviraci-doba", actions: PLACE_ACTIONS, id: pending[0].id, input: { ...change, changeNote: "dovolená do pátku" } });
  assert.equal(done.ok, true);
  const row = await env.DB.prepare("select note, created_by from place_changes").first();
  assert.deepEqual({ ...row }, { note: "dovolená do pátku", created_by: 2 });
  assert.equal((await env.DB.prepare("select count(*) as n from hours_requests").first()).n, 0);
});

test("s plným oprávněním se změna zapíše rovnou", async () => {
  const env = await freshEnv();
  const saved = await savePlaceChange(env, as("petr"), change);
  assert.equal(saved.ok, true);
  assert.equal(saved.requested, undefined);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);
});

test("zrušení jde taky přes schválení, zamítnutí vidí žadatel a může ho smazat", async () => {
  const env = await freshEnv();
  await savePlaceChange(env, as("petr"), change);
  const id = (await env.DB.prepare("select id from place_changes").first()).id;
  assert.equal((await removePlaceChange(env, as("jana"), id)).requested, true);
  const [request] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"];
  assert.equal(request.action, "zrusit");

  assert.equal((await rejectRequest(env, as("chief"), { section: "oteviraci-doba", id: request.id, reply: "Ještě platí." })).ok, true);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);
  const mine = (await loadRequests(env, { id: 2, role: "prispevatel", permissions: ["oteviraci_doba_navrh"] }))["oteviraci-doba"];
  assert.deepEqual([mine[0].status, mine[0].reply], ["rejected", "Ještě platí."]);
  assert.deepEqual((await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"], []);

  await withdrawRequest(env, as("petr"), { section: "oteviraci-doba", id: request.id });
  assert.equal((await env.DB.prepare("select count(*) as n from hours_requests").first()).n, 1, "cizí návrh nesmaže");
  await withdrawRequest(env, as("jana"), { section: "oteviraci-doba", id: request.id });
  assert.equal((await env.DB.prepare("select count(*) as n from hours_requests").first()).n, 0);
});

test("uzavření dvora: návrh, schválení zrušení bez formuláře", async () => {
  const env = await freshEnv();
  const input = { yardId: 1, startsOn: "2026-10-20", endsOn: "", reason: "inventura" };
  assert.equal((await saveClosure(env, as("jana"), input)).requested, true);
  assert.equal((await saveClosure(env, as("petr"), input)).ok, false, "bez oprávnění na dvory nic");
  const [request] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] })).dvory;
  assert.equal((await approveRequest(env, as("chief"), { section: "dvory", actions: YARD_ACTIONS, id: request.id, input })).ok, true);
  const closure = await env.DB.prepare("select id, created_by from yard_closures").first();
  assert.equal(closure.created_by, 2);

  await removeClosure(env, as("jana"), closure.id);
  const [cancel] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] })).dvory;
  assert.equal((await approveRequest(env, as("chief"), { section: "dvory", actions: YARD_ACTIONS, id: cancel.id, input: {} })).ok, true);
  assert.equal(await env.DB.prepare("select id from yard_closures").first(), null);
});

test("o návrhu změny přijde hlavnímu redaktorovi e-mail, o zápisu rovnou ne", async () => {
  const env = await freshEnv();
  await ensureNotifyTables(env);
  const sent = [];
  env.EMAIL = { send: async (mail) => sent.push(mail) };
  await env.DB.prepare("update users set email = 'hlavni@example.cz' where id = 1").run();
  await saveClosure(env, as("jana"), { yardId: 1, startsOn: "2026-10-20", endsOn: "", reason: "inventura" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "hlavni@example.cz");
  assert.equal(sent[0].subject, "Ke schválení: Sběrné dvory, Dvůr");
  assert.match(sent[0].text, /Od: Jana\n.*\nKde: Dvůr\nCo: mimořádné uzavření/s);
  assert.match(sent[0].text, /https:\/\/www\.kopidlenskadrbna\.org\/redakce\/dvory\?zadost=1/);
  await savePlaceChange(env, as("petr"), change);
  assert.equal(sent.length, 1);
});

test("redakce: žadatel posílá ke schválení, hlavní redaktor má okno s předvyplněným návrhem", () => {
  const place = { id: 1, name: "Knihovna", label: "", place: "", phone: "", week: blankWeek(), sortOrder: 0, published: true, changes: [] };
  const request = { id: 7, section: "oteviraci-doba", action: "zmena", targetId: 1, status: "pending", reply: "", author: "Jana", createdBy: 2,
    value: { kind: "docasna", startsOn: "2026-10-20", endsOn: "2026-10-22", note: "dovolená", week: blankWeek() } };
  const ctx = { url: "http://drbna.test/redakce/oteviraci-doba", copy: {} };
  const jana = { signedIn: true, user: { id: 2, name: "Jana", role: "prispevatel", permissions: ["oteviraci_doba_navrh"] }, places: [place], hoursRequests: { "oteviraci-doba": [request] } };
  const asking = adminPlaces(ctx, jana, null, { changeId: 1 });
  assert.match(asking, /Poslat ke schválení/);
  assert.match(asking, /Moje návrhy/);
  assert.match(asking, /Stáhnout/);

  const chief = { ...jana, user: { id: 1, name: "Hlavní", role: "hlavni", permissions: [] } };
  const review = adminPlaces(ctx, chief, null, { requestId: 7 });
  assert.match(review, /action="\/redakce\/oteviraci-doba\/zadost\/schvalit"/);
  assert.match(review, /name="zadost" value="7"/);
  assert.match(review, /value="2026-10-22"/);
  assert.match(review, />dovolená<\/textarea>/);
  assert.match(review, /Zamítnout/);
  assert.match(review, /Návrh čeká/);
});
