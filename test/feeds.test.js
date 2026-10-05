import assert from "node:assert/strict";
import test from "node:test";
import { absoluteHtml, atomDate, atomFeed, xmlText } from "../src/feeds/atom.js";
import { eventsCalendar, eventsFeed } from "../src/feeds/events.js";
import { describeChange, hoursFeed } from "../src/feeds/hours.js";
import { hoursJson } from "../src/feeds/hours-json.js";
import { foldLine, icsText } from "../src/feeds/ics.js";
import { newsFeed } from "../src/feeds/news.js";
import { noticesFeed } from "../src/feeds/notices.js";
import { feedsPage, googleCalendarUrl, webcalUrl } from "../src/feeds/page.js";
import { feedResponse } from "../src/feeds/routes.js";
import { blankWeek } from "../src/doctors.js";
import { changeSpec, hoursSpec, placeLd, yardLd } from "../src/hours-ld.js";
import { mergeFresh } from "../src/outages.js";
import { NDIC_CREDIT } from "../src/outages-view.js";
import { layout, placesPage } from "../src/view.js";
import { FEED_SWITCHES, anyFeedOn, feedOn, mapFeedSettings } from "../src/feeds/settings.js";

const BASE = "https://drbna.test";

function week(days, morning = ["08:00", "12:00"], afternoon = null) {
  return blankWeek().map((slot) =>
    days.includes(slot.day)
      ? {
          day: slot.day,
          morning: { open: true, from: morning[0], to: morning[1], note: "" },
          afternoon: afternoon ? { open: true, from: afternoon[0], to: afternoon[1], note: "" } : slot.afternoon,
        }
      : slot,
  );
}

const article = {
  id: 7,
  slug: "nova-lavicka",
  title: "Nová lavička & stůl",
  excerpt: "U rybníka <přibyla> lavička.",
  body: `<div>Viz <a href="/akce">akce</a> a <a href="https://kopidlno.cz/x">web</a>.</div>`,
  category: "Fotbal",
  rubricSlug: "fotbal",
  parentName: "Sport",
  parentSlug: "sport",
  imageKey: "zpravy/lavicka.webp",
  imageCaption: "Ilustrační foto",
  attachments: [{ key: "prilohy/rad.webp", caption: "Jízdní řád" }],
  createdOn: "2026-10-05",
  authorName: "Jan Novák",
  authorAlias: "Koza Drběna",
};

test("Atom: data jako RFC 3339, řídicí znaky pryč, relativní odkazy na celou adresu", () => {
  assert.equal(atomDate("2026-10-05"), "2026-10-05T00:00:00+02:00");
  assert.equal(atomDate("2026-12-05"), "2026-12-05T00:00:00+01:00");
  assert.equal(atomDate("2026-10-05 14:03:09"), "2026-10-05T14:03:09Z");
  assert.equal(atomDate("2026-10-05T14:03:09.123Z"), "2026-10-05T14:03:09Z");
  assert.equal(xmlText("a\u0001<b>&"), "a&lt;b&gt;&amp;");
  assert.equal(
    absoluteHtml(`<a href="/x">x</a><img src="/media/a.webp"><a href="//cizi.cz">c</a>`, BASE),
    `<a href="${BASE}/x">x</a><img src="${BASE}/media/a.webp"><a href="//cizi.cz">c</a>`,
  );
  const xml = atomFeed({
    id: "tag:x",
    title: "T",
    self: `${BASE}/feed.xml`,
    alternate: BASE,
    author: "Drbna",
    entries: [
      { id: "a", title: "Starší", url: `${BASE}/a`, updated: "2026-10-01" },
      { id: "b", title: "Novější", url: `${BASE}/b`, updated: "2026-10-03" },
    ],
  });
  assert.ok(xml.indexOf("Novější") < xml.indexOf("Starší"));
  assert.match(xml, /<updated>2026-10-03T00:00:00\+02:00<\/updated>/);
  // Prázdný feed má pevné datum (ETag se nemění).
  assert.match(atomFeed({ id: "x", title: "T", self: "s", alternate: "a", author: "A", entries: [] }), /<updated>2026-01-01T00:00:00Z<\/updated>/);
});

