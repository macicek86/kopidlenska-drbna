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
