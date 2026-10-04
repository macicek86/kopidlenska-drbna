import assert from "node:assert/strict";
import test from "node:test";
import { blankWeek } from "../src/doctors.js";
import { groupedNotices, PLACE_SEEDS, placeNotices, visibleNewHours } from "../src/places.js";
import { hoursContext, readHours, weekFromSlots } from "../src/munipolis/hours.js";
import { outputSchema, readDecision } from "../src/munipolis/ai.js";
import { placesPage, homePage } from "../src/view.js";
import { adminPlaces } from "../src/admin/index.js";
import { refLink } from "../src/admin/imports.js";
import { offerLines } from "../src/places-db.js";
import { offerSection } from "../src/chat/context.js";

const SLUGS = ["zpravy", "prakticke"];
const knihovna = PLACE_SEEDS.find((seed) => seed.name === "Knihovna");

function place(id, seed, changes = []) {
  return { id, ...seed, changes };
}

function closure(id, placeId, startsOn, endsOn = startsOn, note = "školení k volbám") {
  return { id, placeId, kind: "docasna", startsOn, endsOn, note, week: blankWeek(), applied: false, sourceUrl: "" };
}

test("výchozí místa mají otevírací dobu z webu města", () => {
  assert.equal(knihovna.week.find((slot) => slot.day === 1).morning.open, false);
  assert.equal(knihovna.week.find((slot) => slot.day === 1).afternoon.from, "13:00");
  assert.ok(PLACE_SEEDS.some((seed) => seed.name === "Lékárna"));
});

test("stejné zavření víc míst je na titulce jeden řádek", () => {
  const places = [
    place(1, knihovna, [closure(1, 1, "2026-10-02")]),
    place(2, PLACE_SEEDS[2], [closure(2, 2, "2026-10-02")]),
    place(3, PLACE_SEEDS[0]),
  ];
  const notices = groupedNotices(places, "2026-10-01");
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].names, ["Knihovna", "Komunitní a vzdělávací centrum"]);
  assert.equal(notices[0].state, "Má 2. 10. zavřeno.");
  assert.deepEqual(groupedNotices(places, "2026-10-03"), []);
});

test("nová otevírací doba je na titulce jen chvíli před a po začátku", () => {
  const change = { id: 5, placeId: 1, kind: "trvala", startsOn: "2026-11-01", endsOn: "2026-11-01", note: "", week: PLACE_SEEDS[2].week };
  const library = place(1, knihovna, [change]);
  assert.equal(visibleNewHours(library, "2026-10-10"), null);
  assert.equal(placeNotices(library, "2026-10-20")[0].state, "Od 1. 11. bude mít novou otevírací dobu.");
  assert.equal(placeNotices(library, "2026-11-10")[0].state, "Od 1. 11. má novou otevírací dobu.");
  assert.deepEqual(placeNotices(library, "2026-11-20"), []);
});

test("úseky od Claude se složí do týdne a změny se ověří", () => {
  const { week } = weekFromSlots([
    { day: "po", from: "13:00", to: "17:00", note: "" },
    { day: "ut", from: "13:00", to: "17:00", note: "" },
    { day: "ut", from: "9:00", to: "12:00", note: "" },
  ]);
  assert.equal(week.find((slot) => slot.day === 1).afternoon.open, true);
  assert.equal(week.find((slot) => slot.day === 2).morning.from, "09:00");
  const changes = readHours([
    { target: "misto:2", new_place: "", new_place_label: "", kind: "zavreno", starts_on: "2026-10-02", ends_on: "", note: "školení", slots: [] },
    { target: "nove", new_place: "Lékárna", new_place_label: "", kind: "docasna", starts_on: "2026-08-27", ends_on: "2026-08-27", note: "delší polední pauza", slots: [{ day: "ct", from: "8:00", to: "12:00", note: "" }, { day: "ct", from: "14:00", to: "16:00", note: "" }] },
    { target: "lekar:2", new_place: "", new_place_label: "", kind: "trvala", starts_on: "2026-10-02", ends_on: "", note: "", slots: [{ day: "po", from: "8:00", to: "12:00", note: "" }] },
    { target: "cokoli", new_place: "", new_place_label: "", kind: "zavreno", starts_on: "2026-10-02", ends_on: "", note: "", slots: [] },
  ]);
  assert.equal(changes.length, 2);
  assert.deepEqual(changes[0].target, { type: "misto", id: 2 });
  assert.equal(changes[0].endsOn, "2026-10-02");
  assert.equal(changes[1].target.name, "Lékárna");
  assert.equal(changes[1].week.find((slot) => slot.day === 4).afternoon.from, "14:00");
});

test("zavření Drběna jen propíše, článek zahodí; u trvalé změny ho nechá", () => {
  const schema = outputSchema(SLUGS, { hours: true });
  assert.ok(schema.required.includes("hours"));
  assert.equal(outputSchema(SLUGS).properties.hours, undefined);
  const base = {
    decision: "vytvorit",
    reason: "Zavřeno.",
    duplicate_of: "",
    article: { include: true, title: "Knihovna zavřená", excerpt: "V pátek zavřeno.", body_html: "<p>Zavřeno.</p>", rubric: "prakticke", image_caption: "" },
    event: { include: false, title: "", place: "", date: "", time: "", description: "" },
    notice: { include: false, kind: "voda", title: "", starts_on: "", starts_time: "", ends_on: "", ends_time: "", places: [], note: "" },
  };
  const closed = { target: "misto:2", new_place: "", new_place_label: "", kind: "zavreno", starts_on: "2026-10-02", ends_on: "", note: "", slots: [] };
  const result = readDecision({ ...base, hours: [closed] }, { rubricSlugs: SLUGS });
  assert.equal(result.ok, true);
  assert.equal(result.article, null);
  assert.equal(result.hours.length, 1);
  const lasting = { ...closed, kind: "trvala", slots: [{ day: "po", from: "9:00", to: "12:00", note: "" }] };
  assert.ok(readDecision({ ...base, hours: [lasting] }, { rubricSlugs: SLUGS }).article);
});

