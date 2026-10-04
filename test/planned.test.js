import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { liveArticle } from "../src/db-core.js";

test("zpráva s datem v budoucnu je na webu až ten den, skrytá nikdy", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("create table articles (slug text, published integer, created_at text)");
  const insert = db.prepare("insert into articles values (?, ?, ?)");
  insert.run("vcera", 1, "2026-10-03");
  insert.run("dnes-s-casem", 1, "2026-10-04 08:15:00");
  insert.run("zitra", 1, "2026-10-05");
  insert.run("skryta", 0, "2026-10-01");
  const live = (today) =>
    db.prepare(`select slug from articles a where ${liveArticle("a", today)} order by slug`).all().map((row) => row.slug);
  assert.deepEqual(live("2026-10-04"), ["dnes-s-casem", "vcera"]);
  assert.deepEqual(live("2026-10-05"), ["dnes-s-casem", "vcera", "zitra"]);
});
