import assert from "node:assert/strict";
import test from "node:test";
import { mapEvent, readEventLink } from "../src/events-db.js";

const row = { id: 1, title: "Posvícení", place: "Náměstí", starts_on: "2026-10-10", starts_time: "", description: "", published: 1 };

test("odkaz jinam bere jen celou adresu http(s)", () => {
  assert.deepEqual(readEventLink(""), { link: "" });
  assert.deepEqual(readEventLink(" https://kopidlno.cz/akce "), { link: "https://kopidlno.cz/akce" });
  assert.ok(readEventLink("javascript:alert(1)").error);
  assert.ok(readEventLink("kopidlno.cz").error);
});

test("na webu je odkaz jen na zveřejněnou zprávu, návrh jen dokud čeká", () => {
  const hidden = mapEvent({ ...row, article_id: 5, article_slug: "posviceni", article_published: 0 });
  assert.equal(hidden.articleId, 5);
  assert.equal(hidden.articleSlug, "");
  const shown = mapEvent({ ...row, article_id: 5, article_slug: "posviceni", article_published: 1 });
  assert.equal(shown.articleSlug, "posviceni");
  assert.equal(mapEvent({ ...row, proposal_id: 7, proposal_status: "pending" }).proposalId, 7);
  assert.equal(mapEvent({ ...row, proposal_id: 7, proposal_status: "rejected" }).proposalId, null);
});
