import assert from "node:assert/strict";
import test from "node:test";
import { prepareArticleBody, renderArticleHtml, withoutTracking } from "../src/rich.js";

test("z odkazů zmizí cizí sledovací parametry, ostatní zůstane", () => {
  assert.equal(withoutTracking("https://mv.gov.cz/docasny-obcansky-prukaz/?utm_source=chatgpt.com"), "https://mv.gov.cz/docasny-obcansky-prukaz/");
  assert.equal(withoutTracking("https://a.cz/x?id=5&utm_medium=x&fbclid=1#kotva"), "https://a.cz/x?id=5#kotva");
  assert.equal(withoutTracking("https://a.cz/x?id=5&Utm_Campaign=léto"), "https://a.cz/x?id=5");
  // Odkaz bez sledování se nepřekóduje.
  assert.equal(withoutTracking("https://a.cz/x?q=a%20b"), "https://a.cz/x?q=a%20b");
  assert.equal(withoutTracking("mailto:obec@kopidlno.cz"), "mailto:obec@kopidlno.cz");
});

test("text zprávy se čistí při uložení i u starých zpráv při vykreslení", () => {
  const body = '<p>Víc na <a href="https://mv.gov.cz/a/?utm_source=chatgpt.com&amp;id=2">webu ministerstva</a>.</p>';
  assert.match(prepareArticleBody(body).html, /href="https:\/\/mv\.gov\.cz\/a\/\?id=2"/);
  assert.doesNotMatch(renderArticleHtml(body), /utm_/);
});
