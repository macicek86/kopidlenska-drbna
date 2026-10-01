import assert from "node:assert/strict";
import test from "node:test";
import { adminFootball } from "../src/admin/index.js";
import { footballSchema, footballText, readFootballDecision } from "../src/fotbal/ai.js";
import { clubPages, czechDate, findMatch, newsKind, parseMatchDetail, parseMatchList, parseNewsDetail, parseNewsList, readClubUrl } from "../src/fotbal/club.js";
import { dateDoubts, datedWeekdays } from "../src/fotbal/dates.js";
import { clubSource, footballSourceDate, matchExtra } from "../src/fotbal/run.js";
import { footballDue, footballRunning } from "../src/fotbal/store.js";

const BASE = "https://www.fkkopidlno.cz/";

const HOME = `<a href="/cs/s/4-aktuality">Aktuality</a>
<a href="/cs/s/2-vysledky/13-fk-kopidlno-b">Výsledky</a>
<a href="/cs/s/2-vysledky/13-fk-kopidlno-b/3650-fk-kopidlno-b-tj-sokol-chomutice">Zápas</a>
<a href="/cs/s/2-vysledky/13-fk-kopidlno-b?do=setFilter&amp;key=s&amp;value=0">Filtr</a>`;

const NEWS = `<div class="news-item">
<a href="/cs/s/4-aktuality/962-tj-jiskra-horice-b-fk-kopidlno-b" class="news-item-img"><img src="/media/a.webp" alt=""></a>
<div class="news-item-date">30.09.2026</div>
<a href="/cs/s/4-aktuality/962-tj-jiskra-horice-b-fk-kopidlno-b" class="news-item-name">TJ Jiskra Hořice B - FK Kopidlno B</a>
</div>
<div class="news-item">
<div class="news-item-date">23.09.2026</div>
<a href="/cs/s/4-aktuality/960-fk-kopidlno-b-tj-sokol-chomutice-7-6-3-3" class="news-item-name">FK Kopidlno B - TJ Sokol Chomutice 7:6 (3:3)</a>
</div>
<div class="news-item">
<div class="news-item-date">10.09.2026</div>
<a href="/cs/s/4-aktuality/959-kronika-2025-2026" class="news-item-name">Kronika 2025 &amp; 2026</a>
</div>`;

const SIDEBAR = `<div class="table-box"><div class="table-box-top">Ligová tabulka</div>
<table><tr><td>1.</td><td>SK Robousy A</td><td>7</td><td>34:2</td><td>21</td></tr>
<tr><td>4.</td><td>FK Kopidlno B</td><td>7</td><td>27:21</td><td>12</td></tr></table>
<a href="/tabulky">Kompletní tabulka</a></div>
<div class="table-box"><div>Nejlepší střelci</div>
<div><span>1.</span><span>Miloš Kovář</span><span>7</span></div>
<div><span>2.</span><span>Michal Poutník</span><span>6</span></div>
<a href="/statistiky">Kompletní statistiky</a></div>`;

const DETAIL = `<head><meta property="og:image" content="https://www.fkkopidlno.cz/media/znak.webp"></head>
<div class="small-headline">23.09.2026</div>
<span class="tag">Autor: Vladimír Hnát</span>
<h1 class="mb-1">FK Kopidlno B - TJ Sokol Chomutice 7:6 (3:3)</h1>
<section class="text-section"><div class="mw-83">
<p>8. liga, <strong>čtvrtek 24. 9. 2026 od 16:30</strong></p>
<p><strong>Branky</strong>: Poutník 3, Kovář 2 – Petr 3.</p>
<p><img src="/media/foto.jpg" alt=""></p>
</div></section>
<a href="/cs/s/4-aktuality">Zpět na výpis</a>
${SIDEBAR}`;

const SCHEDULE = `<span>8. liga okresní přebor mužů - 2026 / 2027</span>
<a href="/cs/s/2-vysledky/13-fk-kopidlno-b/3650-fk-kopidlno-b-tj-sokol-chomutice" class="line-match-item">
<div class="line-match-item-title">8.kolo</div>
<div class="match-item-team-name">FK Kopidlno B</div>
<div class="line-match-item-score">7 : 6</div>
<div class="match-item-team-name">TJ Sokol Chomutice</div>
<div class="line-match-item-text-col"><span>Čt 24.09.2026 16:30</span></div>
</a>
<a href="/cs/s/2-vysledky/13-fk-kopidlno-b/3659-tj-jiskra-horice-b-fk-kopidlno-b" class="line-match-item">
<div class="line-match-item-title">9.kolo</div>
<div class="match-item-team-name">TJ Jiskra Hořice B</div>
<div class="line-match-item-score">:</div>
<div class="match-item-team-name">FK Kopidlno B</div>
<div class="line-match-item-text-col"><span>So 03.10.2026 16:00</span></div>
</a>`;