test("feed zpráv nese celý text s fotkou, přílohami, podpisem a rubrikou", () => {
  const xml = newsFeed(BASE, [article], {});
  assert.match(xml, /<id>tag:kopidlenskadrbna.org,2026:zprava-7<\/id>/);
  assert.match(xml, /<title>Nová lavička &amp; stůl<\/title>/);
  assert.match(xml, /<link rel="alternate" type="text\/html" href="https:\/\/drbna.test\/zpravy\/nova-lavicka"\/>/);
  assert.match(xml, /<author><name>Koza Drběna<\/name><\/author>/);
  assert.match(xml, /<category term="sport" label="Sport"\/>/);
  assert.match(xml, /<category term="fotbal" label="Fotbal"\/>/);
  assert.match(xml, /<link rel="enclosure" type="image\/webp" href="https:\/\/drbna.test\/media\/zpravy\/lavicka.webp"\/>/);
  assert.match(xml, /<summary>U rybníka &lt;přibyla&gt; lavička.<\/summary>/);
  // Obsah je escapované HTML s celými adresami.
  assert.match(xml, /&lt;a href=&quot;https:\/\/drbna.test\/akce&quot;/);
  assert.match(xml, /https:\/\/drbna.test\/media\/prilohy\/rad.webp/);
  assert.equal(xml.includes("<div>"), false);
  const rubric = newsFeed(BASE, [], {}, { rubric: { id: 2, parentId: 1, name: "Fotbal", slug: "fotbal" }, rubrics: [{ id: 1, parentId: null, name: "Sport", slug: "sport" }] });
  assert.match(rubric, /<title>Kopidlenská drbna: Sport · Fotbal<\/title>/);
  assert.match(rubric, /href="https:\/\/drbna.test\/feed.xml\?rubrika=fotbal"/);
});

const events = [
  { id: 1, title: "Posvícení, trhy; a víc", place: "Náměstí", startsOn: "2026-10-10", startsTime: "14:00", description: "Řádek\ndruhý", published: true, link: "", articleSlug: "posviceni", createdAt: "2026-10-01 08:00:00" },
  { id: 2, title: "Lampionový průvod", place: "Zámek", startsOn: "2026-11-11", startsTime: "", description: "", published: true, link: "https://kvc.cz/?utm_source=fb", articleSlug: "", createdAt: "2026-10-04 09:30:00" },
  { id: 3, title: "Loňská akce", place: "Sokolovna", startsOn: "2026-09-01", startsTime: "", description: "", published: true, link: "", articleSlug: "", createdAt: "2026-08-01 09:00:00" },
  { id: 4, title: "Skrytá", place: "Sokolovna", startsOn: "2026-12-01", startsTime: "", description: "", published: false, link: "", articleSlug: "", createdAt: "2026-10-04 09:00:00" },
];

test("feed nových akcí: jen zveřejněné a nadcházející, od naposledy přidané", () => {
  const xml = eventsFeed(BASE, events, {}, "2026-10-05");
  assert.ok(xml.indexOf("Lampionový") < xml.indexOf("Posvícení"));
  assert.equal(xml.includes("Loňská"), false);
  assert.equal(xml.includes("Skrytá"), false);
  assert.match(xml, /<updated>2026-10-04T09:30:00Z<\/updated>/);
  assert.match(xml, /href="https:\/\/drbna.test\/zpravy\/posviceni"/);
  assert.match(xml, /href="https:\/\/drbna.test\/akce#akce-2"/);
  assert.equal(xml.includes("utm_source"), false);
});

test("kalendář akcí: UTC čas, celodenní akce, escapování a řádky do 75 bajtů", () => {
  const ics = eventsCalendar(BASE, events, {}, "2026-10-05");
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  // 14:00 v Praze v říjnu je 12:00 UTC.
  assert.match(ics, /DTSTART:20261010T120000Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261111\r\nDTEND;VALUE=DATE:20261112/);
  assert.match(ics, /SUMMARY:Posvícení\\, trhy\\; a víc/);
  assert.match(ics, /DESCRIPTION:Řádek\\ndruhý/);
  assert.match(ics, /DTSTAMP:20261001T080000Z/);
  assert.match(ics, /UID:akce-1@kopidlenskadrbna.org/);
  assert.match(ics, /Loňská akce/);
  assert.equal(ics.includes("Skrytá"), false);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const long = foldLine(`DESCRIPTION:${"ž".repeat(60)}`);
  assert.equal(long.split("\r\n ").join(""), `DESCRIPTION:${"ž".repeat(60)}`);
  assert.equal(icsText("a\\b"), "a\\\\b");
});

