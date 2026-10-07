import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureHealthTables, loadHealthRows, noteCron, noteOff, noteSource, statusResponse, trackJob } from "../src/health/store.js";
import { healthOf, problemCount } from "../src/health/rules.js";
import { healthChanges, healthMail } from "../src/health/check.js";
import { adminHealth } from "../src/admin/health.js";

// Malá náhrada D1 nad SQLite v paměti.
function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { results: [], meta: { changes: result.changes ?? 0 } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return { prepare: (sql) => statement(sql) };
}

async function freshEnv() {
  const env = { DB: d1() };
  await ensureHealthTables(env);
  return env;
}

const at = (iso) => new Date(iso);
const SOURCE = { key: "munipolis", label: "Munipolis", page: "/redakce/munipolis" };

async function row(env, key = "munipolis") {
  return (await loadHealthRows(env)).find((entry) => entry.key === key);
}

test("zdroj, který jde, je v pořádku a pamatuje si počet", async () => {
  const env = await freshEnv();
  await noteSource(env, { ...SOURCE, items: 12 }, at("2026-10-07T06:15:00Z"));
  const saved = await row(env);
  assert.equal(saved.items, 12);
  assert.equal(saved.okAt, "2026-10-07T06:15:00.000Z");
  assert.deepEqual(healthOf(saved, at("2026-10-07T08:00:00Z")), { state: "ok", text: "Ve zdroji: 12." });
});

test("chyba je napřed jen pozor, po 24 hodinách nefunguje, a úspěch ji smaže", async () => {
  const env = await freshEnv();
  await noteSource(env, { ...SOURCE, items: 12 }, at("2026-10-06T02:00:00Z"));
  await noteSource(env, { ...SOURCE, error: "Munipolis odpověděl 500." }, at("2026-10-06T06:00:00Z"));
  await noteSource(env, { ...SOURCE, error: "Munipolis odpověděl 502." }, at("2026-10-06T10:00:00Z"));
  let saved = await row(env);
  assert.equal(saved.items, 12, "počet z posledního úspěchu zůstane");
  assert.equal(saved.failingSince, "2026-10-06T06:00:00.000Z", "začátek chyby se nepřepisuje");
  assert.equal(healthOf(saved, at("2026-10-06T10:00:00Z")).state, "pozor");
  const broken = healthOf(saved, at("2026-10-07T07:00:00Z"));
  assert.equal(broken.state, "chyba");
  assert.match(broken.text, /^Nejde od 6\. 10\. 2026 v 08:00: Munipolis odpověděl 502\.$/);
  await noteSource(env, { ...SOURCE, items: 13 }, at("2026-10-07T08:00:00Z"));
  saved = await row(env);
  assert.equal(saved.error, "");
  assert.equal(saved.failingSince, "");
  assert.equal(healthOf(saved, at("2026-10-07T08:00:00Z")).state, "ok");
});

test("prázdný zdroj hlásí až po třech dnech, zdroj s allowEmpty nikdy", async () => {
  const env = await freshEnv();
  await noteSource(env, { ...SOURCE, items: 0 }, at("2026-10-01T06:00:00Z"));
  await noteSource(env, { ...SOURCE, items: 0 }, at("2026-10-03T06:00:00Z"));
  const saved = await row(env);
  assert.equal(saved.emptySince, "2026-10-01T06:00:00.000Z");
  assert.equal(healthOf(saved, at("2026-10-03T06:00:00Z")).state, "pozor");
  assert.equal(healthOf(saved, at("2026-10-04T07:00:00Z")).state, "chyba");
  await noteSource(env, { ...SOURCE, items: 0, allowEmpty: true }, at("2026-10-04T07:00:00Z"));
  assert.equal(healthOf(await row(env), at("2026-10-04T07:00:00Z")).state, "ok");
  await noteSource(env, { ...SOURCE, items: 4 }, at("2026-10-04T08:00:00Z"));
  assert.equal((await row(env)).emptySince, "");
});

test("zdroj, který se dlouho nestáhl, nefunguje; vypnutý se nehlídá", async () => {
  const env = await freshEnv();
  await noteSource(env, { key: "okoli:kzmj", label: "Okolí: KZMJ", items: 80 }, at("2026-10-05T06:00:00Z"));
  await noteSource(env, { key: "fotbal", label: "Web FK", items: 9, everyHours: 24 }, at("2026-10-05T06:00:00Z"));
  await noteSource(env, { key: "ndic", label: "NDIC", items: 3, everyHours: 0 }, at("2026-10-01T06:00:00Z"));
  const now = at("2026-10-06T12:00:00Z");
  assert.match(healthOf(await row(env, "okoli:kzmj"), now).text, /^Nestahuje se, naposledy 5\. 10\. 2026 v 08:00\.$/);
  assert.equal(healthOf(await row(env, "fotbal"), now).state, "ok", "jednou denně: 48 hodin rezervy");
  assert.equal(healthOf(await row(env, "ndic"), now).state, "ok", "NDIC se na čas nehlídá");
  await noteOff(env, ["okoli:kzmj"]);
  assert.equal(healthOf(await row(env, "okoli:kzmj"), now).state, "vypnuto");
  await noteSource(env, { key: "okoli:kzmj", label: "Okolí: KZMJ", items: 81 }, now);
  assert.equal((await row(env, "okoli:kzmj")).off, false, "stažení zdroj zase hlídá");
});

