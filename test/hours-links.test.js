import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureLoginTables, sha256 } from "../src/login-db.js";
import { ensurePlaceTables, PLACE_ACTIONS } from "../src/places-db.js";
import { approveRequest, ensureRequestTables, loadRequests } from "../src/hours-requests-db.js";
import { createLink, ensureLinkTables, LINK_DAILY_LIMIT, loadLinks, removeLink } from "../src/hours-links-db.js";
import { ensureAuditTables } from "../src/audit-db.js";
import { formFields } from "../src/forms.js";
import { pragueNow } from "../src/waste.js";
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

async function linkFor(env, { direct = false } = {}) {
  const place = await env.DB.prepare("select id, name from places order by id limit 1").first();
  assert.equal((await createLink(env, chief(), { section: "oteviraci-doba", targetId: place.id, label: "recepce", direct })).ok, true);
  const [link] = (await loadLinks(env, { role: "hlavni" }))["oteviraci-doba"];
  return { link, place };
}

async function post(env, path, fields) {
  const request = new Request(`http://drbna.test${path}`, { method: "POST", body: new URLSearchParams(fields) });
  return managePost(path, request, env, await formFields(request.clone()));
}

const closed = { kind: "docasna", startsOn: "2026-10-20", endsOn: "", changeNote: "inventura", author: "Jana Nová" };

test("změna z odkazu čeká na schválení pod jménem žadatele a schválení ji zapíše", async () => {
  const env = await freshEnv();
  const { link, place } = await linkFor(env);
  const page = await manageGet(`/sprava/${link.token}`, new Request("http://drbna.test/"), env, new URL(`http://drbna.test/sprava/${link.token}`));
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(place.name));

  const response = await post(env, `/sprava/${link.token}/zmena`, closed);
  assert.match(response.headers.get("location"), /\?ok=zadost$/);
  assert.match(response.headers.get("set-cookie"), /drbna_sprava=Jana%20Nov%C3%A1/);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 0);

  const [request] = (await loadRequests(env, { id: 1, role: "hlavni", permissions: [] }))["oteviraci-doba"];
  assert.equal(request.author, "Jana Nová (odkaz: recepce)");
  assert.equal((await approveRequest(env, chief(), { section: "oteviraci-doba", actions: PLACE_ACTIONS, id: request.id, input: { ...closed, placeId: place.id } })).ok, true);
  const row = await env.DB.prepare("select note, created_by from place_changes").first();
  assert.deepEqual({ ...row }, { note: "inventura", created_by: null });

  const audit = await env.DB.prepare("select user_name, section from audit_log").first();
  assert.deepEqual({ ...audit }, { user_name: "Jana Nová (odkaz: recepce)", section: "oteviraci-doba" });
});

test("odkaz s „rovnou“ zapíše hned, bez jména nic, cizí změnu nezruší", async () => {
  const env = await freshEnv();
  const { link, place } = await linkFor(env, { direct: true });
  assert.match((await post(env, `/sprava/${link.token}/zmena`, { ...closed, author: "" })).headers.get("location"), /chyba=/);
  assert.match((await post(env, `/sprava/${link.token}/zmena`, closed)).headers.get("location"), /ok=misto-zmena$/);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 1);

  const other = await env.DB.prepare("select id from places where id <> ? limit 1").bind(place.id).first();
  await env.DB.prepare("insert into place_changes (place_id, kind, starts_on, ends_on, note, hours) values (?, 'docasna', '2026-11-01', '2026-11-01', 'cizí', '[]')").bind(other.id).run();
  const foreign = (await env.DB.prepare("select id from place_changes where note = 'cizí'").first()).id;
  assert.match((await post(env, `/sprava/${link.token}/zrusit`, { id: String(foreign), author: "Jana" })).headers.get("location"), /chyba=/);
  assert.equal((await env.DB.prepare("select count(*) as n from place_changes").first()).n, 2);

  await post(env, `/sprava/${link.token}/udaje`, { label: "Pobočka", place: "Náměstí 1", phone: "123", author: "Jana" });
  assert.equal((await env.DB.prepare("select phone from places where id = ?").bind(place.id).first()).phone, "123");
});

test("do limitu se počítají jen uložené změny", async () => {
  const env = await freshEnv();
  const { link } = await linkFor(env, { direct: true });
  const used = async () => (await env.DB.prepare("select used_count from hours_links where id = ?").bind(link.id).first()).used_count;
  assert.match((await post(env, `/sprava/${link.token}/zmena`, { ...closed, startsOn: "" })).headers.get("location"), /chyba=/);
  assert.equal(await used(), 0, "chybně vyplněný formulář se nepočítá");
  await post(env, `/sprava/${link.token}/zmena`, closed);
  assert.equal(await used(), 1);
});

test("zrušený nebo vymyšlený odkaz nefunguje a limit za den platí", async () => {
  const env = await freshEnv();
  const { link } = await linkFor(env, { direct: true });
  await env.DB.prepare("update hours_links set used_count = ?, used_on = ?").bind(LINK_DAILY_LIMIT, pragueNow().date).run();
  assert.match(decodeURIComponent((await post(env, `/sprava/${link.token}/zmena`, closed)).headers.get("location")), /moc změn/);

  await removeLink(env, chief(), { section: "oteviraci-doba", id: link.id });
  assert.equal((await post(env, `/sprava/${link.token}/zmena`, closed)).status, 404);
  const url = new URL("http://drbna.test/sprava/vymysleny-token-1234");
  assert.equal((await manageGet(url.pathname, new Request(url), env, url)).status, 404);
});
