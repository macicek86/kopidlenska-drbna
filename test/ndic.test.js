import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { contextText } from "../src/munipolis/ai.js";
import { readNdicDecision } from "../src/ndic/ai.js";
import { closureDays, closureNotice, closureTitle, distanceKm, recordEnded } from "../src/ndic/closures.js";
import { wantsArticle } from "../src/ndic/run.js";
import { ensureNdicTables, finishClosure, loadClosures, loadNdicSettings, saveSituations, waitingClosures } from "../src/ndic/store.js";
import { isDatexMessage, parseSituations } from "../src/ndic/datex.js";
import { authorized, bodyText } from "../src/ndic/push.js";
import { noticeBoard, noticeSpan } from "../src/notices.js";

// Podle vzorku z dokumentace NDIC (cz-ndic_d2-restrictions-v1.1), poloha posunutá ke Kopidlnu.
function message({ prefix = "", end = "2026-10-20T18:00:00+02:00", x = -679500, y = -1024900, status = "definedByValidityTimeSpec" } = {}) {
  const p = prefix ? `${prefix}:` : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<${p}d2LogicalModel modelBaseVersion="2" xmlns${prefix ? `:${prefix}` : ""}="http://datex2.eu/schema/2/2_0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <${p}payloadPublication xsi:type="SituationPublication" lang="cz">
    <${p}situation id="sit-1" version="2">
      <${p}situationRecord xsi:type="RoadOrCarriagewayOrLaneManagement" id="rec-1" version="1">
        <${p}situationRecordVersionTime>2026-10-01T08:00:00+02:00</${p}situationRecordVersionTime>
        <${p}validity>
          <${p}validityStatus>${status}</${p}validityStatus>
          <${p}validityTimeSpecification>
            <${p}overallStartTime>2026-10-05T07:00:00+02:00</${p}overallStartTime>
            ${end ? `<${p}overallEndTime>${end}</${p}overallEndTime>` : ""}
          </${p}validityTimeSpecification>
        </${p}validity>
        <${p}impact><${p}capacityRemaining>0</${p}capacityRemaining></${p}impact>
        <${p}generalPublicComment><${p}comment><${p}values>
          <${p}value lang="cs">Oprava mostu, objížďka přes Ledkov &amp; Pševes</${p}value>
        </${p}values></${p}comment></${p}generalPublicComment>
        <${p}groupOfLocations xsi:type="Linear">
          <${p}linearWithinLinearElement><${p}linearElement><${p}roadNumber>II/280</${p}roadNumber></${p}linearElement></${p}linearWithinLinearElement>
          <${p}globalNetworkLinear>
            <${p}startPoint><${p}sjtskPointCoordinates><${p}sjtskX>${x}</${p}sjtskX><${p}sjtskY>${y}</${p}sjtskY></${p}sjtskPointCoordinates></${p}startPoint>
            <${p}endPoint><${p}sjtskPointCoordinates><${p}sjtskX>-726024</${p}sjtskX><${p}sjtskY>-1062544</${p}sjtskY></${p}sjtskPointCoordinates></${p}endPoint>
          </${p}globalNetworkLinear>
        </${p}groupOfLocations>
        <${p}roadOrCarriagewayOrLaneManagementType>roadClosed</${p}roadOrCarriagewayOrLaneManagementType>
      </${p}situationRecord>
    </${p}situation>
  </${p}payloadPublication>
</${p}d2LogicalModel>`;
}

test("zpráva NDIC: situace, záznam, poloha a text", () => {
  assert.equal(isDatexMessage(message()), true);
  assert.equal(isDatexMessage("<html></html>"), false);
  const [situation] = parseSituations(message());
  assert.equal(situation.id, "sit-1");
  const [record] = situation.records;
  assert.equal(record.id, "rec-1");
  assert.equal(record.situationId, "sit-1");
  assert.deepEqual(record.roads, ["II/280"]);
  assert.deepEqual(record.management, ["roadClosed"]);
  assert.equal(record.capacityRemaining, 0);
  assert.deepEqual(record.comments, ["Oprava mostu, objížďka přes Ledkov & Pševes"]);
  assert.equal(record.endsAt, "2026-10-20T18:00:00+02:00");
  assert.equal(record.points.length, 2);
});

test("zpráva NDIC s prefixem jmenného prostoru se čte stejně", () => {
  assert.deepEqual(parseSituations(message({ prefix: "d2" })), parseSituations(message()));
});

test("vzdálenost od Kopidlna: nejbližší bod, S-JTSK i WGS-84", () => {
  const [record] = parseSituations(message())[0].records;
  assert.equal(distanceKm(record.points), 0.8);
  // Jičín je od Kopidlna vzdušnou čarou asi 13 km.
  assert.equal(Math.round(distanceKm([{ lat: 50.4372, lon: 15.3518 }])), 13);
  assert.equal(distanceKm([]), null);
});

test("nadpis podle druhu omezení, silnice a vozidel", () => {
  const [record] = parseSituations(message())[0].records;
  assert.equal(closureTitle(record), "Uzavírka: silnice II/280");
  assert.equal(
    closureTitle({ ...record, capacityRemaining: null, management: ["roadClosed"], vehicles: { types: ["lorry"], weight: 3.5 } }),
    "Uzavírka: silnice II/280 pro vozidla nad 3,5 t",
  );
  assert.equal(closureTitle({ ...record, capacityRemaining: null, management: ["singleAlternateLineTraffic"] }), "Kyvadlový provoz: silnice II/280");
  assert.equal(closureTitle({ roads: [], management: ["laneClosures"] }), "Omezení provozu");
});

test("skončený nebo pozastavený záznam neplatí", () => {
  const now = new Date("2026-10-10T10:00:00Z");
  const [live] = parseSituations(message())[0].records;
  const [ended] = parseSituations(message({ end: "2026-10-09T10:00:00+02:00" }))[0].records;
  const [suspended] = parseSituations(message({ status: "suspended" }))[0].records;
  const [open] = parseSituations(message({ end: "" }))[0].records;
  assert.equal(recordEnded(live, now), false);
  assert.equal(recordEnded(ended, now), true);
  assert.equal(recordEnded(suspended, now), true);
  assert.equal(recordEnded(open, now), false);
});

const row = {
  id: "rec-1",
  title: "Uzavírka: silnice II/280",
  startsAt: "2026-10-05T05:00:00.000Z",
  endsAt: "2026-10-20T16:00:00.000Z",
  roads: ["II/280"],
  comments: ["Oprava mostu."],
  detour: ["přes Ledkov"],
  distanceKm: 0.8,
  manual: "",
};

test("uzavírka jako oznámení: pražský čas, místo, poznámka a okruh", () => {
  const notice = closureNotice(row, { radiusKm: 10, enabled: true });
  assert.equal(notice.kind, "uzavirka");
  assert.equal(notice.startsOn, "2026-10-05");
  assert.equal(notice.startsTime, "07:00");
  assert.equal(notice.endsOn, "2026-10-20");
  assert.equal(notice.endsTime, "18:00");
  assert.deepEqual(notice.places, ["silnice II/280, v Kopidlně nebo hned u něj"]);
  assert.equal(notice.note, "Oprava mostu. Objížďka: přes Ledkov");
  assert.equal(notice.published, true);
  assert.equal(closureNotice({ ...row, distanceKm: 12.4 }, { radiusKm: 10 }).places[0], "silnice II/280, asi 12 km od Kopidlna");
  assert.equal(closureNotice({ ...row, distanceKm: 12.4 }, { radiusKm: 10 }).published, false);
  assert.equal(closureNotice({ ...row, distanceKm: null, manual: "ukazat" }, { radiusKm: 10 }).published, true);
  assert.equal(closureNotice({ ...row, manual: "skryt" }, { radiusKm: 10 }).published, false);
  assert.equal(closureNotice(row, { radiusKm: 10, enabled: false }).published, false);
});

test("uzavírka bez konce platí do odvolání a zůstává na webu", () => {
  const notice = closureNotice({ ...row, endsAt: "" }, { radiusKm: 10 });
  assert.equal(notice.openEnded, true);
  assert.match(noticeSpan(notice), /^Od .+ 07:00 do odvolání$/);
  const board = noticeBoard([notice], new Date("2027-05-01T10:00:00Z"));
  assert.equal(board.length, 1);
  assert.equal(board[0].phase, "now");
});

test("příjem: jméno a heslo z hlavičky Basic", () => {
  const config = { user: "ndic", password: "tajne:heslo" };
  const request = (value) => new Request("https://x.test/ndic/uzavirky", { method: "POST", headers: value ? { authorization: value } : {} });
  const basic = (text) => `Basic ${Buffer.from(text).toString("base64")}`;
  assert.equal(authorized(request(basic("ndic:tajne:heslo")), config), true);
  assert.equal(authorized(request(basic("ndic:spatne")), config), false);
  assert.equal(authorized(request(basic("jiny:tajne:heslo")), config), false);
  assert.equal(authorized(request(""), config), false);
  assert.equal(authorized(request("Basic ***"), config), false);
});

test("příjem: tělo s gzipem i bez", async () => {
  const xml = message();
  assert.equal(await bodyText(new Uint8Array(gzipSync(xml))), xml);
  assert.equal(await bodyText(new TextEncoder().encode(xml)), xml);
});

// Malá náhrada D1 nad SQLite v paměti (jako v messages.test.js).
function d1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    run: async () => {
      const result = db.prepare(sql).run(...values);
      return { results: [], meta: { changes: result.changes ?? 0 } };
    },
    first: async () => db.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (list) => {
      for (const item of list) await item.run();
    },
  };
}

async function ndicEnv() {
  const env = { DB: d1() };
  await ensureNdicTables(env);
  await env.DB.prepare("update ndic_settings set drbena = 1").run();
  return env;
}

const NOW = new Date("2026-10-03T10:00:00Z");

test("uložení: blízká se uloží a čeká na Drběnu, daleká ne, skončená zmizí", async () => {
  const env = await ndicEnv();
  const near = parseSituations(message())[0];
  const far = { ...parseSituations(message({ x: -742906, y: -1043052 }))[0], id: "sit-2" };
  far.records = far.records.map((record) => ({ ...record, id: "rec-2", situationId: "sit-2" }));
  const saved = await saveSituations(env, [near, far], NOW);
  assert.deepEqual(saved, { situations: 2, kept: 1 });
  const settings = await loadNdicSettings(env);
  const waiting = await waitingClosures(env, settings, NOW);
  assert.deepEqual(waiting.map((row) => row.id), ["rec-1"]);
  assert.ok(waiting[0].ref > 0);
  await saveSituations(env, parseSituations(message({ end: "2026-10-02T10:00:00+02:00" })), NOW);
  assert.equal((await loadClosures(env, NOW)).length, 0);
});

test("přepis od Drběny zůstane i po resetu odběru a nové verzi uzavírky", async () => {
  const env = await ndicEnv();
  await saveSituations(env, parseSituations(message()), NOW);
  await finishClosure(env, "rec-1", { status: "hotovo", proposalId: 7, humanTitle: "Zavřený most u Kopidlna", humanPlaces: ["Kopidlno – Ledkov"], humanNote: "Objížďka přes Pševes." });
  await env.DB.prepare("update road_closures set cleared = 1").run();
  assert.equal((await loadClosures(env, NOW)).length, 0);
  await saveSituations(env, parseSituations(message()), NOW);
  const [row] = await loadClosures(env, NOW);
  assert.equal(row.status, "hotovo");
  assert.equal(row.proposalId, 7);
  assert.equal(row.humanTitle, "Zavřený most u Kopidlna");
  assert.deepEqual(row.humanPlaces, ["Kopidlno – Ledkov"]);
  const settings = await loadNdicSettings(env);
  assert.equal((await waitingClosures(env, settings, NOW)).length, 0);
  // Na web jde přepis, bez věty o NDIC jako zdroji.
  const notice = closureNotice(row, settings);
  assert.equal(notice.title, "Zavřený most u Kopidlna");
  assert.equal(notice.note, "Objížďka přes Pševes.");
  assert.equal(notice.source, "ndic-prepis");
  assert.equal(wantsArticle(row, { articleDays: 2 }), false);
});

test("duplicita se z webu schová, ručně ukázaná se vrátí", () => {
  assert.equal(closureNotice({ ...row, status: "duplicita" }, { radiusKm: 10 }).published, false);
  assert.equal(closureNotice({ ...row, status: "duplicita", manual: "ukazat" }, { radiusKm: 10 }).published, true);
});

test("článek jen k delší uzavírce a jen jednou", () => {
  const settings = { articleDays: 2 };
  assert.equal(closureDays(row) > 15, true);
  assert.equal(wantsArticle(row, settings), true);
  // Začíná 5. října v 7:00: do druhého dne večer jsou to dva dny, týž den jen jeden.
  assert.equal(closureDays({ ...row, endsAt: "2026-10-06T16:00:00.000Z" }), 2);
  assert.equal(wantsArticle({ ...row, endsAt: "2026-10-06T16:00:00.000Z" }, settings), true);
  assert.equal(wantsArticle({ ...row, endsAt: "2026-10-05T16:00:00.000Z" }, settings), false);
  assert.equal(wantsArticle({ ...row, endsAt: "" }, settings), true);
  assert.equal(wantsArticle({ ...row, articleId: 3 }, settings), false);
});

test("odpověď Drběny: duplicita potřebuje značku, oznámení nadpis, článek jen když má být", () => {
  const slugs = ["prakticke", "zpravy"];
  const article = { include: true, title: "Most u Ledkova je zavřený", excerpt: "Do 20. října se jezdí přes Pševes.", body_html: "<p>Most je zavřený.</p>", rubric: "prakticke", image_caption: "", image_topic: "" };
  const notice = { title: "Zavřený most u Ledkova", places: ["Kopidlno – Ledkov", "Kopidlno – Ledkov"], note: "Objížďka přes Pševes." };
  assert.equal(readNdicDecision({ decision: "duplicita", reason: "", duplicate_of: "nic" }, { rubricSlugs: slugs }).ok, false);
  assert.deepEqual(readNdicDecision({ decision: "duplicita", reason: "Už od města.", duplicate_of: "odstavka:4" }, { rubricSlugs: slugs }), {
    ok: true,
    decision: "duplicita",
    reason: "Už od města.",
    duplicateOf: "odstavka:4",
  });
  const long = readNdicDecision({ decision: "vytvorit", reason: "", duplicate_of: "", notice, article }, { rubricSlugs: slugs, wantArticle: true });
  assert.deepEqual(long.notice.places, ["Kopidlno – Ledkov"]);
  assert.equal(long.article.rubric, "prakticke");
  const short = readNdicDecision({ decision: "vytvorit", reason: "", duplicate_of: "", notice, article }, { rubricSlugs: slugs, wantArticle: false });
  assert.equal(short.article, null);
  assert.equal(readNdicDecision({ decision: "vytvorit", notice: { title: "", places: [], note: "" } }, { rubricSlugs: slugs }).ok, false);
});

test("Munipolis a Deník vidí uzavírky z NDIC v přehledu", () => {
  const text = contextText({
    closures: [{ ref: 5, articleId: 12, proposalId: null, notice: closureNotice(row, { radiusKm: 10 }) }],
  });
  assert.match(text, /\[ndic:5\] 2026-10-05 až 2026-10-20 · Uzavírka: silnice II\/280 · .* · článek zprava:12/);
});
