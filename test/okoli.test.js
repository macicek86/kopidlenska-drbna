import assert from "node:assert/strict";
import test from "node:test";
import { adminOkoli } from "../src/admin/index.js";
import { fetchKzmj, parseEventPage, parseKzmjPost } from "../src/okoli/kzmj.js";
import { mapNearbyEvent } from "../src/okoli/store.js";
import { easterSunday, holidayName, outingDue, outingFor, outingsFrom, periodBetween, plannedOutings } from "../src/okoli/outings.js";
import { kopidlnoLink, readWeekend, weekendSchema, weekendSource, weekendText } from "../src/okoli/weekend.js";

const weekendFor = outingFor;

// Výřez skutečné stránky akce na kzmj.cz (tlačítko „do kalendáře“).
const PAGE = `<div class="detail-info-col">19.12.2026 - 16:00 (sobota) <add-to-calendar-button
  name="Čertí hlouposti"
  startDate="2026-12-19"
  startTime="16:00"
  endTime="16:45"
  timeZone="Europe/Prague"
  location="Loutkové divadlo Srdíčko"
  inline
></add-to-calendar-button></div>`;

const post = (id, extra = {}) => ({
  id,
  date: "2026-10-06T10:36:47",
  modified_gmt: "2026-10-06T08:36:48",
  link: `https://kzmj.cz/sekce-divadlo/akce-${id}/`,
  title: { rendered: "Partneři &#8211; PREMIÉRA!" },
  content: { rendered: "<p>Komedie o&nbsp;dvou párech.</p>" },
  meta_box: { vyprodano: "0" },
  ...extra,
});

test("stránka akce KZMJ: termín a místo z tlačítka do kalendáře", () => {
  assert.deepEqual(parseEventPage(PAGE), { startsOn: "2026-12-19", startsTime: "16:00", endsTime: "16:45", place: "Loutkové divadlo Srdíčko" });
  assert.equal(parseEventPage("<p>nic</p>"), null);
});

test("akce KZMJ: biograf má termín v date, divadlo ze stránky", () => {
  const film = parseKzmjPost(post(5, { date: "2026-10-17T21:30:00", title: { rendered: "Hnízdo" } }), { type: "biograf_akce", kind: "kino", page: false, place: "Biograf Český ráj" });
  assert.equal(film.startsOn, "2026-10-17");
  assert.equal(film.startsTime, "21:30");
  assert.equal(film.place, "Biograf Český ráj");
  const spec = { type: "divadlo_akce", kind: "divadlo", page: true };
  assert.equal(parseKzmjPost(post(6), spec, null), null);
  const play = parseKzmjPost(post(6), spec, parseEventPage(PAGE));
  assert.equal(play.title, "Partneři – PREMIÉRA!");
  assert.equal(play.description, "Komedie o dvou párech.");
  assert.equal(play.guid, "kzmj:divadlo_akce:6");
  assert.equal(play.startsOn, "2026-12-19");
  assert.equal(parseKzmjPost(post(7, { title: { rendered: "Techtle Mechtle | VYPRODÁNO!" } }), spec, parseEventPage(PAGE)).soldOut, true);
  // Odkaz jinam než na kzmj.cz se nebere.
  assert.equal(parseKzmjPost(post(8, { link: "https://example.com/x" }), spec, parseEventPage(PAGE)), null);
});

function fakeFetch(calls) {
  return async (url) => {
    calls.push(String(url));
    const json = (body) => new Response(JSON.stringify(body), { headers: { "x-wp-totalpages": "1" } });
    if (url.includes("divadlo_akce")) return json([post(1), post(2)]);
    if (url.includes("nefilmove_akce")) return json([]);
    if (url.includes("biograf_akce")) return json([post(3, { date: "2026-10-17T19:30:00" })]);
    if (url.includes("/sekce-divadlo/")) return new Response(PAGE);
    return new Response("", { status: 404 });
  };
}

