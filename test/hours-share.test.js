import assert from "node:assert/strict";
import test from "node:test";
import { blankWeek, DOCTOR_SEEDS } from "../src/doctors.js";
import { PLACE_SEEDS } from "../src/places.js";
import { shareInfo, sharePath } from "../src/hours-share.js";
import { doctorsPage, placesPage, yardsPage } from "../src/view.js";
import { adminPlaces } from "../src/admin/index.js";

const knihovna = { id: 6, ...PLACE_SEEDS.find((seed) => seed.name === "Knihovna"), changes: [] };
const closed = { ...knihovna, changes: [{ id: 1, placeId: 6, kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-12", note: "školení", week: blankWeek() }] };
const ctx = { path: "/oteviraci-doba", copy: {}, origin: "https://www.kopidlenskadrbna.org" };
const page = (place, query) => placesPage({ places: [place], waste: { today: "2026-10-05" } }, ctx, new URLSearchParams(query));

test("náhled místa říká, co se mění, a bez změny běžnou dobu", () => {
  assert.deepEqual(shareInfo("misto", closed, "2026-10-05"), {
    title: "Knihovna: otevírací doba",
    description: "Knihovna má 12. 10. zavřeno. Školení.",
    image: "/og-hodiny-zavreno.webp",
  });
  const regular = shareInfo("misto", knihovna, "2026-10-05");
  assert.equal(regular.image, "");
  assert.equal(regular.description, "Městská knihovna. Otevírací doba: Po 13–17; Út 9–12, 13–17; Čt 9–12, 13–17.");
  const office = { id: 1, ...PLACE_SEEDS[0], changes: [] };
  assert.equal(shareInfo("misto", office, "2026-10-05").description, "Úřední hodiny. Otevírací doba: Po 8–12, 13–17; Út 8–12, 13–15; St 8–12, 13–17; Čt 8–12, 13–15; Pá 8–12.");
  const kvc = { id: 3, ...PLACE_SEEDS[2], changes: [] };
  assert.equal(shareInfo("misto", kvc, "2026-10-05").description, "KVC. Otevírací doba: Po–Čt 9–12, 13–17; Pá 9–12.");
});

test("adresa ke sdílení se mění jen se změnou textu", () => {
  const before = sharePath("misto", closed, "2026-10-05");
  assert.match(before, /^\/oteviraci-doba\?misto=6&v=[0-9a-z]+#misto-6$/);
  assert.equal(sharePath("misto", closed, "2026-10-06"), before);
  assert.notEqual(sharePath("misto", closed, "2026-10-13"), before);
});

test("stránka s ?misto= má vlastní náhled, canonical zůstává", () => {
  const html = page(closed, "misto=6");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.kopidlenskadrbna\.org\/oteviraci-doba">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.kopidlenskadrbna\.org\/oteviraci-doba\?misto=6&amp;v=[0-9a-z]+">/);
  assert.match(html, /<meta property="og:description" content="Knihovna má 12\. 10\. zavřeno\. Školení\.">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.kopidlenskadrbna\.org\/og-hodiny-zavreno\.webp">/);
  assert.match(html, /<meta property="og:image:width" content="1200">/);
  assert.match(html, /<title>Knihovna: otevírací doba \| /);
  // Neznámé číslo nic nerozbije, stránka je obecná.
  const plain = page(closed, "misto=999");
  assert.match(plain, /<meta property="og:url" content="https:\/\/www\.kopidlenskadrbna\.org\/oteviraci-doba">/);
  assert.match(plain, /og\.webp/);
});

test("lékaři a sběrné dvory mají náhled taky", () => {
  const doctor = { id: 2, ...DOCTOR_SEEDS[0], changes: [{ id: 3, kind: "docasna", startsOn: "2026-10-07", endsOn: "2026-10-09", note: "dovolená", week: blankWeek() }] };
  const doctors = doctorsPage({ doctors: [doctor], waste: { today: "2026-10-05" } }, { ...ctx, path: "/lekari" }, new URLSearchParams("lekar=2"));
  assert.match(doctors, /og:description" content="Ordinace Kopidlno má od 7\. 10\. do 9\. 10\. zavřeno\. Dovolená\."/);
  const yard = { id: 1, name: "Sběrný dvůr", place: "Kopidlno", accepts: "", week: [], legacy: "", closures: [{ id: 1, startsOn: "2026-10-10", endsOn: "2026-10-10", reason: "inventura" }] };
  const yards = yardsPage({ yards: [yard], waste: { today: "2026-10-05" } }, { ...ctx, path: "/sberne-dvory" }, new URLSearchParams("dvur=1"));
  assert.match(yards, /og:description" content="Sběrný dvůr má 10\. 10\. zavřeno\. Inventura\."/);
});

test("redakce má u místa tlačítko a okno Sdílet", () => {
  const data = { signedIn: true, user: { id: 1, role: "hlavni", name: "R" }, places: [{ ...closed, published: 1 }] };
  const list = adminPlaces({ path: "/redakce/oteviraci-doba", copy: {}, mainOrigin: "https://www.kopidlenskadrbna.org" }, data, { text: "", kind: "ok" }, { shareId: 6 });
  assert.match(list, /href="\/redakce\/oteviraci-doba\?sdilet=6" data-modal>Sdílet</);
  assert.match(list, /value="https:\/\/www\.kopidlenskadrbna\.org\/oteviraci-doba\?misto=6&amp;v=[0-9a-z]+#misto-6"/);
  assert.match(list, /data-share-field="sdilet-odkaz"/);
});