const MATCH = `<h3>Průběh zápasu</h3>
<div class="md-box-item"><div class="md-box-item-num">10'</div><div class="md-box-item-info">
<img src="/i.svg" title="Gól"></div><span class="md-box-item-player-name">M. Poutník</span></div>
<div class="md-box-item"><div class="md-box-item-num">64'</div><div class="md-box-item-info">
<img src="/i.svg" title="Žlutá karta"></div><span class="md-box-item-player-name">L. Komárek</span></div>
<h3>Sestavy</h3><div>ZÁKLADNÍ SESTAVY</div>
<span class="md-player-item-player-name">
Janda P.
</span><span class="md-player-item-player-name">Kovář M.</span>
<a>Zpět na rozpis</a>`;

test("web klubu: odkazy, aktuality a jejich druh", () => {
  assert.deepEqual(clubPages(HOME, BASE), {
    news: "https://www.fkkopidlno.cz/cs/s/4-aktuality",
    results: ["https://www.fkkopidlno.cz/cs/s/2-vysledky/13-fk-kopidlno-b"],
  });
  assert.equal(clubPages("", BASE).news, "https://www.fkkopidlno.cz/cs/s/4-aktuality");
  const news = parseNewsList(NEWS, BASE);
  assert.deepEqual(
    news.map((entry) => [entry.id, entry.date, newsKind(entry.title)]),
    [
      [962, "2026-09-30", "pozvanka"],
      [960, "2026-09-23", "zapas"],
      [959, "2026-09-10", "clanek"],
    ],
  );
  assert.equal(news[2].title, "Kronika 2025 & 2026");
  assert.equal(czechDate("Čt 24.09.2026 16:30"), "2026-09-24");
  assert.equal(czechDate("nic"), "");
  assert.equal(readClubUrl(""), BASE);
  assert.equal(readClubUrl("https://www.fkkopidlno.cz/cs/s/4-aktuality"), BASE);
  assert.equal(readClubUrl("http://www.fkkopidlno.cz"), "");
});

test("detail aktuality: text, fotka, znak, tabulka a střelci", () => {
  const detail = parseNewsDetail(DETAIL, BASE);
  assert.equal(detail.title, "FK Kopidlno B - TJ Sokol Chomutice 7:6 (3:3)");
  assert.equal(detail.date, "2026-09-23");
  assert.equal(detail.author, "Vladimír Hnát");
  assert.match(detail.text, /Branky: Poutník 3, Kovář 2 – Petr 3\./);
  assert.doesNotMatch(detail.text, /Zpět na výpis/);
  assert.deepEqual(detail.images, ["https://www.fkkopidlno.cz/media/foto.jpg"]);
  assert.equal(detail.cover, "https://www.fkkopidlno.cz/media/znak.webp");
  assert.equal(detail.table, "1. SK Robousy A 7 34:2 21\n4. FK Kopidlno B 7 27:21 12");
  assert.equal(detail.scorers, "1. Miloš Kovář 7\n2. Michal Poutník 6");
});