test("KZMJ: stránku akce stahuje jen u nové nebo změněné akce", async () => {
  const calls = [];
  const known = new Map([["kzmj:divadlo_akce:1", "2026-10-06T08:36:48"]]);
  const feed = await fetchKzmj({ fetchImpl: fakeFetch(calls), known });
  assert.equal(feed.ok, true);
  assert.equal(feed.complete, true);
  assert.deepEqual(feed.listed, ["kzmj:divadlo_akce:1", "kzmj:divadlo_akce:2", "kzmj:biograf_akce:3"]);
  assert.deepEqual(feed.items[0], { guid: "kzmj:divadlo_akce:1", stamp: "2026-10-06T08:36:48", unchanged: true });
  assert.equal(feed.items[1].startsOn, "2026-12-19");
  assert.equal(calls.filter((url) => url.includes("/sekce-divadlo/")).length, 1);
  assert.ok(calls.every((url) => !url.includes("repriza")));
});

test("svátky: pevné i velikonoční", () => {
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(holidayName("2026-04-03"), "Velký pátek");
  assert.equal(holidayName("2026-04-06"), "Velikonoční pondělí");
  assert.equal(holidayName("2026-10-28"), "Den vzniku samostatného československého státu");
  assert.equal(holidayName("2026-10-27"), "");
});

test("období: víkend, volno se svátkem a samostatný svátek", () => {
  const brief = (period) => [period.kind, period.from, period.to, period.write];
  // Běžný víkend: od pátku, píše se v pátek.
  assert.deepEqual(brief(outingFor("2026-10-07")), ["vikend", "2026-10-09", "2026-10-11", "2026-10-09"]);
  assert.deepEqual(brief(outingFor("2026-10-10")), ["vikend", "2026-10-10", "2026-10-11", "2026-10-09"]);
  assert.equal(outingFor("2026-10-10").key, "2026-10-09");
  // Středa 28. 10.: krátký článek v úterý, pak běžný víkend.
  const october = outingsFrom("2026-10-26").filter((period) => period.to >= "2026-10-26").map(brief);
  assert.deepEqual(october.slice(0, 2), [["svatek", "2026-10-28", "2026-10-28", "2026-10-27"], ["vikend", "2026-10-30", "2026-11-01", "2026-10-30"]]);
  // Velikonoce 2026: Velký pátek až pondělí, píše se ve čtvrtek.
  assert.deepEqual(brief(outingFor("2026-03-31")), ["volno", "2026-04-03", "2026-04-06", "2026-04-02"]);
  // Vánoce 2026: čtvrtek 24. 12. až neděle, píše se ve středu; Nový rok v pátek, píše se ve čtvrtek 31. 12.
  const winter = outingsFrom("2026-12-21").filter((period) => period.to >= "2026-12-21").map(brief);
  assert.deepEqual(winter.slice(0, 2), [["volno", "2026-12-24", "2026-12-27", "2026-12-23"], ["volno", "2027-01-01", "2027-01-03", "2026-12-31"]]);
  // Pondělní svátek prodlouží víkend, píše se dál v pátek (5. a 6. 7. 2027 je pondělí a úterý).
  assert.deepEqual(brief(outingFor("2027-06-30")), ["volno", "2027-07-02", "2027-07-06", "2027-07-02"]);
  assert.deepEqual(outingFor("2027-06-30").holidays.map((holiday) => holiday.day), ["2027-07-05", "2027-07-06"]);
});

test("článek Kam vyrazit: cron ho píše v den období, ráno a jednou", () => {
  const on = { weekly: true, autoVolno: true, autoSvatek: true, weekendOn: "" };
  assert.equal(outingDue(on, { date: "2026-10-08", time: "10:15" }), null);
  assert.equal(outingDue(on, { date: "2026-10-09", time: "02:15" }), null);
  assert.equal(outingDue(on, { date: "2026-10-09", time: "06:15" }).key, "2026-10-09");
  assert.equal(outingDue(on, { date: "2026-10-09", time: "18:15" }), null);
  assert.equal(outingDue({ ...on, weekendOn: "2026-10-09" }, { date: "2026-10-09", time: "10:15" }), null);
  assert.equal(outingDue({ ...on, weekly: false }, { date: "2026-10-09", time: "10:15" }), null);
  // Úterý před svátkem 28. 10. i čtvrtek před Velkým pátkem.
  assert.equal(outingDue(on, { date: "2026-10-27", time: "06:15" }).kind, "svatek");
  assert.equal(outingDue(on, { date: "2026-04-02", time: "06:15" }).from, "2026-04-03");
  assert.equal(outingDue(on, { date: "2026-04-03", time: "06:15" }), null);
  // Přepínače: bez samostatných svátků nic v úterý, bez volna jsou Velikonoce obyčejný víkend od pátku.
  assert.equal(outingDue({ ...on, autoSvatek: false }, { date: "2026-10-27", time: "06:15" }), null);
  assert.equal(outingDue({ ...on, autoVolno: false }, { date: "2026-04-02", time: "06:15" }), null);
  const easter = outingDue({ ...on, autoVolno: false }, { date: "2026-04-03", time: "06:15" });
  assert.deepEqual([easter.kind, easter.from, easter.to, easter.holidays.map((holiday) => holiday.name)], ["vikend", "2026-04-03", "2026-04-05", ["Velký pátek"]]);
  // Bez víkendů zůstanou jen svátky a volna.
  assert.deepEqual(plannedOutings({ ...on, weekly: false }, "2026-10-26").map((period) => period.kind), ["svatek"]);
});

