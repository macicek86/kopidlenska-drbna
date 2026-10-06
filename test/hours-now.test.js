import assert from "node:assert/strict";
import test from "node:test";
import { blankWeek } from "../src/doctors.js";
import { dayGroups } from "../src/hours-days.js";
import { stateNow } from "../src/hours-now.js";
import { PLACE_SEEDS } from "../src/places.js";
import { placesPage } from "../src/view.js";

const kvc = { id: 2, ...PLACE_SEEDS.find((seed) => seed.label === "KVC"), changes: [] };
const knihovna = { id: 1, ...PLACE_SEEDS.find((seed) => seed.name === "Knihovna"), changes: [] };

function closure(startsOn, endsOn, note = "dovolená") {
  return { id: 9, kind: "docasna", startsOn, endsOn, note, week: blankWeek() };
}

test("stejné dny po sobě jsou jeden řádek, dnešek zvlášť, běžně zavřené dny chybí", () => {
  // Neděle 4. 10.: dnes zavřeno, Po–Čt stejně, Pá kratší, sobota se vynechá.
  const groups = dayGroups(kvc, "2026-10-04");
  assert.deepEqual(groups.map((group) => [group.from, group.to]), [
    ["2026-10-04", "2026-10-04"],
    ["2026-10-05", "2026-10-08"],
    ["2026-10-09", "2026-10-09"],
  ]);
  // Ve čtvrtek je dnešek zvlášť a zítřek se k němu nepřidá.
  assert.deepEqual(dayGroups(kvc, "2026-10-05").map((group) => group.from).slice(0, 2), ["2026-10-05", "2026-10-06"]);
  // Zavřeno kvůli změně zůstane jako jeden řádek s důvodem.
  const closed = dayGroups({ ...kvc, changes: [closure("2026-10-06", "2026-10-07")] }, "2026-10-04");
  assert.deepEqual(closed.map((group) => [group.from, group.to, group.change?.id ?? null]), [
    ["2026-10-04", "2026-10-04", null],
    ["2026-10-05", "2026-10-05", null],
    ["2026-10-06", "2026-10-07", 9],
    ["2026-10-08", "2026-10-08", null],
    ["2026-10-09", "2026-10-09", null],
  ]);
  // Dlouhé zavření je jeden řádek od začátku do konce, i když začalo dnes a trvá přes víkend a za 7 dní.
  const long = dayGroups({ ...kvc, changes: [closure("2026-10-07", "2026-10-20")] }, "2026-10-07");
  // Pod ním je první den, kdy se zase otevře.
  assert.deepEqual(long.map((group) => [group.from, group.to, group.change?.id ?? null]), [
    ["2026-10-07", "2026-10-20", 9],
    ["2026-10-21", "2026-10-21", null],
  ]);
  // V sobotu uprostřed zavření nemá dnešek vlastní řádek.
  assert.deepEqual(dayGroups({ ...kvc, changes: [closure("2026-10-07", "2026-10-20")] }, "2026-10-10").map((group) => group.from), ["2026-10-07", "2026-10-21"]);
  // Zavření do pátku: další otevřený den je až pondělí za 7 dní.
  const friday = dayGroups({ ...kvc, changes: [closure("2026-10-05", "2026-10-09")] }, "2026-10-05");
  assert.deepEqual(friday.map((group) => group.from), ["2026-10-05", "2026-10-12"]);
});

test("kdo má teď otevřeno: otevřeno, pauza, později a další otevření", () => {
  assert.deepEqual(stateNow(kvc, { date: "2026-10-05", time: "10:30" }), { open: true, text: "Otevřeno do 12:00", note: "" });
  assert.equal(stateNow(kvc, { date: "2026-10-05", time: "12:15" }).text, "Pauza, znovu od 13:00");
  assert.equal(stateNow(kvc, { date: "2026-10-05", time: "07:00" }).text, "Dnes od 9:00");
  assert.equal(stateNow(kvc, { date: "2026-10-05", time: "17:00" }).text, "Zavřeno, zítra od 9:00");
  assert.equal(stateNow(kvc, { date: "2026-10-09", time: "13:00" }).text, "Zavřeno, v pondělí od 9:00");
  assert.equal(stateNow(knihovna, { date: "2026-10-06", time: "18:00" }).text, "Zavřeno, ve čtvrtek od 9:00");
  // Zavírka: stav počítá s ní a ukáže důvod.
  const state = stateNow({ ...kvc, changes: [closure("2026-10-05", "2026-10-06")] }, { date: "2026-10-05", time: "10:00" });
  assert.deepEqual(state, { open: false, text: "Zavřeno, ve středu od 9:00", note: "dovolená" });
});

test("stránka: přehled nahoře vede na karty, se změnou sloučené dny mají časy na jednom řádku", () => {
  const closed = { ...kvc, changes: [closure("2026-10-09", "2026-10-09")] };
  const data = { places: [knihovna, closed], waste: { today: "2026-10-05" }, now: { date: "2026-10-05", time: "10:30" } };
  const page = placesPage(data, { path: "/oteviraci-doba", copy: {} });
  assert.match(page, /Kdo má teď otevřeno <span class="now-time">10:30<\/span>/);
  assert.match(page, /<li class="is-soon"><a href="#misto-1">Knihovna<\/a><span class="now-state">Dnes od 13:00<\/span><\/li>/);
  assert.match(page, /<li class="is-open"><a href="#misto-2">Komunitní a vzdělávací centrum<\/a><span class="now-state">Otevřeno do 12:00<\/span><\/li>/);
  assert.match(page, /<span class="day">Úterý–čtvrtek 6\.–8\.&nbsp;10\.<\/span><p class="parts one-line"><strong>09:00–12:00<\/strong>, <strong>13:00–17:00<\/strong><\/p>/);
  assert.doesNotMatch(page, /place-jump/);
  // Knihovna se tento týden nemění: sloučený běžný týden od pondělí s daty, bez zavřených dnů, bez okna s běžnou dobou.
  const card = page.slice(page.indexOf('id="misto-1"'), page.indexOf('id="misto-2"'));
  assert.match(card, /<li class="is-today"><span class="day">Pondělí 5\.&nbsp;10\.<span class="today-mark">dnes<\/span><\/span>/);
  assert.match(card, /<span class="day">Úterý 6\.&nbsp;10\.<\/span>/);
  assert.doesNotMatch(card, /Středa|zavřeno|bezne-misto/);
  assert.match(page, /bezne-misto-2/);
});

test("bez času (pokyny chatu) stránky neukazují, kdo má teď otevřeno, ať se nemění každou minutu", async () => {
  const { yardsPage } = await import("../src/yards-view.js");
  const timeless = { places: [knihovna, kvc], waste: { today: "2026-10-05" }, now: false };
  const page = placesPage(timeless, { path: "/oteviraci-doba", copy: {} });
  assert.doesNotMatch(page, /now-board|now-time/);
  assert.match(page, /place-jump/);
  const yard = { id: 1, name: "Sběrný dvůr", place: "Kopidlno", accepts: "", week: [{ day: 1, open: true, from: "08:00", to: "12:00" }], closures: [], legacy: "" };
  const at = (now) => yardsPage({ yards: [yard], waste: { today: "2026-10-05" }, now }, { path: "/sberne-dvory", copy: {} });
  assert.notEqual(at({ date: "2026-10-05", time: "09:00" }), at({ date: "2026-10-05", time: "13:00" }));
  assert.match(at({ date: "2026-10-05", time: "09:00" }), /je teď otevřený/);
  assert.doesNotMatch(at(false), /je teď/);
});
