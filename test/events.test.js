import assert from "node:assert/strict";
import test from "node:test";
import { mapEvent, readEventLink, saveBotEvent } from "../src/events-db.js";
import { calendarHtml } from "../src/events-calendar.js";
import { eventsPage } from "../src/events-view.js";
import { DatabaseSync } from "node:sqlite";

const row = { id: 1, title: "Posvícení", place: "Náměstí", starts_on: "2026-10-10", starts_time: "", description: "", published: 1 };

test("odkaz jinam bere jen celou adresu http(s)", () => {
  assert.deepEqual(readEventLink(""), { link: "" });
  assert.deepEqual(readEventLink(" https://kopidlno.cz/akce "), { link: "https://kopidlno.cz/akce" });
  assert.ok(readEventLink("javascript:alert(1)").error);
  assert.ok(readEventLink("kopidlno.cz").error);
});

test("na webu je odkaz jen na zveřejněnou zprávu, návrh jen dokud čeká", () => {
  const hidden = mapEvent({ ...row, article_id: 5, article_slug: "posviceni", article_published: 0 });
  assert.equal(hidden.articleId, 5);
  assert.equal(hidden.articleSlug, "");
  const shown = mapEvent({ ...row, article_id: 5, article_slug: "posviceni", article_published: 1 });
  assert.equal(shown.articleSlug, "posviceni");
  assert.equal(mapEvent({ ...row, proposal_id: 7, proposal_status: "pending" }).proposalId, 7);
  assert.equal(mapEvent({ ...row, proposal_id: 7, proposal_status: "rejected" }).proposalId, null);
});

test("znovu zpracovaná položka importu nezaloží druhou akci, jen k ní připojí novou zprávu", async () => {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => ({ meta: { last_row_id: Number(db.prepare(sql).run(...values).lastInsertRowid) } }),
    first: async () => db.prepare(sql).get(...values) ?? null,
  });
  const env = { DB: { prepare: (sql) => statement(sql) } };
  db.exec(`create table events (id integer primary key, title text, place text, starts_on text, starts_time text, description text,
    published integer, article_id integer, proposal_id integer)`);
  const event = { title: "Trhy", place: "Zámek", startsOn: "2026-10-10", startsTime: "", description: "" };
  const first = await saveBotEvent(env, event, { published: true, articleId: 4 });
  db.exec("update events set article_id = null");
  assert.equal(await saveBotEvent(env, event, { existingId: first, published: true, proposalId: 9 }), first);
  assert.equal(await saveBotEvent(env, null, { existingId: first, published: true, articleId: 5 }), first);
  assert.deepEqual({ ...db.prepare("select count(*) as n, article_id, proposal_id from events").get() }, { n: 1, article_id: 5, proposal_id: null });
  assert.notEqual(await saveBotEvent(env, event, { existingId: 99, published: true }), first);
  assert.equal(await saveBotEvent(env, null, { existingId: 99, published: true }), null);
});

test("dnešní akce je pod Dnes, ne mezi chystanými, a kalendář ukáže měsíc z adresy", () => {
  const ctx = { path: "/akce", copy: {}, mainOrigin: "https://drbna.test", origin: "https://drbna.test" };
  const events = [
    { id: 1, title: "Posvícení", place: "Náměstí", startsOn: "2026-10-03", startsTime: "14:00", description: "" },
    { id: 2, title: "Drakiáda", place: "Louka", startsOn: "2026-10-11", startsTime: "", description: "" },
    { id: 3, title: "Ples", place: "Sál", startsOn: "2026-11-20", startsTime: "", description: "" },
  ];
  const html = eventsPage({ events, waste: { today: "2026-10-03" }, ads: [] }, ctx);
  const todayAt = html.indexOf("Dnes se koná");
  assert.ok(todayAt > 0);
  assert.ok(html.indexOf('id="akce-1"') > todayAt && html.indexOf('id="akce-1"') < html.indexOf("Chystá se"));
  assert.match(html, /<h2 tabindex="-1">říjen 2026<\/h2>/);
  assert.match(html, /class="cal-day is-today has-events"/);
  assert.match(html, /href="\/akce\?mesic=2026-11#kalendar"/);
  assert.doesNotMatch(html, /Zpět na dnešek/);

  const november = eventsPage({ events, waste: { today: "2026-10-03" }, ads: [] }, ctx, { month: "2026-11" });
  assert.match(november, /listopad 2026/);
  assert.match(november, /href="#akce-3"/);
  assert.match(november, /Zpět na dnešek/);
  assert.match(november, /href="\/akce#kalendar" data-cal-nav aria-label="říjen 2026"/);
  assert.match(eventsPage({ events, waste: { today: "2026-10-03" }, ads: [] }, ctx, { month: "nesmysl" }), /říjen 2026/);
});

test("kalendář začíná pondělím a přeskočí přes rok", () => {
  const html = calendarHtml([], "2026-12-15", "", { calendar: "", back: "", count: () => "" });
  // 1. 12. 2026 je úterý, takže jedno prázdné políčko.
  assert.equal(html.match(/is-blank/g).length, 1);
  assert.match(html, /mesic=2027-01/);
  assert.match(html, /mesic=2026-11/);
});