test("ruční článek od–do: svátky najde sám a plánovaný nezablokuje", () => {
  const holiday = periodBetween("2026-10-28", "2026-10-28", "2026-10-20");
  assert.deepEqual([holiday.kind, holiday.manual, holiday.holidays[0].name], ["svatek", true, "Den vzniku samostatného československého státu"]);
  assert.equal(periodBetween("2026-10-10", "2026-10-11", "2026-10-07").kind, "vikend");
  assert.equal(periodBetween("2026-10-13", "2026-10-15", "2026-10-07").kind, "dny");
  assert.equal(periodBetween("2026-10-27", "2026-10-28", "2026-10-20").kind, "dny");
  assert.equal(periodBetween("2026-04-03", "2026-04-06", "2026-03-30").kind, "volno");
  assert.match(periodBetween("2026-10-05", "2026-10-06", "2026-10-07").error, /ještě nebyly/);
  assert.match(periodBetween("2026-10-12", "2026-10-10", "2026-10-07").error, /pozdější/);
  assert.match(periodBetween("2026-10-08", "2026-10-30", "2026-10-07").error, /14 dní/);
  assert.match(periodBetween("", "2026-10-10", "2026-10-07").error, /Vyberte/);
  const text = weekendText({ today: "2026-10-07", weekend: periodBetween("2026-10-13", "2026-10-15", "2026-10-07"), home: [], nearby: [], radiusKm: 25, topics: [] });
  assert.match(text, /dny, které vybrala redakce: úterý 13\. 10\. až čtvrtek 15\. 10\. 2026\./);
});

test("podklady na svátek: Drběna ví, jaký je", () => {
  const holiday = outingFor("2026-10-27");
  const text = weekendText({ today: "2026-10-27", weekend: holiday, home: [], nearby: [], radiusKm: 25, topics: [] });
  assert.match(text, /samostatný svátek uprostřed týdne: středa 28\. 10\. 2026\. Svátek: Den vzniku samostatného československého státu/);
  const easter = weekendText({ today: "2026-04-02", weekend: outingFor("2026-04-02"), home: [], nearby: [], radiusKm: 25, topics: [] });
  assert.match(easter, /volno se svátkem: pátek 3\. 4\. až pondělí 6\. 4\. 2026\. Svátky: Velký pátek \(pátek 3\. 4\.\), Velikonoční pondělí/);
});

const nearby = mapNearbyEvent({
  id: 4, source: "kzmj", title: "Vlasta Redl s kapelou", place: "Masarykovo divadlo", town: "Jičín", km: 13, kind: "divadlo",
  starts_on: "2026-10-10", starts_time: "19:30", description: "Koncert.", link: "https://kzmj.cz/sekce-divadlo/vlasta-redl/", sold_out: 0, hidden: 0,
});

