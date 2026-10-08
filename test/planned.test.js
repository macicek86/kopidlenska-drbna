import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { liveArticle } from "../src/db-core.js";
import { pendingTime, publishNote, readPublishTime, scheduledMoment } from "../src/publish-time.js";

test("zpráva s datem v budoucnu je na webu až ten den, s časem až v tu hodinu, skrytá nikdy", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("create table articles (slug text, published integer, created_at text, published_at text)");
  const insert = db.prepare("insert into articles values (?, ?, ?, ?)");
  insert.run("vcera", 1, "2026-10-03", "");
  insert.run("dnes-s-casem", 1, "2026-10-04 08:15:00", null);
  insert.run("zitra", 1, "2026-10-05", "2026-10-04 22:00:00");
  insert.run("dnes-v-sedm", 1, "2026-10-04", "2026-10-04 05:00:00");
  insert.run("skryta", 0, "2026-10-01", "");
  const live = (now) =>
    db.prepare(`select slug from articles a where ${liveArticle("a", new Date(now))} order by slug`).all().map((row) => row.slug);
  assert.deepEqual(live("2026-10-04T04:15:00Z"), ["dnes-s-casem", "vcera"]);
  assert.deepEqual(live("2026-10-04T05:00:00Z"), ["dnes-s-casem", "dnes-v-sedm", "vcera"]);
  assert.deepEqual(live("2026-10-04T22:30:00Z"), ["dnes-s-casem", "dnes-v-sedm", "vcera", "zitra"]);
});

test("čas zveřejnění: pražská hodina, a když už minula, hned", () => {
  assert.equal(readPublishTime("7"), "07:00");
  assert.equal(readPublishTime("7.30"), "07:30");
  assert.equal(readPublishTime("07:00"), "07:00");
  assert.equal(readPublishTime("25:00"), "");
  assert.equal(readPublishTime(""), "");
  const night = new Date("2026-10-09T00:15:00Z"); // 2:15 v Praze
  assert.equal(scheduledMoment("2026-10-09", "07:00", night), "2026-10-09 05:00:00");
  assert.equal(scheduledMoment("2026-12-04", "07:00", night), "2026-12-04 06:00:00");
  assert.equal(scheduledMoment("2026-10-09", "", night), "2026-10-09 00:15:00");
  const late = new Date("2026-10-09T08:15:00Z");
  assert.equal(scheduledMoment("2026-10-09", "07:00", late), "2026-10-09 08:15:00");
  assert.equal(pendingTime("2026-10-09 05:00:00", night), "7:00");
  assert.equal(pendingTime("2026-10-09 05:00:00", late), "");
  assert.equal(publishNote("2026-10-09 05:00:00", night), "vyjde v 7:00");
  assert.equal(publishNote("2026-10-09 08:15:00", late), "vyšel");
});

test("fronta zveřejnění: v noci napsané vyjdou ráno s rozestupem, přes den hned, večer až zítra", async () => {
  const { spreadMoment, SPREAD_DEFAULTS } = await import("../src/publish-queue.js");
  const settings = { ...SPREAD_DEFAULTS, gapMin: 40, gapMax: 120 };
  const half = () => 0.5; // rozestup 80 minut
  const night = new Date("2026-10-09T00:15:00Z"); // 2:15 v Praze
  const first = spreadMoment([], night, settings, half);
  assert.deepEqual(first, { day: "2026-10-09", publishedAt: "2026-10-09 05:00:00" });
  const second = spreadMoment([first.publishedAt], night, settings, half);
  assert.equal(second.publishedAt, "2026-10-09 06:20:00");
  assert.equal(spreadMoment([first.publishedAt, second.publishedAt], night, settings, half).publishedAt, "2026-10-09 07:40:00");
  // Přes den po dlouhé pauze hned (na celou minutu nahoru), těsně po jiné zprávě s rozestupem.
  const noon = new Date("2026-10-09T10:15:30Z");
  assert.equal(spreadMoment(["2026-10-09 07:40:00"], noon, settings, half).publishedAt, "2026-10-09 10:16:00");
  assert.equal(spreadMoment(["2026-10-09 10:00:00"], noon, settings, half).publishedAt, "2026-10-09 11:20:00");
  // Naplánovaná zpráva (Kam vyrazit v 7:00) se obejde, vzdálená nevadí.
  assert.equal(spreadMoment(["2026-10-09 05:00:00"], night, settings, half).publishedAt, "2026-10-09 06:20:00");
  assert.equal(spreadMoment(["2026-10-09 16:00:00"], night, settings, half).publishedAt, "2026-10-09 05:00:00");
  // Večer po 21:00 se přesune na další den i s datem zprávy.
  const late = new Date("2026-10-09T18:30:00Z"); // 20:30 v Praze
  assert.deepEqual(spreadMoment(["2026-10-09 18:20:00"], late, settings, half), { day: "2026-10-10", publishedAt: "2026-10-10 05:00:00" });
});

test("fronta zveřejnění: nastavení z formuláře", async () => {
  const { readSpreadInput } = await import("../src/drbena-db.js");
  assert.deepEqual(readSpreadInput({ spread: true, spreadFrom: "7", spreadTo: "21:00", spreadMin: "40", spreadMax: "120" }), {
    ok: true,
    spread: { on: true, from: "07:00", to: "21:00", gapMin: 40, gapMax: 120 },
  });
  assert.equal(readSpreadInput({ spreadFrom: "21:00", spreadTo: "7:00", spreadMin: "40", spreadMax: "120" }).ok, false);
  assert.equal(readSpreadInput({ spreadFrom: "7:00", spreadTo: "21:00", spreadMin: "90", spreadMax: "60" }).ok, false);
  assert.equal(readSpreadInput({ spreadFrom: "7:00", spreadTo: "21:00", spreadMin: "1", spreadMax: "60" }).ok, false);
});

test("spěchající zpráva: pole ve schématu importů (ne u NDIC) a přečtení z odpovědi", async () => {
  const { outputSchema, readArticle } = await import("../src/munipolis/ai.js");
  assert.ok(outputSchema(["zpravy"]).properties.article.required.includes("urgent"));
  assert.ok(!outputSchema(["zpravy"], { urgent: false }).properties.article.required.includes("urgent"));
  const raw = { include: true, title: "Neteče voda", excerpt: "Havárie na Husově.", body_html: "<p>Do večera.</p>", rubric: "zpravy" };
  assert.equal(readArticle({ ...raw, urgent: true }, ["zpravy"]).urgent, true);
  assert.equal(readArticle(raw, ["zpravy"]).urgent, false);
});