test("rozpis a detail zápasu se spárují s aktualitou", () => {
  const matches = parseMatchList(SCHEDULE, BASE);
  assert.equal(matches.length, 2);
  assert.deepEqual(
    { ...matches[0], url: undefined },
    { url: undefined, round: "8.kolo", home: "FK Kopidlno B", away: "TJ Sokol Chomutice", score: "7:6", date: "2026-09-24", time: "16:30", competition: "8. liga okresní přebor mužů - 2026 / 2027" },
  );
  assert.equal(matches[1].score, "");
  assert.equal(findMatch(matches, "FK Kopidlno B - TJ Sokol Chomutice 7:6 (3:3)"), matches[0]);
  assert.equal(findMatch(matches, "TJ Jiskra Horice B – FK Kopidlno B"), matches[1]);
  assert.equal(findMatch(matches, "Kronika 2025"), null);
  const detail = parseMatchDetail(MATCH);
  assert.match(detail, /10' Gól: M\. Poutník/);
  assert.match(detail, /64' Žlutá karta: L\. Komárek/);
  assert.match(detail, /Janda P\., Kovář M\./);
  const extra = matchExtra(matches[0], parseNewsDetail(DETAIL, BASE), detail);
  assert.match(extra, /8\. liga okresní přebor mužů - 2026 \/ 2027, 8\.kolo/);
  assert.match(extra, /výsledek 7:6/);
  assert.match(extra, /Tabulka soutěže teď:\n1\. SK Robousy A/);
  assert.match(matchExtra(matches[1], { table: "", scorers: "" }, ""), /ještě se nehrálo/);
  assert.equal(matchExtra(null, {}, ""), "");
});

test("Drběna dostane aktualitu s doplňky a její odpověď se ověří", () => {
  const item = { kind: "zapas", title: "FK Kopidlno B - TJ Sokol Chomutice 7:6 (3:3)", text: "Branky: Poutník 3.", extra: "Tabulka soutěže teď:\n1. SK Robousy A", publishedOn: "2026-09-23" };
  const text = footballText(item, { articles: [{ id: 4, title: "Kopidlno vyhrálo", excerpt: "", createdOn: "2026-09-25" }], proposals: [] }, { today: "2026-10-01" });
  assert.match(text, /druh: Po zápase/);
  assert.match(text, /\[zprava:4\] 2026-09-25 · Kopidlno vyhrálo/);
  assert.match(text, /Doplněno z rozpisu a tabulky/);
  assert.deepEqual(footballSchema().required, ["decision", "reason", "duplicate_of", "title", "excerpt", "body_html"]);

  const made = readFootballDecision({ decision: "vytvorit", reason: "Zápas.", duplicate_of: "", title: "Gólová přestřelka", excerpt: "Kopidlno B vyhrálo 7:6.", body_html: "<p>Mééé, sedm gólů!</p><script>x</script>" });
  assert.equal(made.ok, true);
  assert.equal(made.article.title, "Gólová přestřelka");
  assert.doesNotMatch(made.article.body, /script/);
  const duplicate = readFootballDecision({ decision: "duplicita", reason: "Už je.", duplicate_of: "zprava:4", title: "", excerpt: "", body_html: "" });
  assert.deepEqual([duplicate.decision, duplicate.duplicateOf, duplicate.article], ["duplicita", "zprava:4", null]);
  assert.equal(readFootballDecision({ decision: "vytvorit", reason: "", duplicate_of: "", title: "", excerpt: "", body_html: "" }).ok, false);
  assert.equal(readFootballDecision({ decision: "preskocit", reason: "", duplicate_of: "", title: "T", excerpt: "E", body_html: "<p>B</p>" }, { force: true }).ok, false);
  assert.equal(readFootballDecision(null).ok, false);
});

test("kdy se fotbal kontroluje a odkdy bere aktuality", () => {
  const now = new Date("2026-10-01T20:15:00Z");
  assert.equal(footballDue({ enabled: false, intervalHours: 24, checkedAt: "" }, now), false);
  assert.equal(footballDue({ enabled: true, intervalHours: 24, checkedAt: "" }, now), true);
  assert.equal(footballDue({ enabled: true, intervalHours: 24, checkedAt: "2026-10-01T00:15:00Z" }, now), false);
  assert.equal(footballDue({ enabled: true, intervalHours: 24, checkedAt: "2026-09-30T20:15:10Z" }, now), true);
  assert.equal(footballDue({ enabled: true, intervalHours: 24, checkedAt: "2026-10-01T16:15:00Z", status: "error" }, now), true);
  assert.equal(footballRunning({ runningAt: "2026-10-01T20:16:00.000Z-abc" }, now), true);
  assert.equal(footballRunning({ runningAt: "2026-10-01T20:14:00.000Z-abc" }, now), false);
  assert.equal(footballRunning({ runningAt: "" }, now), false);
  assert.match(clubSource("https://www.fkkopidlno.cz/a?b=1&c=2"), /href="https:\/\/www\.fkkopidlno\.cz\/a\?b=1&amp;c=2"/);
});

test("redakce fotbalu ukáže stav, aktuality, detail a nastavení", () => {
  const data = {
    signedIn: true,
    user: { id: 1, role: "hlavni", name: "Redakce", permissions: [] },
    hasApiKey: true,
    rubrics: [
      { id: 5, parentId: null, name: "Sport", slug: "sport" },
      { id: 9, parentId: 5, name: "Fotbal", slug: "fotbal" },
    ],
    footballSettings: { enabled: true, autoPublish: false, clubUrl: BASE, voice: "", rubricId: 9, previews: true, clubNews: false, useCrest: true, intervalHours: 24, checkedAt: "2026-10-01T09:00:00Z", status: "ok", note: "Nic nového." },
    footballItems: [
      { id: 3, guid: "960:zapas", kind: "zapas", link: "https://www.fkkopidlno.cz/cs/s/4-aktuality/960", title: "FK Kopidlno B - TJ Sokol Chomutice 7:6 (3:3)", text: "Branky: Poutník 3.", extra: "Tabulka soutěže teď:\n1. SK Robousy A", images: [], cover: "", publishedOn: "2026-09-23", status: "hotovo", reason: "Zápas.", duplicateOf: "", articleId: null, proposalId: 11 },
      { id: 4, guid: "959:clanek", kind: "clanek", link: "", title: "Kronika", text: "", extra: "", images: [], cover: "", publishedOn: "2026-09-10", status: "chyba", reason: "Claude neodpověděl.", duplicateOf: "", articleId: null, proposalId: null },
    ],
  };
  const page = adminFootball({ path: "/redakce/fotbal", copy: {}, mainOrigin: "", origin: "" }, data, { text: "", kind: "ok" }, { importId: 3, importSettings: false });
  assert.match(page, /<h1>Fotbal<\/h1>/);
  assert.match(page, /Zapnuto, jednou denně, články čekají na schválení\./);
  assert.match(page, /<a href="\/redakce\/zpravy\?navrh=11">Návrh zprávy #11<\/a>/);
  assert.match(page, /Po zápase/);
  assert.match(page, /Doplněno z rozpisu a tabulky/);
  assert.match(page, /<option value="9" selected>Fotbal<\/option>/);
  assert.match(page, /href="\/redakce\/drbena"/);
  assert.match(page, /href="\/redakce\/fotbal"[^>]*aria-current="page"/);
  assert.match(page, /adm-count[^>]*>1</);
  assert.doesNotMatch(page, /ANTHROPIC_API_KEY/);
});

test("když Drběna píše, redakce to ukáže a obnoví se; jinak řekne, kolik čeká", () => {
  const base = {
    signedIn: true,
    user: { id: 1, role: "hlavni", name: "Redakce", permissions: [] },
    hasApiKey: true,
    rubrics: [],
    footballItems: [
      { id: 2, guid: "1:zapas", kind: "zapas", link: "", title: "A - B 1:0", text: "", extra: "", images: [], cover: "", publishedOn: "2026-09-23", status: "nove", reason: "", duplicateOf: "", attempts: 0, articleId: null, proposalId: null },
      { id: 3, guid: "2:zapas", kind: "zapas", link: "", title: "C - D 1:0", text: "", extra: "", images: [], cover: "", publishedOn: "2026-09-23", status: "chyba", reason: "x", duplicateOf: "", attempts: 3, articleId: null, proposalId: null },
    ],
  };
  const settings = { enabled: true, autoPublish: false, clubUrl: BASE, voice: "", rubricId: null, previews: true, clubNews: false, useCrest: true, intervalHours: 24, checkedAt: "", status: "", note: "" };
  const ctx = { path: "/redakce/fotbal", copy: {}, mainOrigin: "", origin: "" };
  const busy = adminFootball(ctx, { ...base, footballSettings: { ...settings, runningAt: "2999-01-01T00:00:00.000Z-x" } }, { text: "", kind: "ok" }, { importId: 2 });
  assert.match(busy, /data-refresh="8"/);
  assert.match(busy, /Drběna právě píše/);
  const idle = adminFootball(ctx, { ...base, footballSettings: { ...settings, runningAt: "" } }, { text: "", kind: "ok" }, {});
  assert.doesNotMatch(idle, /data-refresh=/);
  assert.match(idle, /Na automatické zpracování čeká 1\. Dopíše je cron/);
  assert.match(idle, /name="ids" value="2" form="vyber-aktualit"/);
  assert.match(idle, /<form id="vyber-aktualit" method="post" action="\/redakce\/fotbal\/vybrat">/);
});

test("ručně načtené čekají na výběr, vybrané se píšou a stránka se obnovuje", () => {
  const row = (id, status, manual = false) => ({ id, guid: `${id}:zapas`, kind: "zapas", link: "", title: `Zápas ${id}`, text: "", extra: "", images: [], cover: "", publishedOn: "2026-09-23", status, reason: "", duplicateOf: "", attempts: 0, manual, articleId: null, proposalId: status === "hotovo" ? 4 : null });
  const data = {
    signedIn: true,
    user: { id: 1, role: "hlavni", name: "Redakce", permissions: [] },
    hasApiKey: true,
    rubrics: [],
    footballSettings: { enabled: false, autoPublish: false, clubUrl: BASE, voice: "", rubricId: null, previews: true, clubNews: false, useCrest: true, intervalHours: 24, checkedAt: "", status: "", note: "", runningAt: "" },
    footballItems: [row(1, "nacteno"), row(2, "hotovo"), row(3, "nove", true)],
  };
  const ctx = { path: "/redakce/fotbal", copy: {}, mainOrigin: "", origin: "" };
  const page = adminFootball(ctx, data, { text: "", kind: "ok" }, {});
  assert.match(page, /Načteno, čeká na výběr/);
  assert.match(page, /Vybráno, Drběna se k tomu dostane/);
  assert.match(page, /data-refresh="8"[^>]*>Drběna právě píše vybrané aktuality\. Jeden článek jí trvá asi půl minuty\. Vybraných zbývá 1\./);
  assert.match(page, /value="1" form="vyber-aktualit"/);
  assert.doesNotMatch(page, /value="2" form=/);
  assert.doesNotMatch(page, /value="3" form=/);
  const loaded = adminFootball(ctx, { ...data, footballItems: [row(1, "nacteno")] }, { text: "", kind: "ok" }, {});
  assert.match(loaded, /Načteno a čeká na výběr: 1\./);
  assert.match(loaded, /datum ze zdroje/);
});

test("ručně vybraný zápas dostane datum, kdy se hrál, nikdy ne budoucí", () => {
  const report = { kind: "zapas", publishedOn: "2026-09-23", text: "8. liga, čtvrtek 24. 9. 2026 od 16:30", extra: "Soutěž: 8. liga\n\nZápas: FK Kopidlno B – TJ Sokol Chomutice, 2026-09-24 16:30, výsledek 7:6" };
  assert.equal(footballSourceDate(report, "2026-10-01"), "2026-09-24");
  assert.equal(footballSourceDate({ ...report, extra: "" }, "2026-10-01"), "2026-09-24");
  assert.equal(footballSourceDate({ ...report, extra: "", text: "" }, "2026-10-01"), "2026-09-23");
  assert.equal(footballSourceDate({ kind: "pozvanka", publishedOn: "2026-09-30", text: "sobota 3. 10. 2026", extra: "" }, "2026-10-01"), "2026-09-30");
  assert.equal(footballSourceDate({ kind: "clanek", publishedOn: "2026-12-30", text: "", extra: "" }, "2026-10-01"), "");
});

test("den v týdnu, který nesedí na datum, se pozná a Drběna se o tom dozví", () => {
  const sunday = { kind: "pozvanka", title: "TJ Sokol Libuň - FK Kopidlno C", publishedOn: "2026-09-30", text: "9.liga - III. třída mužů, neděle 3. 10. 2026 od 16:00", extra: "" };
  assert.deepEqual(dateDoubts(sunday), ["„neděle 3. 10. 2026“: 3. 10. 2026 je sobota, ne neděle."]);
  assert.deepEqual(dateDoubts({ ...sunday, text: "sobota 3. 10. 2026 od 16:00" }), []);
  assert.deepEqual(dateDoubts({ ...sunday, text: "Hrajeme v neděli 4.10. od 16:00" }), []);
  assert.equal(dateDoubts({ ...sunday, text: "v neděli 3. října" }).length, 1);
  assert.equal(dateDoubts({ ...sunday, text: "v pátek 31. 9." })[0], "„pátek 31. 9.“ není skutečné datum.");
  assert.deepEqual(datedWeekdays("v sobotu 9. 1.", "2026-12-20").map((entry) => entry.date), ["2027-01-09"]);

  const planned = { ...sunday, text: "sobota 3. 10. 2026 od 16:00", extra: "Zápas: TJ Sokol Libuň – FK Kopidlno C, 2026-10-04 16:00, ještě se nehrálo" };
  assert.match(dateDoubts(planned)[0], /V rozpisu klubu je zápas 4\. 10\. 2026 \(neděle\)/);
  assert.deepEqual(dateDoubts({ ...planned, text: "neděle 4. 10. 2026" }), []);

  const text = footballText(sunday, { articles: [], proposals: [] }, { today: "2026-10-01", doubts: dateDoubts(sunday) });
  assert.match(text, /Pozor, datum ve zdroji nesedí/);
  assert.doesNotMatch(footballText(sunday, { articles: [], proposals: [] }, { today: "2026-10-01" }), /Pozor/);
});
