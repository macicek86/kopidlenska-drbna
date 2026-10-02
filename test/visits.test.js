import assert from "node:assert/strict";
import test from "node:test";
import { DIRECT, isBot, readCount, visitorHash, visitPath, visitSource, visitTarget } from "../src/visits.js";
import { visitChart } from "../src/admin/stats.js";

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";

function get(url, headers = {}) {
  return new Request(url, { headers: { "user-agent": BROWSER, ...headers } });
}

const page = new Response("<p>", { headers: { "content-type": "text/html; charset=utf-8" } });

test("počítá se jen veřejná HTML stránka od člověka", () => {
  assert.equal(visitPath(get("https://drbna.cz/zpravy/"), page), "/zpravy");
  assert.equal(visitPath(get("https://drbna.cz/"), page), "/");
  assert.equal(visitPath(get("https://popelnice.drbna.cz/"), page), "/popelnice");
  assert.equal(visitPath(get("https://drbna.cz/redakce/prehled"), page), null);
  assert.equal(visitPath(get("https://drbna.cz/nic"), new Response("", { status: 404, headers: { "content-type": "text/html" } })), null);
  assert.equal(visitPath(get("https://drbna.cz/odstavky.json"), new Response("{}", { headers: { "content-type": "application/json" } })), null);
  assert.equal(visitTarget(new Request("https://drbna.cz/", { method: "HEAD", headers: { "user-agent": BROWSER } })), null);
  assert.equal(visitTarget(get("https://drbna.cz/", { "sec-purpose": "prefetch" })), null);
  assert.equal(visitTarget(get("https://drbna.cz/", { cookie: "a=1; drbna_editor=xyz" })), null);
  assert.equal(visitTarget(get("https://drbna.cz/", { cookie: "CF_Authorization=abc" })), null);
  assert.equal(visitTarget(get("https://drbna.cz/", { cookie: "drbna_ad=3" })), "/");
});

test("roboti se nepočítají", () => {
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isBot("facebookexternalhit/1.1"), true);
  assert.equal(isBot("curl/8.5.0"), true);
  assert.equal(isBot(""), true);
  assert.equal(isBot(BROWSER), false);
});

test("odkud přišli: jen název webu, vlastní web je přímo", () => {
  assert.equal(visitSource("https://l.facebook.com/l.php?u=xyz", "drbna.cz"), "Facebook");
  assert.equal(visitSource("https://m.facebook.com/", "drbna.cz"), "Facebook");
  assert.equal(visitSource("https://www.google.cz/", "drbna.cz"), "Google");
  assert.equal(visitSource("https://search.seznam.cz/?q=kopidlno", "drbna.cz"), "Seznam");
  assert.equal(visitSource("https://www.kopidlno.cz/aktuality/123", "drbna.cz"), "kopidlno.cz");
  assert.equal(visitSource("https://drbna.cz/zpravy", "drbna.cz"), DIRECT);
  assert.equal(visitSource("https://popelnice.drbna.cz/", "www.drbna.cz"), DIRECT);
  assert.equal(visitSource(null, "drbna.cz"), DIRECT);
});

test("otisk návštěvníka se mění se solí a neobsahuje IP", async () => {
  const one = await visitorHash("sul-1", "203.0.113.5", BROWSER);
  assert.equal(one, await visitorHash("sul-1", "203.0.113.5", BROWSER));
  assert.notEqual(one, await visitorHash("sul-2", "203.0.113.5", BROWSER));
  assert.match(one, /^[0-9a-f]{24}$/);
});

test("veřejné „Přečteno“ jen s nenulovým počtem", () => {
  assert.equal(readCount(0), "");
  assert.equal(readCount(7), "Přečteno 7×");
  assert.equal(readCount(1234).replace(/\s/g, " "), "Přečteno 1 234×");
});

test("graf má sloupec za každý den", () => {
  const svg = visitChart([
    { day: "2026-10-01", views: 10, visitors: 4 },
    { day: "2026-10-02", views: 0, visitors: 0 },
  ]);
  assert.equal(svg.match(/class="chart-views"/g).length, 2);
  assert.match(svg, /1\. října: návštěvníci 4, zobrazení 10/);
  assert.doesNotMatch(svg, /style=/);
});