test("podklady pro víkendový článek: Kopidlno napřed, odkazy na drbnu i pořadatele", () => {
  const home = [{ id: 7, title: "Drakiáda", place: "Hřiště", startsOn: "2026-10-10", startsTime: "14:00", description: "", articleSlug: "" }];
  const text = weekendText({ today: "2026-10-09", weekend: weekendFor("2026-10-09"), home, nearby: [nearby], radiusKm: 25, topics: [] });
  assert.match(text, /Dnes je pátek 9\. 10\. 2026/);
  assert.match(text, /- sobota 10\. 10\. v 14:00, Hřiště: Drakiáda\. Odkaz: \/akce#akce-7/);
  assert.match(text, /Jičín \(13 km\), divadlo, Masarykovo divadlo: Vlasta Redl s kapelou\. Koncert\. Odkaz: https:\/\/kzmj\.cz/);
  assert.ok(text.indexOf("Drakiáda") < text.indexOf("Vlasta Redl"));
  assert.equal(kopidlnoLink({ id: 7, articleSlug: "drakiada" }), "/zpravy/drakiada");
  assert.match(weekendSource([nearby]), /href="https:\/\/kzmj\.cz\/"[^>]*>KZMJ Jičín</);
  assert.equal(weekendSource([]), "");
});

test("odpověď Claude: článek, nebo nic", () => {
  assert.deepEqual(weekendSchema(["kultura"]).properties.image_topic.enum, ["kultura", ""]);
  assert.deepEqual(readWeekend({ write: false, reason: "Nic se nekoná." }), { ok: true, write: false, reason: "Nic se nekoná." });
  const written = readWeekend({
    write: true, reason: "Vybrala jsem koncert.", title: "Drakiáda doma, Redl v Jičíně", excerpt: "Víkend s draky i kytarou.",
    body_html: '<h3>V Kopidlně</h3><p>V sobotu ve 14:00 <a href="/akce#akce-7">Drakiáda</a> na hřišti.</p><script>x</script>', image_topic: "kultura",
  });
  assert.equal(written.ok, true);
  assert.ok(!written.article.body.includes("<script"));
  assert.match(written.article.body, /href="\/akce#akce-7"/);
  assert.equal(readWeekend({ write: true, title: "x", excerpt: "", body_html: "" }).ok, false);
});

test("redakce: stránka Akce v okolí", () => {
  const data = {
    signedIn: true,
    hasApiKey: true,
    user: { role: "hlavni", name: "Redakce" },
    okoli: {
      settings: { enabled: true, weekly: true, autoPublish: false, radiusKm: 10, weekendOn: "2026-10-09", weekendNote: "Článek čeká jako návrh.", weekendProposalId: 3, status: "ok", note: "Nových akcí: 2." },
      sources: [{ tag: "kzmj", name: "KZMJ Jičín", title: "Kulturní zařízení města Jičína", home: "https://kzmj.cz/", town: "Jičín", km: 13, upcoming: 2 }],
      events: [{ ...nearby, hidden: true }],
    },
  };
  const page = adminOkoli({}, data, "", {});
  assert.match(page, /Akce v okolí/);
  assert.match(page, /action="\/redakce\/okoli\/napsat"/);
  assert.match(page, /mimo okruh/);
  assert.match(page, /name="kind" value="ukazat"/);
  assert.match(page, /navrh=3|navrh:3/);
  assert.match(page, /Na samostatné svátky/);
  assert.match(page, /name="autoVolno"/);
  assert.match(page, /action="\/redakce\/okoli\/napsat"[\s\S]*name="od"[\s\S]*name="do"/);
  assert.match(page, /Příští článek: /);
});

test("obce na Antee: termín, čerstvost a odpověď modelu", async () => {
  const { isCurrent, readExtract, termDays } = await import("../src/okoli/antee.js");
  assert.deepEqual(termDays("21. 9. 2026 až 2. 10. 2026"), { first: "2026-09-21", last: "2026-10-02" });
  assert.equal(termDays(""), null);
  assert.equal(isCurrent({ term: "14. 11. 2026" }, "2026-10-06"), true);
  assert.equal(isCurrent({ term: "1. 9. 2026" }, "2026-10-06"), false);
  const source = { town: "Libáň" };
  assert.equal(readExtract({ is_event: false }, source), null);
  assert.equal(readExtract({ is_event: true, title: "Zábava", date: "14. 11." }, source), null);
  assert.deepEqual(readExtract({ is_event: true, title: "Hubertská zábava", date: "2026-11-14", time: "9:00", place: "", description: "Hraje Bylo nás pět." }, source), {
    title: "Hubertská zábava", startsOn: "2026-11-14", startsTime: "09:00", endsTime: "", place: "Libáň", description: "Hraje Bylo nás pět.", kind: "akce", soldOut: false,
  });
});

test("obce na Antee: model čte jen nové a aktuální položky", async () => {
  const { anteeReader } = await import("../src/okoli/antee.js");
  const entry = (slug, title, term) => `<item><title>${title}</title><link>https://www.mestoliban.cz/aktuality/${slug}</link>
    <pubDate>Mon, 05 Oct 2026 09:00:07 +0200</pubDate><description>${title}</description><dueDate>${term}</dueDate></item>`;
  const rss = `<?xml version="1.0"?><rss><channel>${[
    entry("hubert", "POZVÁNKA - HUBERTSKÁ ZÁBAVA", "14. 11. 2026"),
    entry("uzavirka", "INFORMACE - UZAVÍRKA", "21. 9. 2026 až 19. 10. 2026"),
    entry("stara", "POZVÁNKA - LETNÍ KINO", "1. 8. 2026"),
    entry("znama", "POZVÁNKA - KONCERT", "17. 10. 2026"),
  ].join("")}</channel></rss>`;
  const asked = [];
  const ask = async (_env, _source, item) => {
    asked.push(item.title);
    return { ok: true, raw: /HUBERT/.test(item.title) ? { is_event: true, title: "Hubertská zábava", date: "2026-11-14", time: "19:00", place: "Kulturní dům Libáň", description: "" } : { is_event: false } };
  };
  const read = anteeReader({ tag: "liban", town: "Libáň", feed: "https://www.mestoliban.cz/aktuality?action=atom" });
  const feed = await read({
    env: { ANTHROPIC_API_KEY: "x" },
    fetchImpl: async () => new Response(rss),
    known: new Map([["liban:www.mestoliban.cz/znama", ""]]),
    ask,
    today: "2026-10-06",
  });
  assert.equal(feed.ok, true);
  assert.equal(feed.complete, false);
  assert.deepEqual(asked, ["POZVÁNKA - HUBERTSKÁ ZÁBAVA", "INFORMACE - UZAVÍRKA"]);
  assert.deepEqual(feed.items.map((item) => [item.guid, item.startsOn, item.startsTime, item.place]), [["liban:www.mestoliban.cz/hubert", "2026-11-14", "19:00", "Kulturní dům Libáň"]]);
  assert.deepEqual(feed.seen.sort(), ["liban:www.mestoliban.cz/stara", "liban:www.mestoliban.cz/uzavirka"]);
});

test("obce na Antee: plakát v plné velikosti, každý jednou", async () => {
  const { posterUrls } = await import("../src/okoli/antee.js");
  assert.deepEqual(
    posterUrls(["https://www.mestoliban.cz/image.php?nid=777&oid=1", "https://www.mestoliban.cz/image.php?nid=777&oid=1&width=624&height=936", "https://www.mestoliban.cz/image.php?nid=777&oid=2&width=624"]),
    ["https://www.mestoliban.cz/image.php?nid=777&oid=1", "https://www.mestoliban.cz/image.php?nid=777&oid=2"],
  );
});

test("jicin.org: termín, seznam a stránka akce", async () => {
  const { parseJicinDetail, parseJicinList, parseRange } = await import("../src/okoli/jicin-org.js");
  assert.deepEqual(parseRange("6. 10. 2026"), { startsOn: "2026-10-06", endsOn: "" });
  assert.deepEqual(parseRange("1. - 7. 10. 2026"), { startsOn: "2026-10-01", endsOn: "2026-10-07" });
  assert.deepEqual(parseRange("9. 9. - 27. 10. 2026"), { startsOn: "2026-09-09", endsOn: "2026-10-27" });
  assert.deepEqual(parseRange("28. 11. 2026 - 6. 1. 2027"), { startsOn: "2026-11-28", endsOn: "2027-01-06" });
  const row = (date, title, href) => `<div class="views-row"><div class="group-date">${date}</div>
    <div class="field field--name-node-title field--type-ds">  <a href="${href}" hreflang="cs">${title}</a></div>
    <div class="field field--name-body field--type-text-with-summary">  Přednáška o&nbsp;zdraví.</div></div>`;
  const html = [
    row('<div class="field field--name-field-datetime-startend"><time datetime="2026-10-06T18:00:00+02:00">6. 10. 2026</time></div><div class="field field--name-display-field-copynode-date-start-copy3"><time datetime="2026-10-06T16:00:00Z">18.00</time></div>', "Kraj pro zdraví", "/kraj-pro-zdravi"),
    row('<span class="date-display-range">1. - 7. 10. 2026</span>', "Den architektury", "/den-architektury"),
    row('<span class="date-display-range">9. 9. - 27. 10. 2026</span>', "VR film Tmání", "/vr-film-tmani"),
    row('<div class="field field--name-field-datetime-startend"><time datetime="2026-10-06T00:00:00+02:00">6. 10. 2026</time></div>', "TEST Akce", "/test-akce"),
  ].join("");
  assert.deepEqual(parseJicinList(html), [
    { link: "https://www.jicin.org/kraj-pro-zdravi", title: "Kraj pro zdraví", startsOn: "2026-10-06", endsOn: "", startsTime: "18:00", summary: "Přednáška o zdraví." },
    { link: "https://www.jicin.org/den-architektury", title: "Den architektury", startsOn: "2026-10-01", endsOn: "2026-10-07", startsTime: "", summary: "Přednáška o zdraví." },
  ]);
  const detail = parseJicinDetail('<div class="field field--name-body">Přednáška.</div><div class="field field--name-field-link-mapycz"><a href="https://mapy.cz/x">Knihovna Václava Čtvrtka - Deniska</a></div>');
  assert.equal(detail.place, "Knihovna Václava Čtvrtka - Deniska");
  assert.equal(detail.body, "Přednáška.");
});

test("víkend: stejná akce z KZMJ i jicin.org jen jednou, vícedenní s rozsahem", async () => {
  const { dedupeNearby } = await import("../src/okoli/weekend.js");
  const base = { startsOn: "2026-10-17", startsTime: "19:00", place: "Masarykovo divadlo", town: "Jičín", km: 15, description: "", link: "https://x/", kind: "akce" };
  const kept = dedupeNearby([
    { ...base, title: "Balada pro banditu", source: "kzmj" },
    { ...base, title: "Balada pro Banditu!", source: "jicinorg" },
    { ...base, title: "Slavnost stromů 2026", startsTime: "14:00", source: "jicinorg" },
  ]);
  assert.deepEqual(kept.map((event) => event.source), ["kzmj", "jicinorg"]);
  const text = weekendText({
    today: "2026-10-02", weekend: weekendFor("2026-10-02"), home: [], radiusKm: 25, topics: [],
    nearby: [{ ...base, title: "Den architektury", startsOn: "2026-10-01", endsOn: "2026-10-07", startsTime: "" }],
  });
  assert.match(text, /- od 1\. 10\. do 7\. 10\., Jičín/);
});

test("most přes GitHub: bez klíče nic, poslané akce jen ve tvaru čtečky", async () => {
  const { okoliRelay, readRelayFeed } = await import("../src/okoli/relay.js");
  const request = (auth) => new Request("https://www.kopidlenskadrbna.org/okoli/prijem?zdroj=kzmj", { headers: auth ? { authorization: auth } : {} });
  assert.equal((await okoliRelay(request(), {})).status, 503);
  assert.equal((await okoliRelay(request("Bearer spatne"), { OKOLI_RELAY_TOKEN: "tajne" })).status, 401);
  const source = { tag: "kzmj", hosts: ["kzmj.cz"] };
  const feed = readRelayFeed({
    items: [
      { guid: "kzmj:biograf_akce:1", stamp: "s", link: "https://kzmj.cz/sekce-biograf/hnizdo/", title: "Hnízdo", kind: "kino", startsOn: "2026-10-17", startsTime: "21:30", place: "Biograf Český ráj" },
      { guid: "kzmj:divadlo_akce:2", stamp: "t", unchanged: true },
      { guid: "kzmj:divadlo_akce:3", link: "https://zlo.example/", title: "Podvrh", startsOn: "2026-10-17" },
      { guid: "jinde:1", link: "https://kzmj.cz/x/", title: "Cizí", startsOn: "2026-10-17" },
      { guid: "kzmj:divadlo_akce:4", link: "https://kzmj.cz/x/", title: "Bez data", startsOn: "17. 10." },
    ],
    listed: ["kzmj:biograf_akce:1", "jinde:2"],
    complete: true,
  }, source);
  assert.deepEqual(feed.items.map((item) => item.guid), ["kzmj:biograf_akce:1", "kzmj:divadlo_akce:2"]);
  assert.equal(feed.items[0].startsTime, "21:30");
  assert.deepEqual(feed.listed, ["kzmj:biograf_akce:1"]);
  assert.equal(feed.complete, true);
});
