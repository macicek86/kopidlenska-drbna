import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { auditFinish, auditLogin, auditStart, diffRows, outcome } from "../src/audit.js";
import { ensureAuditTables, loadAudit, PAGE_SIZE, pruneAudit, recordAudit } from "../src/audit-db.js";
import { auditRoute } from "../src/audit-routes.js";
import { adminAudit, shownValue } from "../src/admin/audit.js";
import { redirect } from "../src/http.js";
import { saveClosure, YARD_ACTIONS } from "../src/yards-db.js";
import { approveRequest, ensureRequestTables } from "../src/hours-requests-db.js";
import { ensurePlaceTables } from "../src/places-db.js";

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

const CHIEF = { id: 1, name: "Hlavní", role: "hlavni", permissions: [] };
const JANA = { id: 2, name: "Jana", role: "prispevatel", permissions: ["sberny_dvur_navrh"] };
const MESSAGES = { "zprava-upravena": "Zpráva je upravená.", zprava: "Zpráva je uložená.", "zprava-smazana": "Zpráva je smazaná." };

async function freshEnv() {
  const env = { DB: d1() };
  const run = (sql, ...values) => env.DB.prepare(sql).bind(...values).run();
  await ensureAuditTables(env);
  await run(`create table users (id integer primary key, login text, name text, alias text default '', email text default '',
    role text, password_hash text default '', session_token text, active integer default 1)`);
  await run("create table user_permissions (user_id integer, code text)");
  await run("create table articles (id integer primary key autoincrement, title text, body text, author_id integer, keywords text default '')");
  await run("create table yards (id integer primary key, name text, place text, accepts text, hours text, sort_order integer default 0, published integer default 1)");
  await run("create table yard_closures (id integer primary key autoincrement, yard_id integer, starts_on text, ends_on text, reason text, created_by integer)");
  await ensurePlaceTables(env);
  await ensureRequestTables(env);
  await run("insert into users (id, login, name, role, session_token) values (1, 'hlavni', 'Hlavní', 'hlavni', 'token-hlavni-0000000000')");
  await run("insert into users (id, login, name, role, session_token) values (2, 'jana', 'Jana', 'prispevatel', 'token-jana-00000000000')");
  await run("insert into user_permissions values (2, 'sberny_dvur_navrh')");
  await run("insert into yards (id, name, place, accepts, hours) values (1, 'Dvůr', 'Kopidlno', 'všechno', '[]')");
  await run("insert into articles (title, body, author_id) values ('Stará', '<p>Text</p>', 1)");
  return env;
}

async function entries(env) {
  return (await env.DB.prepare("select * from audit_log order by id").all()).results.map((row) => ({
    ...row,
    changes: row.changes ? JSON.parse(row.changes) : [],
  }));
}

const as = (token) => new Request("http://drbna.test/", { headers: { cookie: `drbna_editor=${token}` } });

test("rozdíl ukáže jen změněná pole a tajné sloupce vynechá", () => {
  assert.deepEqual(diffRows({ id: 1, title: "A", body: "x", password_hash: "1" }, { id: 1, title: "B", body: "x", password_hash: "2" }), {
    kind: "upraveno",
    fields: { title: ["A", "B"] },
  });
  assert.equal(diffRows({ title: "A", note: null }, { title: "A", note: "" }), null);
  assert.deepEqual(diffRows(null, { id: 3, title: "Nová", note: "" }), { kind: "nové", fields: { title: [null, "Nová"] } });
  assert.deepEqual(diffRows({ id: 3, title: "Pryč" }, null), { kind: "smazáno", fields: { title: ["Pryč", null] } });
});

test("výsledek formuláře: chyba se nezapisuje, hláška se vezme z ?ok=", () => {
  assert.deepEqual(outcome(redirect("/redakce/zpravy?ok=zprava")), { failed: false, okKey: "zprava" });
  assert.equal(outcome(redirect("/redakce/zpravy?chyba=Nic")).failed, true);
  assert.equal(outcome(new Response("x", { status: 404 })).failed, true);
});

