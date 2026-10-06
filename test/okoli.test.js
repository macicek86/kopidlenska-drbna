import assert from "node:assert/strict";
import test from "node:test";
import { adminOkoli } from "../src/admin/index.js";
import { fetchKzmj, parseEventPage, parseKzmjPost } from "../src/okoli/kzmj.js";
import { mapNearbyEvent } from "../src/okoli/store.js";
import { kopidlnoLink, readWeekend, weekendDue, weekendFor, weekendSchema, weekendSource, weekendText } from "../src/okoli/weekend.js";

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

test("víkend: od pondělí do čtvrtka ten příští, v pátek až neděli ten právě běžící", () => {
  assert.deepEqual(weekendFor("2026-10-07"), { friday: "2026-10-09", from: "2026-10-09", to: "2026-10-11" });
  assert.deepEqual(weekendFor("2026-10-09"), { friday: "2026-10-09", from: "2026-10-09", to: "2026-10-11" });
  assert.deepEqual(weekendFor("2026-10-10"), { friday: "2026-10-09", from: "2026-10-10", to: "2026-10-11" });
  assert.deepEqual(weekendFor("2026-10-11"), { friday: "2026-10-09", from: "2026-10-11", to: "2026-10-11" });
});

test("víkendový článek: cron ho píše v pátek ráno a jen jednou", () => {
  const on = { weekly: true, weekendOn: "" };
  assert.equal(weekendDue(on, { date: "2026-10-08", time: "10:15" }), null);
  assert.equal(weekendDue(on, { date: "2026-10-09", time: "02:15" }), null);
  assert.equal(weekendDue(on, { date: "2026-10-09", time: "06:15" }).friday, "2026-10-09");
  assert.equal(weekendDue(on, { date: "2026-10-09", time: "18:15" }), null);
  assert.equal(weekendDue({ ...on, weekendOn: "2026-10-09" }, { date: "2026-10-09", time: "10:15" }), null);
  assert.equal(weekendDue({ ...on, weekly: false }, { date: "2026-10-09", time: "10:15" }), null);
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
  assert.match(page, /Každý pátek napsat článek/);
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