test("změny otevírací doby: zavřeno, jiné hodiny, nová doba a uzavření dvora", () => {
  const closed = { section: "misto", id: 1, ownerId: 3, kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-16", note: "Inventura", week: blankWeek(), createdAt: "2026-10-01", name: "Knihovna", detail: "Městská knihovna" };
  assert.deepEqual(describeChange(closed), { title: "Knihovna: zavřeno 12. 10. 2026 – 16. 10. 2026", lines: ["", "Inventura"] });
  const other = { ...closed, section: "lekar", startsOn: "2026-10-12", endsOn: "2026-10-12", week: week([1]), name: "MUDr. Nová" };
  assert.equal(describeChange(other).title, "MUDr. Nová: jiné ordinační hodiny 12. 10. 2026");
  assert.match(describeChange(other).lines[0], /Po dopoledne 08:00–12:00/);
  const fresh = { ...closed, kind: "trvala", endsOn: "2026-10-12", week: week([1, 2]) };
  assert.equal(describeChange(fresh).title, "Knihovna: nová otevírací doba od 12. 10. 2026");
  const yard = { section: "dvur", id: 2, ownerId: 1, startsOn: "2026-10-20", endsOn: "2026-10-20", note: "Svátek", createdAt: "2026-10-02", name: "Sběrný dvůr" };
  assert.equal(describeChange(yard).title, "Sběrný dvůr: zavřeno 20. 10. 2026");
  const xml = hoursFeed(BASE, [closed, yard], {});
  assert.ok(xml.indexOf("Sběrný dvůr") < xml.indexOf("Knihovna: zavřeno"));
  assert.match(xml, /href="https:\/\/drbna.test\/oteviraci-doba#misto-3"/);
  assert.match(xml, /href="https:\/\/drbna.test\/sberne-dvory#dvur-1"/);
});

test("feed odstávek: věta o NDIC jen u uzavírek beze změny", () => {
  const notice = (id, source) => ({ id, kind: "uzavirka", title: `Uzavírka ${id}`, when: "Pondělí 12. října", placeLabels: ["Husova"], morePlaces: 0, note: "", sourceUrl: "", source, addedAt: "2026-10-01 10:00:00" });
  const xml = noticesFeed(BASE, { notices: [notice("ndic-1", "ndic"), notice("ndic-2", "ndic-prepis"), notice(5, undefined)], power: { fetchedAt: "2026-10-05T06:00:00Z", items: [{ id: "c1", areaName: "Kopidlno", when: "Úterý 13. října, 7:30–14:00", placeLabels: [], seenAt: "2026-10-03T06:00:00Z" }] } }, {});
  const entries = xml.split("<entry>").slice(1);
  const of = (id) => entries.find((entry) => entry.includes(`oznameni-${id}<`));
  assert.ok(of("ndic-1").includes(NDIC_CREDIT));
  assert.equal(of("ndic-2").includes("NDIC"), false);
  assert.equal(of(5).includes("NDIC"), false);
  assert.match(xml, /Nepůjde proud: Kopidlno/);
  assert.match(xml, /<updated>2026-10-03T06:00:00Z<\/updated>/);
});

test("odstávka elektřiny si pamatuje, kdy ji drbna uviděla poprvé", () => {
  const earlier = new Date("2026-10-01T06:00:00Z");
  const later = new Date("2026-10-02T06:00:00Z");
  const first = mergeFresh([], [{ ok: true, code: "573060", outages: [{ id: "a", areaCode: "573060" }] }], earlier);
  const second = mergeFresh(first, [{ ok: true, code: "573060", outages: [{ id: "a", areaCode: "573060" }, { id: "b", areaCode: "573060" }] }], later);
  assert.equal(second.find((item) => item.id === "a").seenAt, earlier.toISOString());
  assert.equal(second.find((item) => item.id === "b").seenAt, later.toISOString());
});

test("otevírací doba pro vyhledávače: dny se stejnými hodinami dohromady, změny a nová doba", () => {
  const spec = hoursSpec(week([1, 3], ["08:00", "12:00"], ["13:00", "17:00"]));
  assert.deepEqual(spec[0], { "@type": "OpeningHoursSpecification", dayOfWeek: ["https://schema.org/Monday", "https://schema.org/Wednesday"], opens: "08:00", closes: "12:00" });
  assert.equal(spec[1].opens, "13:00");
  assert.deepEqual(changeSpec({ startsOn: "2026-10-12", endsOn: "2026-10-16", week: blankWeek() }), [
    { "@type": "OpeningHoursSpecification", opens: "00:00", closes: "00:00", validFrom: "2026-10-12", validThrough: "2026-10-16" },
  ]);
  // Jen pondělí otevřeno, úterý v období zavřeno.
  const partial = changeSpec({ startsOn: "2026-10-12", endsOn: "2026-10-13", week: week([1], ["09:00", "11:00"]) });
  assert.equal(partial.length, 2);
  assert.equal(partial[0].dayOfWeek, "https://schema.org/Monday");
  assert.equal(partial[1].dayOfWeek, "https://schema.org/Tuesday");
  assert.equal(partial[1].closes, "00:00");
  const place = {
    id: 3,
    name: "Knihovna",
    label: "Městská knihovna",
    place: "Hilmarova 86, Kopidlno",
    phone: "724 773 142",
    week: week([1]),
    changes: [{ kind: "trvala", startsOn: "2026-11-01", endsOn: "2026-11-01", week: week([2]) }],
  };
  const ld = placeLd(BASE, place, "2026-10-05");
  assert.equal(ld["@type"], "CivicStructure");
  assert.equal(ld.telephone, "+420724773142");
  assert.deepEqual(ld.address, { "@type": "PostalAddress", streetAddress: "Hilmarova 86", addressLocality: "Kopidlno", addressCountry: "CZ" });
  assert.equal(ld.openingHoursSpecification[0].validThrough, "2026-10-31");
  assert.equal(ld.openingHoursSpecification[1].validFrom, "2026-11-01");
  assert.equal(ld.specialOpeningHoursSpecification, undefined);
  const yard = yardLd(BASE, { id: 1, name: "Dvůr", place: "Kopidlno", accepts: "Železo", week: [{ day: 6, open: true, from: "08:00", to: "12:00" }], legacy: "", closures: [{ startsOn: "2026-10-28", endsOn: "2026-10-28" }] });
  assert.equal(yard.address.streetAddress, undefined);
  assert.equal(yard.openingHoursSpecification[0].dayOfWeek, "https://schema.org/Saturday");
  assert.equal(yard.specialOpeningHoursSpecification[0].validFrom, "2026-10-28");
});

test("otevírací doba jako data: týden od pondělí a změny", () => {
  const data = hoursJson(BASE, {
    places: [{ id: 3, name: "Knihovna", label: "", place: "KVC", phone: "", week: week([1]), offers: [], changes: [{ kind: "docasna", startsOn: "2026-10-12", endsOn: "2026-10-12", note: "Školení", week: blankWeek() }] }],
    doctors: [],
    yards: [{ id: 1, name: "Dvůr", place: "Kopidlno", accepts: "", week: [], legacy: "Po 8–12", closures: [] }],
  });
  assert.equal(data.places[0].week[0].day, "monday");
  assert.deepEqual(data.places[0].week[0].hours, [{ from: "08:00", to: "12:00" }]);
  assert.deepEqual(data.places[0].week[6], { day: "sunday", hours: [] });
  assert.deepEqual(data.places[0].changes[0], { kind: "closed", starts_on: "2026-10-12", ends_on: "2026-10-12", note: "Školení" });
  assert.equal(data.yards[0].hours_text, "Po 8–12");
});

test("feed se stejnou verzí vrátí 304", async () => {
  const first = await feedResponse(new Request(`${BASE}/feed.xml`), "<feed/>", "application/atom+xml");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-type"), "application/atom+xml; charset=utf-8");
  const etag = first.headers.get("etag");
  const again = await feedResponse(new Request(`${BASE}/feed.xml`, { headers: { "if-none-match": `W/${etag}` } }), "<feed/>", "application/atom+xml");
  assert.equal(again.status, 304);
  const changed = await feedResponse(new Request(`${BASE}/feed.xml`, { headers: { "if-none-match": etag } }), "<feed>x</feed>", "application/atom+xml");
  assert.equal(changed.status, 200);
});

test("stránky nesou odkaz na feed a stránka odběru nabízí kalendář i rubriky", () => {
  const ctx = { path: "/zpravy", copy: {}, origin: BASE, mainOrigin: BASE };
  const page = layout({ ...ctx, title: "T", description: "D", body: "", feeds: [["/akce/feed.xml", "Nové akce"]] });
  assert.match(page, /<link rel="alternate" type="application\/atom\+xml" title="Kopidlenská drbna: Nové akce" href="https:\/\/drbna.test\/akce\/feed.xml">/);
  assert.match(page, /title="Kopidlenská drbna: Zprávy" href="https:\/\/drbna.test\/feed.xml"/);
  assert.match(page, /<a href="\/odber">/);
  assert.equal(webcalUrl(BASE, "/akce.ics"), "webcal://drbna.test/akce.ics");
  assert.equal(googleCalendarUrl(BASE, "/akce.ics"), "https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fdrbna.test%2Fakce.ics");
  const rubrics = [
    { id: 1, parentId: null, name: "Sport", slug: "sport", articleCount: 0 },
    { id: 2, parentId: 1, name: "Fotbal", slug: "fotbal", articleCount: 3 },
    { id: 3, parentId: null, name: "Prázdná", slug: "prazdna", articleCount: 0 },
  ];
  const odber = feedsPage(rubrics, { ...ctx, path: "/odber" });
  assert.match(odber, /href="\/feed.xml\?rubrika=sport">Sport</);
  assert.match(odber, /href="\/feed.xml\?rubrika=fotbal">Sport › Fotbal</);
  assert.equal(odber.includes("prazdna"), false);
  assert.match(odber, /webcal:\/\/drbna.test\/akce.ics/);
});

test("vypnutý feed zmizí z hlavičky, patičky i ze stránky odběru", () => {
  assert.deepEqual(Object.values(mapFeedSettings(null)), FEED_SWITCHES.map(() => true));
  const on = { ...mapFeedSettings(null), news: false, rubrics: false, calendar: false };
  assert.equal(feedOn(on, "/feed.xml"), false);
  assert.equal(feedOn(on, "/feed.xml?rubrika=sport"), false);
  assert.equal(feedOn(on, "/akce/feed.xml"), true);
  assert.equal(feedOn(null, "/feed.xml"), true);
  const ctx = { path: "/zpravy", copy: {}, origin: BASE, mainOrigin: BASE, feedOn: on };
  const page = layout({ ...ctx, title: "T", description: "D", body: "", feeds: [["/feed.xml?rubrika=sport", "Sport"], ["/akce/feed.xml", "Nové akce"]] });
  assert.equal(page.includes(`${BASE}/feed.xml`), false);
  assert.match(page, /akce\/feed.xml/);
  assert.match(page, /href="\/odber"/);
  const odber = feedsPage([{ id: 1, parentId: null, name: "Sport", slug: "sport", articleCount: 2 }], { ...ctx, path: "/odber" });
  assert.equal(odber.includes("webcal:"), false);
  assert.equal(odber.includes("rubrika=sport"), false);
  assert.equal(odber.includes("Všechny zprávy"), false);
  assert.match(odber, /Nové akce/);
  const none = Object.fromEntries(FEED_SWITCHES.map((item) => [item.key, false]));
  assert.equal(anyFeedOn(none), false);
  assert.equal(layout({ ...ctx, feedOn: none, title: "T", description: "D", body: "" }).includes('href="/odber"'), false);
  // Otevírací doba pro vyhledávače jde vypnout zvlášť.
  const places = { places: [{ id: 1, name: "Úřad", label: "", place: "Kopidlno", phone: "", week: week([1]), changes: [], offers: [] }], waste: { today: "2026-10-05" } };
  assert.match(placesPage(places, { ...ctx, path: "/oteviraci-doba", feedOn: null }), /CivicStructure/);
  assert.equal(placesPage(places, { ...ctx, path: "/oteviraci-doba", feedOn: { ...none } }).includes("CivicStructure"), false);
});