test("úprava zprávy zapíše kdo, co a staré i nové hodnoty", async () => {
  const env = await freshEnv();
  const watch = await auditStart(env, "/redakce/zpravy/ulozit", { id: "1" }, async () => CHIEF);
  await env.DB.prepare("update articles set title = 'Nová', keywords = 'x' where id = 1").run();
  await auditFinish(env, watch, redirect("/redakce/zpravy?ok=zprava-upravena"), MESSAGES);
  const [entry] = await entries(env);
  assert.equal(entry.user_name, "Hlavní");
  assert.equal(entry.section, "zpravy");
  assert.equal(entry.action, "Zpráva je upravená.");
  assert.equal(entry.title, "Nová");
  assert.deepEqual(entry.changes, [{ label: "articles", id: 1, title: "Nová", kind: "upraveno", fields: { title: ["Stará", "Nová"] } }]);
});

test("nová a smazaná zpráva, uložení beze změny a chyba se nezapíšou zbytečně", async () => {
  const env = await freshEnv();
  let watch = await auditStart(env, "/redakce/zpravy/ulozit", {}, async () => CHIEF);
  await env.DB.prepare("insert into articles (title, body, author_id) values ('Čerstvá', '<p>Ahoj</p>', 1)").run();
  await auditFinish(env, watch, redirect("/redakce/zpravy?ok=zprava"), MESSAGES);

  watch = await auditStart(env, "/redakce/zpravy/smazat", { id: "1" }, async () => CHIEF);
  await env.DB.prepare("delete from articles where id = 1").run();
  await auditFinish(env, watch, redirect("/redakce/zpravy?ok=zprava-smazana"), MESSAGES);

  watch = await auditStart(env, "/redakce/zpravy/ulozit", { id: "2" }, async () => CHIEF);
  await auditFinish(env, watch, redirect("/redakce/zpravy?ok=zprava-upravena"), MESSAGES);
  watch = await auditStart(env, "/redakce/zpravy/ulozit", { id: "2" }, async () => CHIEF);
  await env.DB.prepare("update articles set title = 'Jiná' where id = 2").run();
  await auditFinish(env, watch, redirect("/redakce/zpravy?chyba=Ne"), MESSAGES);

  const list = await entries(env);
  assert.deepEqual(list.map((entry) => [entry.action, entry.changes[0].kind]), [
    ["Zpráva je uložená.", "nové"],
    ["Zpráva je smazaná.", "smazáno"],
  ]);
  assert.deepEqual(list[0].changes[0].fields.body, [null, "<p>Ahoj</p>"]);
});

test("bez přihlášení a na adresách mimo seznam se nic nefotí", async () => {
  const env = await freshEnv();
  assert.equal(await auditStart(env, "/redakce/zpravy/ulozit", {}, async () => null), null);
  assert.equal(await auditStart(env, "/redakce/drbena/zkusit", {}, async () => CHIEF), null);
  assert.equal(auditRoute("/redakce/heslo/ulozit").section, "ucet");
  assert.equal(auditRoute("/redakce/munipolis/zkontrolovat").always, true);
});

test("návrh uzavření dvora a jeho schválení: žádost, pak nové uzavření a zmizelá žádost", async () => {
  const env = await freshEnv();
  const input = { yardId: "1", startsOn: "2026-10-20", endsOn: "2026-10-21", reason: "inventura" };
  let watch = await auditStart(env, "/redakce/dvory/uzavreni", input, async () => JANA);
  const sent = await saveClosure(env, as("token-jana-00000000000"), input);
  assert.equal(sent.requested, true);
  await auditFinish(env, watch, redirect("/redakce/dvory?ok=zadost"), { zadost: "Návrh je odeslaný." });

  const requestId = (await env.DB.prepare("select id from hours_requests").first()).id;
  watch = await auditStart(env, "/redakce/dvory/zadost/schvalit", { ...input, requestId: String(requestId) }, async () => CHIEF);
  const approved = await approveRequest(env, as("token-hlavni-0000000000"), { section: "dvory", actions: YARD_ACTIONS, id: requestId, input });
  assert.equal(approved.ok, true);
  await auditFinish(env, watch, redirect("/redakce/dvory?ok=zadost-schvalena"), { "zadost-schvalena": "Návrh je schválený a zapsaný." });

  const [sentEntry, approvedEntry] = await entries(env);
  assert.equal(sentEntry.user_name, "Jana");
  assert.deepEqual(sentEntry.changes.map((change) => [change.label, change.kind]), [["návrh ke schválení", "nové"]]);
  assert.equal(approvedEntry.user_name, "Hlavní");
  assert.deepEqual(approvedEntry.changes.map((change) => [change.label, change.kind]), [
    ["yard_closures", "nové"],
    ["návrh ke schválení", "smazáno"],
  ]);
  assert.deepEqual(approvedEntry.changes[0].fields.reason, [null, "inventura"]);
});

