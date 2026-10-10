import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureLoginTables, sha256 } from "../src/login-db.js";
import { ensurePlaceTables, PLACE_ACTIONS } from "../src/places-db.js";
import { approveRequest, ensureRequestTables, loadRequests } from "../src/hours-requests-db.js";
import { createMailLink, ensureLinkTables, linkByToken } from "../src/hours-links-db.js";
import { ensureAuditTables } from "../src/audit-db.js";
import { formFields } from "../src/forms.js";
import { manageGet, managePost } from "../src/manage/routes.js";

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

const CHIEF = "token-hlavni-0000000000";
const chief = () => new Request("http://drbna.test/", { headers: { cookie: `drbna_editor=${CHIEF}` } });

async function freshEnv() {
  const env = { DB: d1() };
  const run = (sql, ...values) => env.DB.prepare(sql).bind(...values).run();
  await run("create table users (id integer primary key, login text, name text, alias text default '', email text default '', role text, active integer default 1)");
  await run("create table user_permissions (user_id integer, code text)");
  await ensurePlaceTables(env);
  await ensureRequestTables(env);
  await ensureLinkTables(env);
  await ensureLoginTables(env);
  await ensureAuditTables(env);
  await run("insert into users (id, login, name, role) values (1, 'hlavni', 'Hlavní', 'hlavni')");
  await run("insert into sessions (user_id, token_hash, created_at, last_seen) values (?, ?, ?, ?)", 1, await sha256(CHIEF), Date.now(), Date.now());
  return env;
}

// Odkaz vzniká jen z e-mailu (tlačítko Upravit čas na webu): jednorázový, na jedno místo.
async function linkFor(env, { direct = false } = {}) {
  const place = await env.DB.prepare("select id, name from places order by id limit 1").first();
  const token = await createMailLink(env, { section: "oteviraci-doba", targetId: place.id, label: "recepce", direct });
  return { link: { token }, place };
}

async function post(env, path, fields) {
  const request = new Request(`http://drbna.test${path}`, { method: "POST", body: new URLSearchParams(fields) });
  return managePost(path, request, env, await formFields(request.clone()));
}

const closed = { kind: "docasna", startsOn: "2026-10-20", endsOn: "", changeNote: "inventura", author: "Jana Nová" };

test("změna z odkazu čeká na schválení pod jménem žadatele, odkaz po uložení zanikne a schválení změnu zapíše", async () => {
  const env = await freshEnv();
  const { link, place } = await linkFor(env);
  const page = await manageGet(`/sprava/${link.token}`, new Request("http://drbna.test/"), env, new URL(`http://drbna.test/sprava/${link.token}`));
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(place.name));

  const response = await post(env, `/sprava/${link.token}/zmena`, closed);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Změnu jsme přijali/);
  assert.match(response.headers.get("set-cookie"), /drbna_sprava=Jana%20Nov%C3%A1/);
  assert.equal(await linkByToken(env, link.token), null);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);

  const [request] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"];
  assert.equal(request.author, "Jana Nová (odkaz: recepce)");
  assert.equal((await approveRequest(env, chief(), { section: "oteviraci-doba", actions: PLACE_ACTIONS, id: request.id, input: { ...closed, placeId: place.id } })).ok, true);
  const row = await env.DB.prepare("select note, created_by from place_changes").first();
  assert.deepEqual({ ...row }, { note: "inventura", created_by: null });

  const audit = await env.DB.prepare("select user_name, section from audit_log").first();
  assert.deepEqual({ ...audit }, { user_name: "Jana Nová (odkaz: recepce)", section: "oteviraci-doba" });
});

test("odkaz s „rovnou“ zapíše hned, bez jména nic a odkaz zůstane, cizí změnu nezruší", async () => {
  const env = await freshEnv();
  const { link, place } = await linkFor(env, { direct: true });
  // Chybně vyplněný formulář odkaz nespotřebuje.
  assert.match((await post(env, `/sprava/${link.token}/zmena`, { ...closed, author: "" })).headers.get("location"), /chyba=/);
  assert.match((await post(env, `/sprava/${link.token}/zmena`, { ...closed, startsOn: "" })).headers.get("location"), /chyba=/);
  assert.notEqual(await linkByToken(env, link.token), null);
  const saved = await post(env, `/sprava/${link.token}/zmena`, closed);
  assert.equal(saved.status, 200);
  assert.match(await saved.text(), /Změna je na webu/);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);
  assert.equal(await linkByToken(env, link.token), null);

  // Nový odkaz: cizí změnu zrušit nejde, údaje jdou.
  const next = (await linkFor(env, { direct: true })).link;
  const other = await env.DB.prepare("select id from places where id <> ? limit 1").bind(place.id).first();
  await env.DB.prepare("insert into place_changes (place_id, kind, starts_on, ends_on, note, hours) values (?, 'docasna', '2026-11-01', '2026-11-01', 'cizí', '[]')").bind(other.id).run();
  const foreign = (await env.DB.prepare("select id from place_changes where note = 'cizí'").first()).id;
  assert.match((await post(env, `/sprava/${next.token}/zrusit`, { id: String(foreign), author: "Jana" })).headers.get("location"), /chyba=/);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 2);
  await post(env, `/sprava/${next.token}/udaje`, { label: "Pobočka", place: "Náměstí 1", phone: "123", author: "Jana" });
  assert.equal((await env.DB.prepare("select phone from places where id = ?").bind(place.id).first()).phone, "123");
});

test("použitý, prošlý nebo vymyšlený odkaz nefunguje a trvalé odkazy se při migraci smažou", async () => {
  const env = await freshEnv();
  const { link } = await linkFor(env, { direct: true });
  await post(env, `/sprava/${link.token}/zmena`, closed);
  assert.equal((await post(env, `/sprava/${link.token}/zmena`, closed)).status, 404);

  const fresh = (await linkFor(env, { direct: true })).link;
  await env.DB.prepare("update hours_links set expires_at = datetime('now', '-1 minutes')").run();
  assert.equal((await post(env, `/sprava/${fresh.token}/zmena`, closed)).status, 404);
  const url = new URL("http://drbna.test/sprava/vymysleny-token-1234");
  assert.equal((await manageGet(url.pathname, new Request(url), env, url)).status, 404);

  // Starý trvalý odkaz (bez `once`) migrace smaže, jednorázový nechá.
  await env.DB.prepare("delete from hours_links").run();
  const place = await env.DB.prepare("select id from places order by id limit 1").first();
  await env.DB.prepare("insert into hours_links (section, target_id, token, once) values ('oteviraci-doba', ?, 'trvaly-odkaz-0000000000', 0)").bind(place.id).run();
  await createMailLink(env, { section: "oteviraci-doba", targetId: place.id, label: "e-mail", direct: false });
  await ensureLinkTables(env);
  assert.equal((await env.DB.prepare("select count(*) as n from hours_links").first()).n, 1);
  assert.equal(await linkByToken(env, "trvaly-odkaz-0000000000"), null);
});
