import assert from "node:assert/strict";
import test from "node:test";
import { mapEvent, readEventLink, saveBotEvent } from "../src/events-db.js";
import { calendarHtml } from "../src/events-calendar.js";
import { eventsPage } from "../src/events-view.js";
import { DatabaseSync } from "node:sqlite";
import { applyEventChange, noteEventChange, readEventChange } from "../src/event-change.js";
import { eventsCalendar } from "../src/feeds/events.js";
import { outcomeOf } from "../src/import-context.js";
import { contextSections } from "../src/import-overview.js";
import { eventLd } from "../src/seo.js";

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
    published integer, article_id integer, proposal_id integer, created_at text not null default '')`);
  const event = { title: "Trhy", place: "Zámek", startsOn: "2026-10-10", startsTime: "", description: "" };
  const first = await saveBotEvent(env, event, { published: true, articleId: 4 });
  // Čas přidání pro feed nových akcí.
  assert.match(db.prepare("select created_at from events").get().created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
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

test("import zruší nebo změní akci v kalendáři, zrušená zůstává se štítkem", async () => {
  assert.equal(readEventChange({ include: false, ref: "akce:3", kind: "zruseno" }), null);
  assert.equal(readEventChange({ include: true, ref: "zprava:3", kind: "zruseno" }), null);
  assert.deepEqual(readEventChange({ include: true, ref: "akce:3", kind: "zruseno", date: "", time: "", place: "" }), { eventId: 3, kind: "zruseno" });
  assert.equal(readEventChange({ include: true, ref: "akce:3", kind: "zmena", date: "", time: "", place: "" }), null);
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => db.prepare(sql).run(...values),
    first: async () => db.prepare(sql).get(...values) ?? null,
  });
  const env = { DB: { prepare: (sql) => statement(sql) } };
  db.exec(`create table events (id integer primary key, title text, place text, starts_on text, starts_time text, cancelled integer not null default 0, updated_at text not null default '')`);
  db.exec(`insert into events (id, title, place, starts_on, starts_time) values (3, 'Drakiáda', 'Louka', '2026-11-22', '14:00')`);
  const moved = readEventChange({ include: true, ref: "akce:3", kind: "zmena", date: "2026-11-29", time: "14:00", place: "" });
  assert.equal(await applyEventChange(env, moved), "U akce akce:3 změnila den na 2026-11-29.");
  assert.equal(await applyEventChange(env, moved), "");
  assert.equal(await noteEventChange(env, { reason: "Ruší se.", eventChange: { eventId: 3, kind: "zruseno" } }), "Ruší se. Akci akce:3 v kalendáři označila jako zrušenou.");
  assert.deepEqual({ ...db.prepare("select starts_on, place, cancelled from events").get() }, { starts_on: "2026-11-29", place: "Louka", cancelled: 1 });
  assert.equal(await applyEventChange(env, { eventId: 99, kind: "zruseno" }), "");
  // Na webu: štítek, přeškrtnutí v kalendáři, JSON-LD i kalendář v telefonu vědí, že se nekoná.
  const event = { id: 3, title: "Drakiáda", place: "Louka", startsOn: "2026-11-29", startsTime: "14:00", description: "", cancelled: true, published: true, createdAt: "2026-10-01 08:00:00", updatedAt: "2026-10-06 20:00:00" };
  const ctx = { path: "/akce", copy: {}, mainOrigin: "https://drbna.test", origin: "https://drbna.test" };
  const html = eventsPage({ events: [event], waste: { today: "2026-11-01" }, ads: [] }, ctx);
  assert.match(html, /event-card is-cancelled/);
  assert.match(html, /<span class="cancel-tag">Zrušeno<\/span>/);
  assert.equal(eventLd("https://drbna.test", event).eventStatus, "https://schema.org/EventCancelled");
  const ics = eventsCalendar("https://drbna.test", [event], {}, "2026-11-01");
  assert.match(ics, /SUMMARY:Zrušeno: Drakiáda\r\nSTATUS:CANCELLED/);
  assert.match(ics, /DTSTAMP:20261006T200000Z/);
  // Přehled pro Drběnu: zrušená akce a odložená pozvánka z webu města.
  assert.match(contextSections({ events: [{ id: 3, title: "Drakiáda", place: "Louka", startsOn: "2026-11-29", startsTime: "", cancelled: true }] }).fixed, /\[akce:3\] 2026-11-29 · Drakiáda · Louka · ZRUŠENO/);
  assert.equal(outcomeOf({ status: "odlozeno", eventId: 21, writeOn: "2026-11-13" }), "akce akce:21 je v kalendáři, pozvánku drbna napíše 2026-11-13");
});
