import assert from "node:assert/strict";
import test from "node:test";
import { footballText } from "../src/fotbal/ai.js";
import { footballSourceDate, matchExtra } from "../src/fotbal/collect.js";
import { checkDates } from "../src/fotbal/dates.js";
import {
  competitionLinks,
  findOfficial,
  inTable,
  officialFromExtra,
  officialLine,
  ourTeam,
  parseFixtures,
  parseOfficialGoals,
  parseTable,
  readTruthUrl,
  sameTeam,
  tableUrl,
} from "../src/fotbal/fotbalunas.js";

const CLUB = `<a href="/tym/1886">FK Kopidlno B</a> <a href="/soutez/187/">Okresní přebor</a>
<a href="/soutez/188/">III. třída</a> <a href="/soutez/187/">Okresní přebor</a>`;

function row(id, home, away, result) {
  return `<li class="list-group-item match-item border-0">
  <table class="zapas-item-table"><tr>
    <td class="zapas-item-icon"><a href="/zapas/${id}/pridat-report" class="btn btn-plus"><i class="fa fa-plus"></i></a></td>
    <td class="zapas-item-utkani text-start">
      <a href="/zapas/${id}/" >
        ${home.replace(" ", "\n      ")}
            -
        ${away}
      </a>
      <small class="ms-2 text-muted">Online volný</small>
    </td>
    <td class="zapas-item-vysledek text-end">${result}</td>
  </tr></table></li>`;
}

const FIXTURES = `<h2 class="p-0">2026-2027
</h2>
${row(618559, "Kopidlno B", "Železnice B", `<a href="/zapas/618559/"> 1:2 (1:1) </a><a href="/zapas/618559/"><small class="btn-sm alert-success">13.09. 17:00</small></a>`)}
${row(618562, "Hořice B", "Kopidlno B", `<a href="/expert-tip/1"><small class="btn-sm btn-warning">&nbsp; 67-0-33 % </small></a>&nbsp;<a href="/zapas/618562/"><small class="btn-sm alert-success">03.10. 16:00</small></a>`)}
${row(618563, "Kopidlno B", "St. Paka", `<a href="/zapas/618563/"> -:- (-:-) </a><a href="/zapas/618563/"><small>11.04. 16:00</small></a>`)}
${row(618358, "Libuň", "Kopidlno C", `<a href="/zapas/618358/"> -:- (-:-) </a><a href="/zapas/618358/"><small>04.10. 16:00</small></a>`)}
${row(595830, "Kopidlno", "Kunčice", `<a href="/zapas/595830/"> zrušen </a><a href="/zapas/595830/"><small>16.08. 17:00</small></a>`)}
${row(618300, "Sobotka B", "Kopidlno C", `<a href="/zapas/618300/"> 3:0 (3:0) </a><a href="/zapas/618300/"><small>20.09. 17:00</small></a>`)}
${row(600001, "Robousy", "Miletín B", `<a href="/zapas/600001/"> 3:0 (1:0) </a><a href="/zapas/600001/"><small>13.09. 17:00</small></a>`)}`;

const GOALS = `<div class="text-center zapas-info"><div class="row">
<div class="col-2"><img src="/a.png" /></div>
<div class="col-3"> <div style="text-align:right;"> <a href="/hrac/1">P.&nbsp;Janda</a> 29. </div> </div>
<div class="col-2"><div class="match-result-info"> 1:2 </div><div class="match-result-subinfo"> (1:1) </div></div>
<div class="col-3"> <div style="text-align:left;"> 43. <a href="/hrac/2">V.&nbsp;Svoboda</a> <br /> 80. <a href="/hrac/3">D.&nbsp;Neděla</a> </div> </div>
</div></div>`;

test("fotbalunas: soutěže klubu, rozlosování a střelci", () => {
  assert.deepEqual(competitionLinks(CLUB), ["https://fotbalunas.cz/rozlosovani/soutez/187", "https://fotbalunas.cz/rozlosovani/soutez/188"]);
  const fixtures = parseFixtures(FIXTURES, { source: "https://fotbalunas.cz/rozlosovani/soutez/187" });
  assert.equal(fixtures.length, 6, "cizí zápasy se přeskočí");
  assert.deepEqual(fixtures[0], {
    url: "https://fotbalunas.cz/zapas/618559/",
    home: "Kopidlno B",
    away: "Železnice B",
    date: "2026-09-13",
    time: "17:00",
    score: "1:2",
    half: "1:1",
    cancelled: false,
    source: "https://fotbalunas.cz/rozlosovani/soutez/187",
  });
  assert.equal(tableUrl(fixtures[0].source), "https://fotbalunas.cz/tabulky/soutez/187");
  assert.equal(fixtures[1].score, "", "tip ani čas nejsou výsledek");
  assert.equal(fixtures[1].date, "2026-10-03");
  assert.equal(fixtures[2].date, "2027-04-11", "jaro patří k druhému roku sezóny");
  assert.equal(fixtures[4].cancelled, true);
  assert.deepEqual(parseOfficialGoals(GOALS), { home: ["29' P. Janda"], away: ["43' V. Svoboda", "80' D. Neděla"] });
});

