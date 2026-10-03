import assert from "node:assert/strict";
import test from "node:test";
import { blankWeek, DOCTOR_SEEDS } from "../src/doctors.js";
import { hoursOn, laterChanges, nextDays } from "../src/hours-days.js";
import { doctorsPage } from "../src/view.js";

const practice = DOCTOR_SEEDS[0];

function withPart(week, day, part) {
  return week.map((slot) => (slot.day === day ? { ...slot, morning: { open: true, ...part }, afternoon: { ...slot.afternoon, open: false } } : slot));
}

// Leták: Ulrych neordinuje 6., 13. a 14. 10., 7. 10. ordinuje 7–13, Ulrychová po, čt, pá.
const swap = (part) => ({ ...part, note: part.note.replace(/ordinuje MUDr\. Ulrych$|ordinují MUDr\. Ulrych a MUDr\. Ulrychová/, "ordinuje MUDr. Ulrychová") });
const period = {
  id: 1,
  startsOn: "2026-10-06",
  endsOn: "2026-10-14",
  note: "MUDr. Ulrych neordinuje",
  week: practice.week.map((slot) =>
    [2, 3].includes(slot.day)
      ? { ...slot, morning: { ...slot.morning, open: false }, afternoon: { ...slot.afternoon, open: false } }
      : { ...slot, morning: swap(slot.morning), afternoon: swap(slot.afternoon) },
  ),
};
const wednesday = { id: 2, startsOn: "2026-10-07", endsOn: "2026-10-07", note: "jiné hodiny", week: withPart(blankWeek(), 3, { from: "07:00", to: "13:00", note: "ordinuje MUDr. Ulrych" }) };
const doctor = { ...practice, id: 1, changes: [period, wednesday] };

test("příštích 7 dní: změna přepíše běžné hodiny, u překryvu platí ta, která začíná později", () => {
  const days = nextDays(doctor, "2026-10-03");
  assert.deepEqual(days.map((day) => day.iso), ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  assert.equal(days[2].change, null);
  assert.match(days[2].slot.morning.note, /ordinuje MUDr\. Ulrych$/);
  assert.equal(days[3].change.id, 1);
  assert.equal(days[3].slot.morning.open, false);
  assert.equal(days[4].change.id, 2);
  assert.equal(days[4].slot.morning.to, "13:00");
  assert.match(days[5].slot.morning.note, /ordinuje MUDr\. Ulrychová$/);
  assert.equal(hoursOn(doctor, "2026-10-15", "2026-10-03").change, null);
});

test("nová doba místa se zvýrazní, jen dokud nezačne platit", () => {
  const fresh = { id: 3, kind: "trvala", startsOn: "2026-10-05", endsOn: "2026-10-05", note: "", week: withPart(blankWeek(), 1, { from: "09:00", to: "11:00", note: "" }) };
  const place = { week: blankWeek(), changes: [fresh] };
  assert.equal(hoursOn(place, "2026-10-12", "2026-10-03").kind, "nova");
  assert.equal(hoursOn(place, "2026-10-04", "2026-10-03").kind, "");
  assert.equal(hoursOn(place, "2026-10-12", "2026-10-05").kind, "");
  assert.deepEqual(laterChanges(place, "2026-09-20").map((change) => change.id), [3]);
  assert.deepEqual(laterChanges(place, "2026-10-01"), []);
});

test("stránka lékařů: dny s datem, zvýrazněná změna, běžné hodiny v okně a stručné další změny", () => {
  const page = doctorsPage({ doctors: [doctor], waste: { today: "2026-10-03" } }, { path: "/lekari", copy: {} });
  assert.match(page, /<li class="is-change is-off"><span class="day">Úterý 6\.&nbsp;10\.<\/span><strong>zavřeno<\/strong><p class="change-note"><span class="change-mark">změna<\/span> MUDr\. Ulrych neordinuje<\/p><\/li>/);
  assert.match(page, /Středa 7\.&nbsp;10\.<\/span><div class="parts"><p class="part"><span class="slot"><strong>07:00–13:00<\/strong>/);
  assert.match(page, /popovertarget="bezne-lekar-1">Běžné hodiny<\/button>/);
  // Změna 6.–14. 10. do 7 dní celá nespadá, je i v dalších změnách: datum, stav, důvod a rozpis v okně.
  assert.match(page, /Další změny/);
  assert.match(page, /<span class="tile-state">Jiné hodiny<\/span><span>MUDr\. Ulrych neordinuje<\/span><button type="button" class="pop-open" popovertarget="rozpis-lekar-1">Rozpis<\/button>/);
  assert.match(page, /id="rozpis-lekar-1" popover>/);
});
