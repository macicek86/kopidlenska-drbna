import assert from "node:assert/strict";
import test from "node:test";
import { buildPeriods, changeFields, packPeriods, readPeriods, unpackPeriods } from "../src/periods.js";
import { submitPeriods } from "../src/post-periods.js";
import { PLACE_ACTIONS } from "../src/places-db.js";
import { normalizeWeek } from "../src/doctors.js";

const part = (from, to) => ({ open: true, from, to, note: "" });
const regular = normalizeWeek([1, 2, 3, 4, 5].map((day) => ({ day, morning: part("08:00", "12:00"), afternoon: part("13:00", "16:00") }))).week;

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

test("období z formuláře: prázdné se přeskočí, pořadí podle data a poznámka se doplní", () => {
  const periods = readPeriods(form({ "p1-from": "2026-10-26", "p1-mode": "jendo", "p1-time": "10:00", "p2-from": "2026-10-14", "p2-mode": "zavreno", "p3-mode": "zavreno" }));
  assert.equal(periods.length, 2);
  const built = buildPeriods(periods, { regular, shape: "week2" });
  assert.deepEqual(built.items.map((item) => [item.startsOn, item.note]), [["2026-10-14", "Mimořádně zavřeno"], ["2026-10-26", "Zavírá už v 10:00"]]);
  const monday = built.items[1].week.find((slot) => slot.day === 1);
  assert.deepEqual([monday.morning.to, monday.afternoon.open], ["10:00", false]);
  assert.equal(built.items[0].week, null);
  assert.deepEqual(changeFields("oteviraci-doba", built.items[0]).kind, "docasna");
});

test("období: překryv, zkrácení bez účinku a chybějící čas jsou chyby s číslem období", () => {
  const overlap = buildPeriods(readPeriods(form({ "p1-from": "2026-10-14", "p1-to": "2026-10-16", "p1-mode": "zavreno", "p2-from": "2026-10-16", "p2-mode": "zavreno" })), { regular, shape: "week2" });
  assert.match(overlap.error, /Období 1 a Období 2 se překrývají/);
  // Pondělí 26. 10. běžně končí v 16:00, „jen do 17“ nic nezmění.
  const noEffect = buildPeriods(readPeriods(form({ "p1-from": "2026-10-26", "p1-mode": "jendo", "p1-time": "17:00" })), { regular, shape: "week2" });
  assert.match(noEffect.error, /Období 1: zadaný čas nic nemění/);
  assert.match(buildPeriods(readPeriods(form({ "p1-from": "2026-10-26", "p1-mode": "azod" })), { regular, shape: "week2" }).error, /doplňte čas/);
  assert.match(buildPeriods([], { regular, shape: "week2" }).error, /aspoň jedno období/);
});

test("období u dvora: jiná doba po dnech a zavřeno bez týdne", () => {
  const periods = readPeriods(form({ "p1-from": "2026-10-17", "p1-mode": "jina", "p1-open-6": "1", "p1-from-6": "08:00", "p1-to-6": "10:00", "p2-from": "2026-10-20", "p2-mode": "zavreno", "p2-note": "inventura" }));
  const built = buildPeriods(periods, { regular: null, shape: "week1" });
  assert.equal(built.error, undefined);
  assert.deepEqual(built.items[0].week.filter((slot) => slot.open), [{ day: 6, open: true, from: "08:00", to: "10:00" }]);
  assert.deepEqual(changeFields("dvory", built.items[1]), { startsOn: "2026-10-20", endsOn: "2026-10-20", reason: "inventura" });
});

test("chyba formuláře vrátí rozepsaná období: adresa nese koncept a ten se rozbalí do stejných hodnot", async () => {
  const periods = readPeriods(form({
    "p1-from": "2026-10-14", "p1-to": "2026-10-16", "p1-mode": "zavreno", "p1-note": "školení",
    "p2-from": "2026-10-15", "p2-mode": "jina", "p2-am-open-4": "1", "p2-am-from-4": "09:00", "p2-am-to-4": "11:00", "p2-am-note-4": "jen objednaní",
  }));
  const response = await submitPeriods({
    base: "/redakce/oteviraci-doba", back: "/redakce/oteviraci-doba?zmena=1", section: "oteviraci-doba", actions: PLACE_ACTIONS,
    idField: "placeId", targetId: 1, periods, regular, shape: "week2", save: async () => ({ ok: true }), okKey: "misto-zmena",
  });
  const target = new URL(response.headers.get("location"), "http://drbna.test");
  assert.match(target.searchParams.get("chyba"), /překrývají/);
  const draft = unpackPeriods(target.searchParams.get("obdobi"), "week2");
  assert.deepEqual(draft.map((item) => [item.startsOn, item.endsOn, item.mode, item.note]), [["2026-10-14", "2026-10-16", "zavreno", "školení"], ["2026-10-15", "", "jina", ""]]);
  const thursday = draft[1].week.find((slot) => slot.day === 4);
  assert.deepEqual([thursday.morning.open, thursday.morning.from, thursday.morning.to, thursday.morning.note], [true, "09:00", "11:00", "jen objednaní"]);
  assert.equal(thursday.afternoon.open, false);
  // Poškozený koncept formulář nerozbije.
  assert.deepEqual(unpackPeriods("%%%", "week2"), []);
  assert.equal(packPeriods([]).length > 0, true);
});