test("fotbalunas: zkrácené názvy týmů se spárují s webem klubu", () => {
  assert.ok(sameTeam("Železnice B", "TJ Sokol Železnice B"));
  assert.ok(sameTeam("St. Paka", "TJ SOKOL Stará Paka"));
  assert.ok(sameTeam("Kopidlno", "FK Kopidlno"));
  assert.ok(!sameTeam("Kopidlno", "FK Kopidlno B"), "áčko není béčko");
  assert.ok(!sameTeam("Kopidlno C", "FK Kopidlno B"));
  const fixtures = parseFixtures(FIXTURES);
  assert.equal(findOfficial(fixtures, "TJ Sokol Libuň", "FK Kopidlno C")?.date, "2026-10-04");
  assert.equal(findOfficial(fixtures, "FK Kopidlno B", "TJ Sokol Libuň"), null);
  // Klub občas vynechá písmeno rezervy nebo splete své béčko s céčkem: pak jen jediný zápas pár dní od aktuality.
  assert.equal(findOfficial(fixtures, "SK Sobotka B", "FK Kopidlno B", "2026-09-15")?.away, "Kopidlno C");
  assert.equal(findOfficial(fixtures, "SK Sobotka B", "FK Kopidlno B", "2026-08-01"), null);
  assert.equal(findOfficial(fixtures, "SK Sobotka B", "FK Kopidlno B"), null);
  const twice = [...fixtures, { ...fixtures[0], date: "2027-05-01" }];
  assert.equal(findOfficial(twice, "FK Kopidlno B", "TJ Sokol Železnice B", "2027-04-28").date, "2027-05-01");
});

test("fotbalunas: adresa klubu v nastavení", () => {
  assert.deepEqual(readTruthUrl(""), { ok: true, url: "" });
  assert.deepEqual(readTruthUrl("https://www.fotbalunas.cz/klub/1673/"), { ok: true, url: "https://fotbalunas.cz/klub/1673" });
  assert.equal(readTruthUrl("https://fotbalunas.cz/tym/1886").ok, false);
  assert.equal(readTruthUrl("http://fotbalunas.cz/klub/1673").ok, false);
});

const LIBUN = parseFixtures(FIXTURES)[3];

test("klub se splete v datu, oficiální údaje ho opraví a článek smí jít ven", () => {
  const extra = matchExtra(null, {}, "", { line: officialLine(LIBUN), table: "", team: "Kopidlno C" });
  assert.match(extra, /^Oficiálně \(fotbalunas\.cz\): Libuň – Kopidlno C, 2026-10-04 16:00, ještě se nehrálo$/);
  assert.deepEqual(officialFromExtra(extra), { home: "Libuň", away: "Kopidlno C", date: "2026-10-04", score: "", cancelled: false });

  const invite = { kind: "pozvanka", title: "TJ Sokol Libuň - FK Kopidlno C", publishedOn: "2026-09-30", text: "neděle 3. 10. 2026 od 16:00", extra };
  assert.deepEqual(checkDates(invite), { doubts: [], fixes: ["„neděle 3. 10. 2026“ → neděle 4. 10. 2026."] });
  assert.deepEqual(checkDates({ ...invite, text: "neděle 4. 10. 2026 od 16:00" }), { doubts: [], fixes: [] });
  assert.deepEqual(checkDates({ ...invite, text: "v pátek 31. 9." }).fixes, ["„pátek 31. 9.“ → neděle 4. 10. 2026."]);
  // Datum daleko od zápasu k němu nepatří: když nesedí den v týdnu, musí to zkontrolovat redakce.
  assert.deepEqual(checkDates({ ...invite, text: "Brigáda v pátek 18. 10. 2026." }).doubts, ["„pátek 18. 10. 2026“: 18. 10. 2026 je neděle, ne pátek."]);

  const planned = `Zápas: TJ Sokol Libuň – FK Kopidlno C, 2026-10-03 16:00, ještě se nehrálo\n\n${extra}`;
  assert.deepEqual(checkDates({ ...invite, text: "neděle 4. 10.", extra: planned }).fixes, ["Rozpis klubu uvádí 3. 10. 2026, hraje se neděle 4. 10. 2026."]);

  const text = footballText(invite, { articles: [], proposals: [] }, { today: "2026-10-01", fixes: checkDates(invite).fixes });
  assert.match(text, /Klub se v aktualitě spletl, platí oficiální údaje z fotbalunas\.cz: „neděle 3\. 10\. 2026“ → neděle 4\. 10\. 2026\./);
  assert.doesNotMatch(text, /Pozor, datum ve zdroji nesedí/);
});