test("výjimka úlohy cronu se zapíše a další běh bez chyby ji smaže", async () => {
  const env = await freshEnv();
  const job = { key: "denik", label: "Import z Deníku" };
  assert.equal(await trackJob(env, job, async () => { throw new Error("D1 nejde"); }), null);
  let saved = await row(env, "cron:denik");
  assert.equal(saved.kind, "uloha");
  assert.equal(saved.error, "D1 nejde");
  assert.equal(await trackJob(env, job, async () => "hotovo"), "hotovo");
  saved = await row(env, "cron:denik");
  assert.equal(saved.error, "");
  assert.equal(healthOf(saved).text, "Doběhla bez chyby.");
});

test("e-mail jen při změně: rozbité jednou, opravené jednou, cron nikdy", async () => {
  const now = at("2026-10-07T08:00:00Z");
  const base = { page: "", kind: "zdroj", items: 5, emptySince: "", everyHours: 4, allowEmpty: false, off: false, okAt: "", triedAt: "2026-10-07T06:00:00Z" };
  const rows = [
    { ...base, key: "denik", label: "Jičínský deník", error: "Deník odpověděl 403.", failingSince: "2026-10-05T06:00:00Z", alerted: "" },
    { ...base, key: "munipolis", label: "Munipolis", error: "Nejde.", failingSince: "2026-10-05T06:00:00Z", alerted: "chyba" },
    { ...base, key: "skola", label: "ZŠ a MŠ", error: "", failingSince: "", alerted: "chyba" },
    { ...base, key: "cron", label: "Cron", kind: "cron", error: "", failingSince: "", triedAt: "2026-10-01T00:00:00Z", alerted: "" },
  ];
  const changes = healthChanges(rows, now);
  assert.deepEqual(changes.broken.map(({ row: entry }) => entry.key), ["denik"]);
  assert.deepEqual(changes.fixed.map(({ row: entry }) => entry.key), ["skola"]);
  const mail = healthMail(changes);
  assert.equal(mail.subject, "Drbna: 1 věc nefunguje");
  assert.deepEqual(mail.fields, [["Jičínský deník", "Nejde od 5. 10. 2026 v 08:00: Deník odpověděl 403."], ["ZŠ a MŠ", "Zase funguje."]]);
  assert.equal(healthMail({ broken: [], fixed: changes.fixed }).subject, "Drbna: zase funguje ZŠ a MŠ");
  assert.equal(problemCount(rows, now), 3, "menu počítá i neběžící cron");
});

test("/stav.json: 200 s běžícím cronem, jinak 503", async () => {
  const env = await freshEnv();
  let response = await statusResponse(env, at("2026-10-07T08:00:00Z"));
  assert.equal(response.status, 503);
  await noteCron(env, at("2026-10-07T06:15:00Z"));
  response = await statusResponse(env, at("2026-10-07T08:00:00Z"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cron: "ok", at: "2026-10-07T06:15:00.000Z" });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await statusResponse(env, at("2026-10-07T13:00:00Z"))).status, 503);
});

test("stránka Stav ukáže problém nahoře a fronty s chybou", async () => {
  const env = await freshEnv();
  const now = at("2026-10-07T08:00:00Z");
  await noteCron(env, at("2026-10-07T06:15:00Z"));
  await noteSource(env, { ...SOURCE, items: 12 }, at("2026-10-07T06:15:00Z"));
  await noteSource(env, { key: "denik", label: "Jičínský deník", page: "/redakce/denik", error: "Deník odpověděl 403." }, at("2026-10-05T06:15:00Z"));
  await noteSource(env, { key: "denik", label: "Jičínský deník", page: "/redakce/denik", error: "Deník odpověděl 403." }, at("2026-10-07T06:15:00Z"));
  const data = {
    signedIn: true,
    user: { id: 1, name: "Hlavní", role: "hlavni", permissions: [] },
    health: { rows: await loadHealthRows(env), queues: [{ label: "Munipolis", page: "/redakce/munipolis", waiting: 2, failed: 1 }], search: 0 },
  };
  data.healthRows = data.health.rows;
  const page = adminHealth({ path: "/redakce/stav" }, data, null, now);
  assert.ok(page.indexOf("Jičínský deník") < page.indexOf("Munipolis</h3>"), "nefunkční zdroj je první");
  assert.match(page, /Nefunguje/);
  assert.match(page, /Čeká: 2, s chybou: 1/);
  assert.match(page, /Cron běží každé 4 hodiny, naposledy 7\. 10\. 2026 v 08:15\./);
});