test("Claude vidí místa i lékaře se změnami", () => {
  const text = hoursContext({
    places: [place(2, knihovna, [closure(1, 2, "2026-10-02")])],
    doctors: [{ id: 2, name: "MUDr. Klíma", specialty: "Praktický lékař", week: blankWeek(), changes: [] }],
  });
  assert.match(text, /\[misto:2\] Knihovna \(Městská knihovna\) · Po odpoledne 13:00–17:00/);
  assert.match(text, /změny: 2026-10-02 zavřeno \(školení k volbám\)/);
  assert.match(text, /\[lekar:2\] MUDr. Klíma/);
  assert.match(refLink("doba:7"), /href="\/redakce\/oteviraci-doba"/);
});

test("stránka, titulka a redakce otevírací doby", () => {
  const places = [place(1, knihovna, [closure(4, 1, "2026-10-02", "2026-10-05")])];
  const data = { places, waste: { today: "2026-10-02" }, now: { date: "2026-10-02", time: "10:00" } };
  const page = placesPage(data, { path: "/oteviraci-doba", copy: {} });
  // Zavření je přímo v příštích 7 dnech, zvýrazněné a s důvodem. Běžná doba je v okně pod nimi.
  assert.match(page, /<li class="is-change is-off"><span class="day">Pondělí 5\.&nbsp;10\.<\/span><strong>zavřeno<\/strong><p class="change-note"><span class="change-mark">změna<\/span> školení k volbám<\/p><\/li>/);
  // V pátek má knihovna zavřeno i běžně, změna ho nezvýrazní.
  assert.match(page, /<li class="is-today is-off"><span class="day">Pátek 2\.&nbsp;10\.<span class="today-mark">dnes<\/span><\/span><strong>zavřeno<\/strong><\/li>/);
  assert.match(page, /<li><span class="day">Úterý 6\.&nbsp;10\.<\/span>/);
  assert.match(page, /<button type="button" class="pop-open" popovertarget="bezne-misto-1">Běžná otevírací doba<\/button>/);
  assert.match(page, /<div class="hours-pop" id="bezne-misto-1" popover>/);
  assert.doesNotMatch(page, /Další změny/);
  const home = homePage(
    { ...data, articles: [], events: [], yards: [], doctors: [], waste: { today: "2026-10-02", nextDate: "2026-10-05", daysUntil: 3 } },
    { path: "/", copy: {} },
  );
  assert.match(home, /Pozor, jiná otevírací doba/);
  assert.match(home, /školení k volbám/);
  assert.match(home, /href="\/oteviraci-doba"/);
  const admin = adminPlaces({ path: "/redakce/oteviraci-doba", copy: {} }, { signedIn: true, user: { id: 1, role: "hlavni", name: "R" }, places }, { text: "", kind: "ok" }, { newHoursId: 1 });
  assert.match(admin, /Nová otevírací doba/);
  assert.match(admin, /name="kind" value="trvala"/);
});

test("co tu najdete: řádky, okno na webu, redakce a Drběna v chatu", () => {
  assert.deepEqual(offerLines("- Czech POINT\n\n • Ověřování  podpisů\r\n"), ["Czech POINT", "Ověřování podpisů"]);
  assert.deepEqual(offerLines(""), []);
  const places = [
    { ...place(1, knihovna), offers: ["Půjčování knih", "Kopírování"] },
    { ...place(2, { ...knihovna, name: "Pošta" }), offers: [] },
  ];
  const data = { places, waste: { today: "2026-10-02" }, now: { date: "2026-10-02", time: "10:00" } };
  const page = placesPage(data, { path: "/oteviraci-doba", copy: {} });
  assert.match(page, /popovertarget="nabidka-misto-1">Co tu najdete<\/button>/);
  assert.match(page, /<ul class="offer-list"><li>Půjčování knih<\/li><li>Kopírování<\/li><\/ul>/);
  assert.doesNotMatch(page, /nabidka-misto-2/);
  // Chat: seznam zvlášť, ať ho neořízne délka stránky.
  assert.equal(offerSection(places), "## Co se kde dá najít a vyřídit (u míst z /oteviraci-doba, otevírací dobu najdeš výš)\n- Knihovna (Městská knihovna), /oteviraci-doba#misto-1: Půjčování knih; Kopírování");
  assert.equal(offerSection([places[1]]), "");
  const user = { signedIn: true, user: { id: 2, role: "prispevatel", name: "P", permissions: ["oteviraci_doba"] }, places };
  const admin = adminPlaces({ path: "/redakce/oteviraci-doba", copy: {} }, user, { text: "", kind: "ok" }, { offersId: 1 });
  assert.match(admin, /action="\/redakce\/oteviraci-doba\/nabidka"/);
  assert.match(admin, /Půjčování knih\nKopírování<\/textarea>/);
});