test("přihlášení: povedené s účtem, nepovedené se jménem, které člověk napsal", async () => {
  const env = await freshEnv();
  await auditLogin(env, { ok: true, user: { id: 2, name: "Jana" } }, "jana");
  await auditLogin(env, { ok: false, error: "Jméno nebo heslo nesedí." }, "janka");
  const [ok, bad] = await entries(env);
  assert.deepEqual([ok.user_id, ok.user_name, ok.action], [2, "Jana", "Přihlášení heslem"]);
  assert.deepEqual([bad.user_id, bad.user_name, bad.action], [null, "janka", "Nepovedené přihlášení: Jméno nebo heslo nesedí."]);
});

test("stránka historie: filtr, stránkování a okno se změnami", async () => {
  const env = await freshEnv();
  for (let i = 0; i < PAGE_SIZE + 2; i++) await recordAudit(env, { user: CHIEF, section: "zpravy", action: `Akce ${i}` });
  await recordAudit(env, {
    user: { id: 2, name: "Jana" },
    section: "dvory",
    action: "Upraveno",
    title: "Dvůr",
    changes: [{ label: "yards", id: 1, title: "Dvůr", kind: "upraveno", fields: { hours: ['{"po":"8-12"}', '{"po":"8-14"}'] } }],
  });
  const first = await loadAudit(env, {});
  assert.equal(first.entries.length, PAGE_SIZE);
  assert.equal(first.more, true);
  assert.equal(first.entries[0].hasChanges, true);
  assert.equal(first.entries[1].hasChanges, false);
  const next = await loadAudit(env, { before: first.entries.at(-1).id });
  assert.equal(next.entries.length, 3);
  assert.equal(next.more, false);
  const jana = await loadAudit(env, { userId: 2, entryId: first.entries[0].id });
  assert.equal(jana.entries.length, 1);
  assert.deepEqual(jana.people.map((person) => person.name), ["Hlavní", "Jana"]);

  const page = adminAudit({ path: "/redakce/historie" }, { signedIn: true, user: CHIEF, audit: jana }, { text: "", kind: "ok" }, { userId: 2, entryId: 1 });
  assert.match(page, /Historie změn/);
  assert.match(page, /Sběrný dvůr<\/b> „Dvůr“/);
  assert.match(page, /Hodiny/);
  assert.match(page, /&quot;po&quot;: &quot;8-14&quot;/);
});

test("hodnota v okně: HTML jako text, JSON odsazený", () => {
  assert.equal(shownValue("<p>Ahoj <strong>světe</strong></p><p>Druhý</p>").replace(/\s+/g, " "), "Ahoj světe Druhý");
  assert.equal(shownValue('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(shownValue(null), "");
});

test("staré záznamy se mažou", async () => {
  const env = await freshEnv();
  await recordAudit(env, { user: CHIEF, section: "zpravy", action: "Nové" });
  await env.DB.prepare("insert into audit_log (at, user_id, user_name, section, action) values (datetime('now', '-400 days'), 1, 'Hlavní', 'zpravy', 'Staré')").run();
  await pruneAudit(env);
  assert.deepEqual((await entries(env)).map((entry) => entry.action), ["Nové"]);
});