test("výsledek, zrušený zápas a datum zápasu podle fotbalunas", () => {
  const played = parseFixtures(FIXTURES)[0];
  const extra = officialLine(played, parseOfficialGoals(GOALS));
  assert.match(extra, /výsledek 1:2 \(1:1\)\nGóly podle fotbalunas\.cz: domácí 29' P\. Janda; hosté 43' V\. Svoboda, 80' D\. Neděla$/);
  const report = { kind: "zapas", title: "FK Kopidlno B - TJ Sokol Železnice B 2:1 (1:1)", publishedOn: "2026-09-12", text: "", extra };
  assert.deepEqual(checkDates(report).fixes, ["Výsledek 2:1 → 1:2."]);
  assert.equal(footballSourceDate(report, "2026-10-01"), "2026-09-13", "zápas dostane den, kdy se podle svazu hrál");

  const cancelled = { kind: "pozvanka", title: "FK Kopidlno - Kunčice", text: "", extra: officialLine(parseFixtures(FIXTURES)[4]) };
  assert.deepEqual(checkDates(cancelled).doubts, ["Podle fotbalunas.cz je zápas zrušený."]);
  // Klubové zprávy se zápasem nesouvisí, ty se neopravují.
  assert.deepEqual(checkDates({ ...cancelled, kind: "clanek", text: "neděle 3. 10. 2026" }).fixes, []);
});

test("klub splete tým, svaz ho opraví", () => {
  const official = findOfficial(parseFixtures(FIXTURES), "SK Sobotka B", "FK Kopidlno B", "2026-09-15");
  const report = { kind: "zapas", title: "SK Sobotka B - FK Kopidlno B 3:0 (3:0)", publishedOn: "2026-09-15", text: "", extra: officialLine(official) };
  assert.deepEqual(officialFromExtra(report.extra), { home: "Sobotka B", away: "Kopidlno C", date: "2026-09-20", score: "3:0", cancelled: false });
  assert.deepEqual(checkDates(report), { doubts: [], fixes: ["Zápas „SK Sobotka B – FK Kopidlno B“ je podle svazu Sobotka B – Kopidlno C."] });
});

const TABLE = `<table class="table"><thead><tr><th></th><th>Tým</th><th>Z</th><th>V</th><th>R</th><th>P</th><th>Skóre</th><th>B</th><th>PK</th></tr></thead>
<tbody><tr><td class="text-center">1</td><td><a href="/tym/1">SK Podskalan Podhradí B</a></td><td>7</td><td>6</td><td>1</td><td>0</td><td>25:8</td><td>19</td><td>0</td></tr>
<tr><td class="text-center">6</td><td><a href="/tym/5484">FK Kopidlno C</a></td><td>7</td><td>2</td><td>0</td><td>5</td><td>19:33</td><td>6</td><td>0</td></tr></tbody></table>
<table class="table-widget"><tr><th></th><th>Tabulka</th></tr><tr><td>1</td><td>Jiná</td><td>7</td><td>1:0</td><td>3</td></tr></table>`;

test("tabulka k zápasu je ze soutěže, kde se hrálo; tabulka a střelci béčka z webu klubu jen k béčku", () => {
  const table = parseTable(TABLE);
  assert.equal(table, "1. SK Podskalan Podhradí B 7 25:8 19\n6. FK Kopidlno C 7 19:33 6");
  assert.ok(inTable(table, "Kopidlno C"));
  assert.ok(!inTable(table, "Kopidlno B"));
  assert.equal(ourTeam({ home: "Libuň", away: "Kopidlno C" }), "Kopidlno C");

  const club = { table: "1. SK Robousy A 7 34:2 21\n4. FK Kopidlno B 7 27:21 12", scorers: "1. Miloš Kovář 7" };
  const line = officialLine(LIBUN);
  const withTable = matchExtra(null, club, "", { line, table, team: "Kopidlno C" });
  assert.match(withTable, /Tabulka soutěže teď \(fotbalunas\.cz\):\n1\. SK Podskalan Podhradí B/);
  assert.doesNotMatch(withTable, /Robousy A|Kovář/);
  const noTable = matchExtra(null, club, "", { line, table: "", team: "Kopidlno C" });
  assert.doesNotMatch(noTable, /Tabulka|Kovář/, "béčkovou tabulku céčku nedá ani bez fotbalunas tabulky");
  const bTeam = matchExtra(null, club, "", { line, table: "", team: "Kopidlno B" });
  assert.match(bTeam, /Tabulka soutěže teď:\n1\. SK Robousy A[\s\S]*Nejlepší střelci týmu:\n1\. Miloš Kovář/);
});
