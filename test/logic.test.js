import assert from "node:assert/strict";
import test from "node:test";
import { verifyPassword } from "../src/password.js";
import { countdownLabel } from "../src/format.js";
import { buildWasteView, isoWeek, pragueNow } from "../src/waste.js";
import { pickAd, readAdFields, readSeenAd, safeAdLink, seenAdCookie } from "../src/ads.js";
import { byline, knownPermissions, redactedFlag, textWasEdited, userCan } from "../src/db.js";
import { facebookUrl, text } from "../src/copy.js";
import { prepareArticleBody, renderArticleHtml } from "../src/rich.js";
import { adPanel, eventsPage, homePage, layout, outagesPage } from "../src/view.js";
import { articlePage, newsPage } from "../src/news.js";
import { aboutPage, paragraphs } from "../src/about.js";
import { articleFigure, captionHtml, figureSide, focusClass, readCaption, readFocus, storyPhoto } from "../src/photo.js";
import { adminAds, adminOutages, adminRubrics } from "../src/admin/index.js";
import { articleInRubric, deleteRubricError, findRubric, parseRubricInput, rubricLabel } from "../src/rubrics.js";
import {
  boardJson,
  buildBoard,
  fetchAreaOutages,
  feedIsStale,
  mergeFresh,
  normalizeTownPayload,
  outageSpan,
  parseAreaInput,
  placeLabel,
  refreshNote,
} from "../src/outages.js";
import {
  DOCTOR_SEEDS,
  HOME_LEAD_DAYS,
  changeSpan,
  homeNotice,
  hoursSummary as doctorHoursSummary,
  normalizeWeek as normalizeDoctorWeek,
  visibleHomeChange,
} from "../src/doctors.js";
import { closureSpan, coversDay, homeStatus, hoursSummary, normalizeWeek, statusLine } from "../src/yards.js";

const SEED =
  "pbkdf2:6b6f7069646c656e736b612d6472626e612d7631:71910d0f1a33b6ce8f9647f30734fbf39e392f5194eaa5fcfc68df6730249132";

test("výchozí heslo sedí na hash v D1", async () => {
  assert.equal(await verifyPassword("Drbna2026", SEED), true);
  assert.equal(await verifyPassword("jiné", SEED), false);
});

test("odpočet bere texty z redakce a nechá {n}", () => {
  assert.equal(countdownLabel(0), "Svoz je dnes.");
  assert.equal(countdownLabel(1), "Svoz je zítra.");
  assert.equal(countdownLabel(3), "Za 3 dny.");
  assert.equal(countdownLabel(7), "Za 7 dní.");
  assert.equal(countdownLabel(7, { countdown_many: "Ještě {n} dnů." }), "Ještě 7 dnů.");
});

test("redakční zásah se pozná podle textu, ne podle fotky", () => {
  const submitted = {
    title: "Trh",
    excerpt: "V sobotu.",
    body: "Sousede, v sobotu je trh.",
    category: "Zprávy",
  };
  const same = { ...submitted };
  const fixed = { ...submitted, body: "Sousedé, v sobotu je trh." };
  assert.equal(textWasEdited(submitted, same), false);
  assert.equal(textWasEdited(submitted, fixed), true);
  assert.equal(redactedFlag(false, submitted, same), false);
  assert.equal(redactedFlag(false, submitted, fixed), true);
  assert.equal(redactedFlag(true, submitted, same), true);
});

test("formátování nechá nadpisy a odrážky a skript zahodí", () => {
  const dirty = [
    "<h2>Trh</h2>",
    "<p>V <b>sobotu</b> a <em>neděli</em>.</p>",
    "<ul><li>housky</li><li>med</li></ul>",
    "<blockquote>Přijďte včas.</blockquote>",
    '<script>alert(1)</script>',
    '<a href="javascript:alert(1)">neklikejte</a>',
    '<a href="&#106;avascript:alert(1)">ani tady</a>',
    '<a href="https://kopidlno.cz" onclick="alert(1)">web města</a>',
    '<img src=x onerror="alert(1)">',
    '<p onclick="alert(1)">poznámka</p>',
  ].join("");
  const clean = prepareArticleBody(dirty);
  assert.match(clean.html, /<h2>Trh<\/h2>/);
  assert.match(clean.html, /<strong>sobotu<\/strong>/);
  assert.match(clean.html, /<ul><li>housky<\/li><li>med<\/li><\/ul>/);
  assert.match(clean.html, /<blockquote><p>Přijďte včas\.<\/p><\/blockquote>/);
  assert.match(clean.html, /href="https:\/\/kopidlno\.cz"/);
  assert.equal(clean.html.includes("<script"), false);
  assert.equal(clean.html.includes("javascript"), false);
  assert.equal(clean.html.includes("onerror"), false);
  assert.equal(clean.html.includes("onclick"), false);
  assert.equal(clean.html.includes("alert"), false);
  assert.match(clean.html, /neklikejte/);
  assert.equal(renderArticleHtml(dirty), clean.html);
  assert.equal(prepareArticleBody("Ahoj\n\nsousedé").html, "<p>Ahoj</p><p>sousedé</p>");
  assert.equal(prepareArticleBody("<div>Ahoj</div><div>sousedé</div>").html, "<p>Ahoj</p><p>sousedé</p>");
  assert.equal(prepareArticleBody("<p>V <u>sobotu</u>.<br></p>").html, "<p>V <u>sobotu</u>.</p>");
  assert.equal(prepareArticleBody("<h3>Podnadpis</h3>").html, "<h3>Podnadpis</h3>");
  assert.equal(
    prepareArticleBody("<ul><li>a<ul><li>b</li></ul></li></ul>").html,
    "<ul><li>a<ul><li>b</li></ul></li></ul>",
  );
  assert.equal(prepareArticleBody('<div><script>alert(1)</script><p onclick="x">Ahoj</p></div>').html.includes("script"), false);
  assert.equal(
    textWasEdited(
      { title: "A", excerpt: "B", body: "Ahoj\n\nsousedé", category: "Zprávy" },
      { title: "A", excerpt: "B", body: "<p>Ahoj</p><p onclick=\"x\">sousedé</p>", category: "Zprávy" },
    ),
    false,
  );
});

test("alias má přednost před jménem pod článkem", () => {
  assert.equal(byline({ name: "Jana Nováková", alias: "Jana z návsi" }), "Jana z návsi");
  assert.equal(byline({ authorName: "Jana Nováková", authorAlias: "Jana z návsi" }), "Jana z návsi");
  assert.equal(byline({ name: "Jana Nováková", alias: "  " }), "Jana Nováková");
  assert.equal(byline({ authorName: "Redakce" }), "Redakce");
  assert.equal(byline(null), "");
});

test("oprávnění na sběrný dvůr má hlavní redaktor vždy a přispěvatel jen když ho dostane", () => {
  assert.equal(userCan({ role: "hlavni", permissions: [] }, "sberny_dvur"), true);
  assert.equal(userCan({ role: "prispevovatel", permissions: ["sberny_dvur"] }, "sberny_dvur"), true);
  assert.equal(userCan({ role: "prispevovatel", permissions: [] }, "sberny_dvur"), false);
  assert.equal(userCan(null, "sberny_dvur"), false);
  assert.deepEqual(knownPermissions(["sberny_dvur", "sberny_dvur", "cizi"]), ["sberny_dvur"]);
});

test("mimořádné uzavření drží rozmezí a pozná dnešek", () => {
  assert.equal(closureSpan("", "").error, "Doplňte den, od kdy je zavřeno.");
  assert.equal(closureSpan("2026-02-31", "").error, "Doplňte den, od kdy je zavřeno.");
  assert.deepEqual(closureSpan("2026-10-05", ""), { startsOn: "2026-10-05", endsOn: "2026-10-05" });
  assert.deepEqual(closureSpan("2026-10-05", "2026-10-07"), { startsOn: "2026-10-05", endsOn: "2026-10-07" });
  assert.equal(closureSpan("2026-10-07", "2026-10-05").error, "Konec uzavření musí být stejný den, nebo později.");
  const span = closureSpan("2026-10-05", "2026-10-07");
  assert.equal(coversDay(span, "2026-10-06"), true);
  assert.equal(coversDay(span, "2026-10-04"), false);
  assert.equal(coversDay(span, "2026-10-07"), true);
});

function yard(week, closures = []) {
  return { name: "Sběrný dvůr Kopidlno", week, legacy: "", closures };
}

function day(day, from, to) {
  return { day, open: true, from, to };
}

test("otevírací doba se počítá po dnech a mimořádné zavření má přednost", () => {
  const monday = [day(1, "08:00", "16:00")];
  assert.equal(normalizeWeek([]).error, "Zaškrtněte aspoň jeden den, kdy má otevřeno.");
  assert.equal(normalizeWeek([{ day: 1, open: true, from: "16:00", to: "08:00" }]).error.includes("později"), true);
  const saved = normalizeWeek([{ day: 1, open: true, from: "8:00", to: "16:00" }, { day: 4, open: true, from: "13:00", to: "17:00" }]);
  assert.equal(saved.week.find((slot) => slot.day === 1).from, "08:00");
  assert.equal(saved.week.find((slot) => slot.day === 2).open, false);
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "10:00"),
    "Sběrný dvůr Kopidlno je teď otevřený, dnes 08:00–16:00. Zítra má zavřeno.",
  );
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "15:59"),
    "Sběrný dvůr Kopidlno je teď otevřený, dnes 08:00–16:00. Zítra má zavřeno.",
  );
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "07:30"),
    "Sběrný dvůr Kopidlno dnes otevře v 08:00 a má otevřeno do 16:00. Zítra má zavřeno.",
  );
  assert.equal(statusLine(yard(saved.week), "2026-09-28", "07:30").includes("zavřený"), false);
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "16:00"),
    "Sběrný dvůr Kopidlno má dnes už zavřeno. Příště otevře ve čtvrtek 1. 10. od 13:00 do 17:00.",
  );
  assert.equal(
    statusLine(yard(saved.week.filter((slot) => slot.day === 4)), "2026-09-28", "10:00"),
    "Sběrný dvůr Kopidlno má dnes zavřeno. Příště otevře ve čtvrtek 1. 10. od 13:00 do 17:00.",
  );
  assert.equal(
    statusLine(yard([day(1, "08:00", "16:00")]), "2026-10-04", "18:00"),
    "Sběrný dvůr Kopidlno má dnes zavřeno. Zítra otevře od 08:00 do 16:00.",
  );
  assert.equal(
    statusLine(
      yard([day(1, "08:00", "16:00")], [{ startsOn: "2026-09-28", endsOn: "2027-04-01", reason: "Rekonstrukce" }]),
      "2026-09-28",
      "18:00",
    ),
    "Sběrný dvůr Kopidlno je mimořádně zavřený do 1. 4. 2027. Rekonstrukce. Otevře znovu v pondělí 5. 4. 2027 od 08:00 do 16:00.",
  );
  assert.equal(
    statusLine(
      yard([day(1, "08:00", "16:00")], [{ startsOn: "2026-10-05", endsOn: "2026-10-05", reason: "Svátek" }]),
      "2026-10-04",
      "12:00",
    ),
    "Sběrný dvůr Kopidlno má dnes zavřeno. Zítra je mimořádně zavřený. Svátek. Příště otevře v pondělí 12. 10. od 08:00 do 16:00.",
  );
  assert.equal(
    statusLine(yard([day(2, "13:00", "17:00")]), "2026-09-29", "09:00"),
    "Sběrný dvůr Kopidlno dnes otevře v 13:00 a má otevřeno do 17:00. Zítra má zavřeno.",
  );
  assert.equal(
    statusLine(
      yard([day(1, "08:00", "16:00"), day(3, "09:00", "15:00")], [{ startsOn: "2026-09-29", endsOn: "2026-09-29", reason: "Inventura" }]),
      "2026-09-28",
      "10:00",
    ),
    "Sběrný dvůr Kopidlno je teď otevřený, dnes 08:00–16:00. Zítra je mimořádně zavřený. Inventura. Otevře znovu ve středu 30. 9. od 09:00 do 15:00.",
  );
  assert.equal(hoursSummary(yard(saved.week)), "Po 08:00–16:00, Čt 13:00–17:00");
  assert.deepEqual(homeStatus(yard([day(1, "08:00", "16:00"), day(2, "09:00", "15:00")]), "2026-09-28", "10:00"), {
    kind: "open",
    name: "Sběrný dvůr Kopidlno",
    state: "Teď otevřený",
    detail: "08:00–16:00",
    tomorrow: "Zítra od 09:00 do 15:00.",
  });
  assert.deepEqual(homeStatus(yard([day(1, "08:00", "16:00"), day(2, "09:00", "15:00")]), "2026-09-28", "07:30"), {
    kind: "later",
    name: "Sběrný dvůr Kopidlno",
    state: "Otevře v 08:00",
    detail: "Dnes do 16:00.",
    tomorrow: "Zítra od 09:00 do 15:00.",
  });
  assert.deepEqual(homeStatus(yard([day(1, "08:00", "16:00"), day(2, "09:00", "15:00")]), "2026-09-28", "18:00"), {
    kind: "closed",
    name: "Sběrný dvůr Kopidlno",
    state: "Dnes už zavřený",
    detail: "Zítra od 09:00 do 15:00.",
    tomorrow: "",
  });
  assert.deepEqual(
    homeStatus(
      yard([day(1, "08:00", "16:00")], [{ startsOn: "2026-09-28", endsOn: "2026-10-31", reason: "Nikomu se nechce dělat." }]),
      "2026-09-28",
      "10:00",
    ),
    {
      kind: "closure",
      name: "Sběrný dvůr Kopidlno",
      state: "Mimořádně zavřený do 31. 10. 2026",
      detail: "Nikomu se nechce dělat.",
      tomorrow: "Otevře znovu v pondělí 2. 11. od 08:00 do 16:00.",
    },
  );
  assert.deepEqual(
    homeStatus(
      yard([day(1, "08:00", "16:00")], [{ startsOn: "2026-09-28", endsOn: "2026-09-28", reason: "Inventura" }]),
      "2026-09-28",
      "10:00",
    ),
    {
      kind: "closure",
      name: "Sběrný dvůr Kopidlno",
      state: "Dnes mimořádně zavřený",
      detail: "Inventura",
      tomorrow: "Otevře znovu v pondělí 5. 10. od 08:00 do 16:00.",
    },
  );
});

test("hodiny se berou z Prahy, ne z času workeru", () => {
  assert.deepEqual(pragueNow(new Date("2026-09-28T14:05:00Z")), { date: "2026-09-28", time: "16:05" });
  assert.deepEqual(pragueNow(new Date("2026-09-28T22:30:00Z")), { date: "2026-09-29", time: "00:30" });
  assert.deepEqual(pragueNow(new Date("2026-12-01T15:30:00Z")), { date: "2026-12-01", time: "16:30" });
});

test("28. 9. 2026 je sudý týden, další svoz je 5. 10.", () => {
  assert.equal(isoWeek("2026-09-28") % 2, 0);
  const waste = buildWasteView(
    { weekday: 1, weekParity: 1, stepDays: 14, note: "", holidayNote: "" },
    "2026-09-28",
  );
  assert.equal(waste.nextDate, "2026-10-05");
  assert.equal(waste.daysUntil, 7);
  assert.equal(waste.upcoming[1], "2026-10-19");
});

function half(from, to, note = "") {
  return { open: true, from, to, note };
}

function doctor(name, changes = [], week = []) {
  return { name, specialty: "Praktický lékař", week, changes };
}

test("ordinační hodiny mají dopoledne a odpoledne a nesmí se překrývat", () => {
  const saved = normalizeDoctorWeek([
    { day: 1, morning: half("7:00", "12:00", " jen pro objednané "), afternoon: half("13:00", "17:00", "jen akutní případy") },
    { day: 4, morning: half("8:00", "11:00"), afternoon: { open: false, from: "", to: "", note: "" } },
  ]);
  assert.equal(saved.error, undefined);
  assert.equal(saved.week.find((slot) => slot.day === 1).morning.note, "jen pro objednané");
  assert.equal(saved.week.find((slot) => slot.day === 1).afternoon.from, "13:00");
  assert.equal(saved.week.find((slot) => slot.day === 2).morning.open, false);
  assert.equal(
    normalizeDoctorWeek([{ day: 1, morning: half("08:00", "13:00"), afternoon: half("12:00", "16:00") }]).error,
    "Pondělí: odpoledne musí začít až po dopoledni, ať se časy nepřekrývají.",
  );
  assert.equal(normalizeDoctorWeek([{ day: 3, morning: half("10:00", "09:00") }]).error.includes("později"), true);
  assert.equal(doctorHoursSummary(doctor("MUDr. Eva Nová", [], saved.week)).includes("Po dopoledne 07:00–12:00, jen pro objednané"), true);
  assert.equal(doctorHoursSummary(doctor("MUDr. Eva Nová")), "Ordinační hodiny zatím nejsou doplněné");
  const office = DOCTOR_SEEDS[0];
  assert.equal(normalizeDoctorWeek(office.week).error, undefined);
  assert.equal(office.week.find((slot) => slot.day === 1).afternoon.to, "18:00");
  assert.equal(DOCTOR_SEEDS.map((item) => item.name).join(", "), "Ordinace Kopidlno, MUDr. Lubomír Klíma, MUDr. Jaroslava Lelková");
});

test("dočasná změna se na titulce ukáže 14 dní předem a jméno se neskloňuje", () => {
  assert.equal(HOME_LEAD_DAYS, 14);
  assert.equal(changeSpan("2026-10-06", "").endsOn, "2026-10-06");
  assert.equal(changeSpan("2026-10-08", "2026-10-06").error.includes("později"), true);
  const closed = {
    id: 1,
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
    note: "Akutní případy ošetří ordinace v Jičíně.",
    week: [],
  };
  const tooFar = { ...closed, id: 2, startsOn: "2026-10-13", endsOn: "2026-10-13" };
  const practice = doctor("Ordinace Kopidlno", [tooFar]);
  assert.equal(homeNotice(practice, "2026-09-28"), null);
  const onTime = doctor("MUDr. Jaroslava Lelková", [closed]);
  assert.equal(homeNotice(onTime, "2026-09-28").state, "Má od 12. 10. do 16. 10. zavřeno.");
  assert.equal(homeNotice(onTime, "2026-09-28").name, "MUDr. Jaroslava Lelková");
  const klima = doctor("MUDr. Lubomír Klíma", [{ ...closed, id: 3, startsOn: "2026-10-06", endsOn: "2026-10-06" }]);
  assert.equal(homeNotice(klima, "2026-09-28").state, "Má 6. 10. zavřeno.");
  const changed = doctor("MUDr. Lubomír Klíma", [
    {
      id: 4,
      startsOn: "2026-10-05",
      endsOn: "2026-10-09",
      note: "Sestra přítomna, zastupuje MUDr. Novák.",
      week: [{ day: 1, morning: half("08:00", "11:00", "jen akutní případy"), afternoon: { open: false } }],
    },
  ]);
  const notice = homeNotice(changed, "2026-09-28");
  assert.equal(notice.state, "Má od 5. 10. do 9. 10. jiné ordinační hodiny.");
  assert.equal(notice.detail, "Po dopoledne 08:00–11:00, jen akutní případy");
  assert.equal(notice.note, "Sestra přítomna, zastupuje MUDr. Novák.");
  const overlapping = doctor("Ordinace Kopidlno", [
    { id: 1, startsOn: "2026-09-20", endsOn: "2026-10-20", note: "starší", week: [] },
    { id: 2, startsOn: "2026-09-28", endsOn: "2026-09-30", note: "novější", week: [] },
  ]);
  assert.equal(visibleHomeChange(overlapping, "2026-09-28").id, 2);
  assert.equal(homeNotice(overlapping, "2026-09-28").note, "novější");
});

test("odkaz reklamy pustí jen obyčejnou adresu", () => {
  assert.equal(safeAdLink(""), "");
  assert.equal(safeAdLink("  www.pekarna.cz/sobota  "), "https://www.pekarna.cz/sobota");
  assert.equal(safeAdLink("mailto:soused@example.com"), "mailto:soused@example.com");
  assert.equal(safeAdLink("/reklamy"), "/reklamy");
  assert.equal(safeAdLink("javascript:alert(1)").error.length > 0, true);
  assert.equal(safeAdLink("//zle.example").error.length > 0, true);
  const fields = readAdFields({
    title: "  Chléb  ",
    body: "V sobotu\n od sedmi.",
    place: "Náměstí",
    link: "https://example.com",
    enabled: true,
  });
  assert.equal(fields.title, "Chléb");
  assert.equal(fields.body, "V sobotu od sedmi.");
  assert.equal(fields.enabled, true);
  assert.equal(readAdFields({ title: "A", body: "text nabídky", link: "" }).error, "Doplňte název.");
  assert.equal(readAdFields({ title: "Chléb", body: "  ", enabled: 0 }).error, "Doplňte text nabídky.");
});

test("panel reklamy se při načtení střídá a je označený", () => {
  const ads = [
    { id: 3, title: "C" },
    { id: 1, title: "A" },
    { id: 2, title: "B" },
  ];
  assert.equal(pickAd([]), null);
  assert.equal(pickAd(ads, { random: () => 0 }).id, 1);
  assert.equal(pickAd(ads, { random: () => 0.4 }).id, 2);
  assert.equal(pickAd(ads, { random: () => 0.9 }).id, 3);
  assert.equal(pickAd(ads, { avoidId: 1, random: () => 0 }).id, 2);
  assert.equal(pickAd(ads, { avoidId: 1, random: () => 0.9 }).id, 3);
  assert.equal(pickAd([{ id: 5, title: "jen" }], { avoidId: 5, random: () => 0 }).id, 5);
  let previous = null;
  for (let i = 0; i < 20; i += 1) {
    const id = pickAd(ads, { avoidId: previous }).id;
    assert.ok([1, 2, 3].includes(id));
    if (previous != null) assert.notEqual(id, previous);
    previous = id;
  }
  assert.equal(readSeenAd("drbna_editor=abc; drbna_reklama=12"), 12);
  assert.equal(readSeenAd("drbna_reklama=nope"), null);
  assert.match(seenAdCookie(4, true), /drbna_reklama=4/);
  assert.match(seenAdCookie(4, true), /Secure/);
  assert.equal(seenAdCookie(4, false).includes("Secure"), false);

  const html = adPanel(
    {
      id: 1,
      slug: "chleb",
      title: `<script>alert(1)</script>`,
      body: "a & b",
      place: "Náměstí",
      link: "javascript:alert(1)",
      imageKey: null,
      sample: true,
      authorName: "Eva",
      createdOn: "2026-09-01",
    },
    {},
  );
  assert.equal(html.includes("<script"), false);
  assert.match(html, /Reklama/);
  assert.match(html, /ukázka/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
  assert.equal(html.includes("javascript"), false);
  assert.match(html, /href="\/reklamy\/chleb"/);
});

test("reklama se vloží do zpráv a v redakci má náhled", () => {
  const ctx = { path: "/", copy: {}, minimal: false, mainOrigin: "http://127.0.0.1:8787" };
  const waste = {
    today: "2026-09-29",
    nextDate: "2026-10-05",
    daysUntil: 6,
    note: "Poznámka.",
    holidayNote: "I o svátcích",
    weekday: 1,
    weekParity: 1,
    stepDays: 14,
  };
  const ad = {
    id: 1,
    slug: "chleb",
    title: "Čerstvý chléb",
    body: "V sobotu od sedmi.",
    place: "Náměstí",
    link: "https://example.com/chleb",
    imageKey: "reklamy/demo.webp",
    sample: true,
    enabled: true,
    authorName: "Redakce",
    createdOn: "2026-09-29",
  };
  const bare = { articles: [], events: [], yards: [], doctors: [], waste, ads: [], contactNote: "" };
  assert.equal(homePage(bare, ctx).includes("ad-panel"), false);
  const home = homePage({ ...bare, ads: [ad] }, ctx);
  assert.match(home, /class="ad-panel has-photo"/);
  assert.match(home, /Reklama/);
  // JSON-LD je jen data (CSP ho nehlídá), jiný skript než vlastní menu na titulce být nemá.
  assert.doesNotMatch(home, /<script(?! type="application\/ld\+json")(?! src="\/nav\.js")/);
  const pinned = homePage(
    { ...bare, ads: [ad, { ...ad, id: 2, slug: "kolo", title: "Seřízení kola" }], ad },
    ctx,
  );
  assert.match(pinned, /Čerstvý chléb/);
  assert.equal(pinned.includes("Seřízení kola"), false);

  const articles = [1, 2, 3].map((id) => ({
    id,
    slug: `zprava-${id}`,
    title: `Zpráva ${id}`,
    excerpt: "Perex zprávy.",
    body: "Text.",
    category: "Zprávy",
    imageKey: null,
    createdOn: "2026-09-01",
    authorName: "",
  }));
  const news = newsPage({ ...bare, articles, ads: [ad] }, { ...ctx, path: "/zpravy" }, "");
  const panelAt = news.indexOf("ad-panel");
  const thirdAt = news.indexOf("Zpráva 3");
  assert.ok(panelAt > news.indexOf("Zpráva 1"));
  assert.ok(panelAt < thirdAt);

  const many = Array.from({ length: 20 }, (_, i) => ({ ...articles[0], id: i + 1, slug: `z-${i + 1}`, title: `Zpráva ${i + 1}` }));
  const others = [ad, { ...ad, id: 2, slug: "druha", title: "Druhá nabídka" }, { ...ad, id: 3, slug: "treti", title: "Třetí nabídka" }];
  const long = newsPage({ ...bare, articles: many, ads: others, ad }, { ...ctx, path: "/zpravy" }, "");
  assert.equal(long.match(/class="ad-panel/g).length, 3);
  assert.match(long, /Druhá nabídka/);
  assert.match(long, /Třetí nabídka/);
  const day = (n) => `2026-${String(Math.floor(n / 28) + 1).padStart(2, "0")}-${String((n % 28) + 1).padStart(2, "0")}`;
  const events = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `Akce ${i + 1}`, place: "Sál", startsOn: day(i) }));
  const eventsHtml = eventsPage({ ...bare, events, waste: { today: "2026-12-31" }, ads: others, ad }, { ...ctx, path: "/akce" });
  assert.equal(eventsHtml.match(/class="ad-panel/g).length, 3);
  assert.ok(eventsHtml.indexOf("ad-slot") < eventsHtml.indexOf("Akce 25"));
  const fewEvents = eventsPage({ ...bare, events: events.slice(0, 9), waste: { today: "2026-12-31" }, ads: others, ad }, { ...ctx, path: "/akce" });
  assert.equal(fewEvents.match(/class="ad-panel/g).length, 1);
  const lonely = newsPage({ ...bare, articles: many, ads: [ad], ad }, { ...ctx, path: "/zpravy" }, "");
  assert.equal(lonely.match(/class="ad-panel/g).length, 1);

  const framed = adPanel({ ...ad, imageKey: "reklamy/a.webp", imageFocus: "30 70" }, ctx.copy);
  assert.match(framed, /class="ad-photo fx-3 fy-7"/);
  const solo = adPanel({ ...ad, imageKey: "reklamy/a.webp", imageFocus: "30 70" }, ctx.copy, { heading: "h1" });
  assert.match(solo, /class="ad-photo"/);
  assert.equal(readAdFields({ title: "Kolo", body: "Seřídím.", imageFocus: "33 71" }).imageFocus, "30 70");

  const article = articlePage(articles[0], ctx, { ad, more: [articles[1]] });
  assert.match(article, /ad-slot/);
  assert.match(article, /class="more-news"/);
  assert.match(article, new RegExp(`href="/zpravy/${articles[1].slug}"`));
  assert.doesNotMatch(articlePage(articles[0], ctx, { ad: null }), /article-side/);
  assert.match(article, /href="https:\/\/example.com\/chleb"/);
  assert.match(article, /rel="noopener noreferrer"/);

  const desk = adminAds(
    { ...ctx, path: "/redakce" },
    {
      signedIn: true,
      user: { id: 1, role: "hlavni", name: "Redakce" },
      ads: [ad],
      proposals: [],
      showDefaultPassword: false,
    },
    { text: "", kind: "ok" },
    {},
  );
  assert.match(desk, /data-ad-form/);
  assert.match(desk, /data-ad-preview/);
  assert.match(desk, /data-edge="960"/);
  assert.match(desk, /data-bytes="180000"/);
  assert.match(desk, />Vypnout</);
  assert.match(desk, /action="\/redakce\/reklamy\/ulozit"/);
  assert.match(desk, /Jde na web hned/);
  const queued = adminAds(
    { ...ctx, path: "/redakce" },
    {
      signedIn: true,
      user: { id: 1, role: "hlavni", name: "Redakce" },
      ads: [ad],
      adProposals: [
        {
          id: 4,
          adId: null,
          title: "Vejce",
          body: "Ráno na okně.",
          place: "Drahoraz",
          link: "",
          imageKey: null,
          enabled: true,
          status: "pending",
          note: "",
          authorName: "Jana",
          authorAlias: "",
        },
      ],
      proposals: [],
      showDefaultPassword: false,
    },
    { text: "", kind: "ok" },
    { proposalId: 4 },
  );
  assert.match(queued, /Reklamy<\/span><b class="adm-count"[^>]*>1<\/b>/);
  assert.match(queued, /Schválit a zveřejnit/);
  assert.match(queued, /action="\/redakce\/reklamy\/schvalit"/);
  assert.match(queued, /action="\/redakce\/reklamy\/vratit"/);
  const contributor = adminAds(
    { ...ctx, path: "/redakce" },
    {
      signedIn: true,
      user: { id: 8, role: "prispevovatel", name: "Jana" },
      ads: [{ ...ad, authorId: 1 }],
      proposals: [],
      showDefaultPassword: false,
    },
    { text: "", kind: "ok" },
    {},
  );
  assert.equal(contributor.includes(">Vypnout<"), false);
  assert.equal(contributor.includes("/redakce/reklamy/ulozit"), false);
  assert.match(contributor, /data-ad-preview/);
  assert.match(contributor, /action="\/redakce\/reklamy\/navrh"/);
  assert.match(contributor, /Poslat ke schválení/);
  const own = adminAds(
    { ...ctx, path: "/redakce" },
    {
      signedIn: true,
      user: { id: 8, role: "prispevovatel", name: "Jana" },
      ads: [{ ...ad, authorId: 8, authorName: "Jana" }],
      adProposals: [],
      proposals: [],
      showDefaultPassword: false,
    },
    { text: "", kind: "ok" },
    { editingId: 1 },
  );
  assert.match(own, /name="nabidka" value="1"/);
  assert.match(own, /Poslat návrh/);
  assert.match(own, />Vypnout</);
});

test("popis titulky nemluví o popelnicích, stránka svozu ano", () => {
  const home = text({}, "home_description");
  assert.equal(home.includes("popelnic"), false);
  assert.match(text({}, "bins_description"), /svoz/);
  const html = layout({
    title: "Kopidlenská drbna",
    description: home,
    path: "/",
    origin: "https://kopidlenska-drbna.camledian.workers.dev",
    body: "",
    copy: {},
  });
  assert.match(html, /property="og:description" content="Místní zprávy a pozvánky pro Kopidlno a jeho části."/);
});

test("sdílení má og obrázek 1200×630", () => {
  const origin = "https://kopidlenska-drbna.camledian.workers.dev";
  const html = layout({
    title: "Kopidlenská drbna",
    description: 'Zprávy & pozvánky "z Kopidlna".',
    path: "/zpravy",
    origin,
    body: "",
    copy: {},
  });
  assert.match(html, /property="og:image" content="https:\/\/kopidlenska-drbna\.camledian\.workers\.dev\/og\.webp"/);
  assert.match(html, /property="og:image:type" content="image\/webp"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /property="og:url" content="https:\/\/kopidlenska-drbna\.camledian\.workers\.dev\/zpravy"/);
  assert.match(html, /property="og:description" content="Zprávy &amp; pozvánky &quot;z Kopidlna&quot;."/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:image:alt" content="Kopidlenská drbna"/);
});

const JICIN_OUTAGE = {
  outages: null,
  outages_in_town: [
    {
      id: "110061121360",
      announcement_key: "pdf/301307931-daqcb65ct0gcmo4g4m8g.pdf",
      opened_at: "2026-10-15T06:30:00Z",
      fix_expected_at: "2026-10-15T10:30:00Z",
      addresses: {
        towns: [
          {
            name: "Jičín",
            code: 572659,
            district: "Jičín",
            cadastral_territories: [{ name: "Jičín", code: 659541, plots: [{ cadastral_code: "659541", plot: "2290" }] }],
            town_districts: [
              {
                town_parts: [
                  {
                    name: "Holínské Předměstí",
                    streets: [{ name: "Jiráskova", house_nums: "44", ev_nums: "", street_nums: "" }],
                  },
                  {
                    name: "Pševes",
                    streets: [{ name: "", house_nums: "12", ev_nums: "3", street_nums: "5" }],
                  },
                ],
              },
            ],
          },
        ],
        orphan_territories: [{ plots: [{ cadastral_code: "669171", plot: "2290" }] }],
      },
    },
  ],
};

test("odpověď widgetu ČEZ se složí do adres, parcel a odkazu na oznámení", () => {
  const empty = normalizeTownPayload({ outages: null }, { code: "573060", name: "Kopidlno" });
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.outages, []);
  assert.equal(normalizeTownPayload({ outages_in_town: {} }, { code: "573060", name: "Kopidlno" }).ok, false);

  const parsed = normalizeTownPayload(JICIN_OUTAGE, { code: "572659", name: "Jičín" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.outages.length, 1);
  const outage = parsed.outages[0];
  assert.equal(outage.id, "110061121360");
  assert.equal(outage.areaCode, "572659");
  assert.equal(outage.announcementUrl, "https://cdn.bezstavy.cz/pdf/301307931-daqcb65ct0gcmo4g4m8g.pdf");
  assert.equal(outage.places[0].street, "Jiráskova");
  assert.equal(outage.places[0].houseNums, "44");
  assert.equal(outage.places[0].evNums, null);
  assert.equal(outage.places[1].street, null);
  assert.equal(outage.places[1].houseNums, "12");
  assert.equal(outage.places[1].evNums, "3");
  assert.equal(outage.places[1].streetNums, "5");
  assert.equal(placeLabel(outage.places[1]), "Pševes, Jičín · bez ulice · popisná 12, evidenční 3, orientační 5");
  assert.deepEqual(outage.parcels, [
    { cadastralCode: "659541", plot: "2290" },
    { cadastralCode: "669171", plot: "2290" },
  ]);
  assert.equal(outageSpan(outage), "Čtvrtek 15. října, 08:30–12:30");
  assert.equal(
    normalizeTownPayload(
      {
        outages_in_town: [
          { id: "1", opened_at: "2026-10-15T06:30:00Z" },
          { id: "1", opened_at: "2026-10-16T06:30:00Z" },
        ],
        outages: [{ id: "1", opened_at: "2026-10-17T06:30:00Z" }],
      },
      { code: "573060", name: "Kopidlno" },
    ).outages.length,
    1,
  );
  assert.equal(normalizeTownPayload({ outages_in_town: [{ announcement_key: "https://evil.test/a.pdf" }] }, { code: "573060", name: "Kopidlno" }).outages.length, 0);
  const badLink = normalizeTownPayload(
    { outages_in_town: [{ id: "9", announcement_key: "pdf/../tajne.pdf" }] },
    { code: "573060", name: "Kopidlno" },
  );
  assert.equal(badLink.outages[0].announcementUrl, null);
});

test("probíhající a blízká odstávka se ukáže, skončená zmizí", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const area = [{ code: "573060", name: "Kopidlno" }];
  const row = (id, openedAt, fixExpectedAt) => ({
    id,
    areaCode: "573060",
    openedAt,
    fixExpectedAt,
    announcementUrl: null,
    places: [],
    parcels: [],
  });
  const board = buildBoard({
    fetchedAt: "2026-09-30T10:00:00.000Z",
    status: "ok",
    areas: area,
    now,
    outages: [
      row("past", "2026-09-30T05:00:00Z", "2026-09-30T08:00:00Z"),
      row("now", "2026-09-30T06:00:00Z", "2026-09-30T16:00:00Z"),
      row("soon", "2026-10-07T06:30:00Z", "2026-10-07T10:30:00Z"),
      row("later", "2026-10-08T06:30:00Z", "2026-10-08T10:30:00Z"),
    ],
  });
  assert.deepEqual(board.items.map((item) => item.id), ["now", "soon", "later"]);
  assert.deepEqual(board.items.map((item) => item.phase), ["now", "soon", "later"]);
  assert.equal(board.checked, "Naposledy ověřeno 30. 9. 2026 v 12:00.");
  assert.equal(feedIsStale({ fetchedAt: null }, now.getTime()), true);
  assert.equal(feedIsStale({ fetchedAt: "2026-09-30T09:00:00.000Z" }, now.getTime()), false);
  assert.equal(feedIsStale({ fetchedAt: "2026-09-30T03:00:00.000Z" }, now.getTime()), true);

  const evening = normalizeTownPayload(
    {
      outages_in_town: [
        { id: "noc", opened_at: "2026-10-15T20:00:00Z", fix_expected_at: "2026-10-16T04:00:00Z" },
      ],
    },
    { code: "573060", name: "Kopidlno" },
  ).outages[0];
  assert.equal(outageSpan(evening), "Čtvrtek 15. října 22:00 – pátek 16. října 06:00");

  const json = boardJson(board);
  assert.equal(json.outages[0].area_code, "573060");
  assert.equal(json.outages[0].state, "Právě probíhá");
  assert.equal(json.fetched_at, "2026-09-30T10:00:00.000Z");
});

test("víc obcí se ptá postupně a neúspěch nenechá smazat starší přehled", async () => {
  const slept = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ outages: null });
    if (calls === 5) return Response.json({ outages_in_town: "špatně" });
    return Response.json({ outages: null, outages_in_town: [] });
  };
  const areas = [1, 2, 3, 4, 5].map((n) => ({ code: `10000${n}`, name: `Obec ${n}` }));
  const results = await fetchAreaOutages(areas, {
    fetchImpl,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  assert.equal(results[0].ok, true);
  assert.equal(results[0].outages.length, 0);
  assert.deepEqual(slept, [1100]);
  assert.equal(results[4].ok, false);
  assert.equal(refreshNote(results).status, "partial");
  assert.match(refreshNote(results).note, /Obec 5/);

  let retries = 0;
  const [retried] = await fetchAreaOutages([{ code: "573060", name: "Kopidlno" }], {
    fetchImpl: async () => {
      retries += 1;
      if (retries === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
      return Response.json({
        outages: null,
        outages_in_town: [{ id: 7, opened_at: "2026-10-15T06:30:00Z", announcement_key: "/pdf/a.pdf" }],
      });
    },
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.outages[0].id, "7");
  assert.equal(retried.outages[0].announcementUrl, "https://cdn.bezstavy.cz/pdf/a.pdf");
  assert.equal(slept.at(-1), 1000);

  const merged = mergeFresh(
    [{ id: "stara", areaCode: "573060" }, { id: "jinde", areaCode: "572659" }],
    [
      { ok: false, code: "573060", name: "Kopidlno", outages: [] },
      { ok: true, code: "572659", name: "Jičín", outages: [{ id: "nova", areaCode: "572659" }] },
    ],
  );
  assert.deepEqual(merged.map((item) => item.id), ["nova", "stara"]);
  assert.equal(refreshNote([{ ok: false, code: "1", name: "Kopidlno" }]).status, "error");
  assert.equal(parseAreaInput({ name: "  Kopidlno  ", code: "573060", enabled: true, sortOrder: "0" }).area.sortOrder, 0);
  assert.equal(parseAreaInput({ name: "X", code: "573060" }).ok, false);
  assert.match(parseAreaInput({ name: "Libáň", code: "12" }).error, /šest číslic/);
});

test("stránka odstávek bere uložený přehled a na titulce je jen blízká", () => {
  const now = new Date("2026-09-30T10:00:00.000Z");
  const soon = buildBoard({
    fetchedAt: "2026-09-30T10:00:00.000Z",
    areas: [{ code: "573060", name: "Kopidlno" }],
    now,
    outages: [
      {
        id: "1",
        areaCode: "573060",
        openedAt: "2026-10-05T06:30:00Z",
        fixExpectedAt: "2026-10-05T08:30:00Z",
        announcementUrl: "https://cdn.bezstavy.cz/pdf/a.pdf",
        places: [
          {
            town: "<script>",
            part: "Pševes",
            street: "Jiráskova",
            houseNums: "44",
            evNums: null,
            streetNums: null,
            district: "Jičín",
          },
        ],
        parcels: [{ cadastralCode: "659541", plot: "2290" }],
      },
    ],
  });
  const page = outagesPage({ outages: soon }, { path: "/odstavky", copy: {}, origin: "http://127.0.0.1:8787" });
  assert.equal(page.includes("<script>"), false);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /cdn\.bezstavy\.cz\/pdf\/a\.pdf/);
  assert.equal(page.includes("api.bezstavy.cz"), false);
  assert.match(page, /Chystá se/);
  assert.match(page, /Parcela 2290/);
  assert.match(page, /href="https:\/\/www\.bezstavy\.cz\/"/);

  const ctx = { path: "/", copy: {}, minimal: false, mainOrigin: "http://127.0.0.1:8787" };
  const waste = {
    today: "2026-09-30",
    nextDate: "2026-10-05",
    daysUntil: 5,
    note: "",
    holidayNote: "",
    weekday: 1,
    weekParity: 1,
    stepDays: 14,
  };
  const bare = { articles: [], events: [], yards: [], doctors: [], waste, ads: [], contactNote: "" };
  const plain = homePage(bare, ctx);
  const teased = homePage({ ...bare, outages: soon }, ctx);
  assert.equal(plain.includes("Chystá se"), false);
  assert.match(teased, /Chystá se/);
  assert.equal((teased.match(/href="\/odstavky"/g) ?? []).length, (plain.match(/href="\/odstavky"/g) ?? []).length + 1);

  const later = buildBoard({
    fetchedAt: "2026-09-30T10:00:00.000Z",
    areas: [{ code: "573060", name: "Kopidlno" }],
    now,
    outages: [
      {
        id: "2",
        areaCode: "573060",
        openedAt: "2026-11-01T06:30:00Z",
        fixExpectedAt: "2026-11-01T10:30:00Z",
        announcementUrl: null,
        places: [],
        parcels: [],
      },
    ],
  });
  const quiet = homePage({ ...bare, outages: later }, ctx);
  assert.equal(quiet.includes("Naplánováno"), false);
  const desk = adminOutages(
    { path: "/redakce", copy: {} },
    {
      signedIn: true,
      user: { role: "hlavni", name: "Redakce" },
      showDefaultPassword: false,
      outageAreas: [
        { id: 1, code: "573060", name: "Kopidlno", enabled: true, sortOrder: 0 },
        { id: 2, code: "572659", name: "Jičín", enabled: false, sortOrder: 10 },
      ],
      outages: soon,
    },
    "",
    { confirmId: 2 },
  );
  assert.match(desk, /name="areaOn" value="1" checked/);
  assert.match(desk, /name="areaOn" value="2"/);
  assert.equal(desk.includes('value="2" checked'), false);
  assert.match(desk, /Drahoraz, Mlýnec, Pševes a Ledkov/);
  assert.match(desk, /Smazat obec Jičín/);
  assert.match(desk, /Na webu se hledá v: Kopidlno/);
});

test("rubriku jde přidat, podrubrika patří jen pod hlavní a smazání hlídá zprávy", () => {
  const sport = { id: 1, parentId: null, name: "Sport", slug: "sport", sortOrder: 10 };
  const fotbal = { id: 2, parentId: 1, name: "Fotbal", slug: "fotbal", sortOrder: 20 };
  const rubrics = [sport, fotbal];
  assert.equal(parseRubricInput({ name: "Hokej", parentId: 1, sortOrder: "30" }, rubrics).name, "Hokej");
  assert.equal(parseRubricInput({ name: " ", sortOrder: "0" }, rubrics).error, "Doplňte název rubriky.");
  assert.equal(parseRubricInput({ name: "fotbal", parentId: 1, sortOrder: "30" }, rubrics).error, "Rubrika s tímhle názvem už je.");
  assert.equal(
    parseRubricInput({ id: 1, name: "Sport", parentId: 4, sortOrder: "10" }, [...rubrics, { id: 4, parentId: null, name: "Kultura" }]).error,
    "Rubrika s podrubrikami nemůže být sama podrubrikou.",
  );
  assert.equal(parseRubricInput({ name: "Dorost", parentId: 2, sortOrder: "10" }, rubrics).error, "Podrubrika může patřit jen pod hlavní rubriku.");
  assert.equal(deleteRubricError(sport, { children: 1, articles: 0, proposals: 0, topLevel: 2 }), "Nejdřív odeberte podrubriky.");
  assert.equal(
    deleteRubricError(fotbal, { children: 0, articles: 2, proposals: 0, topLevel: 2 }),
    "V téhle rubrice jsou zprávy nebo návrhy. Nejdřív je přesuňte jinam.",
  );
  assert.equal(deleteRubricError(sport, { children: 0, articles: 0, proposals: 0, topLevel: 1 }), "Aspoň jedna rubrika musí zůstat.");
  assert.equal(deleteRubricError(fotbal, { children: 0, articles: 0, proposals: 0, topLevel: 2 }), "");
});

test("filtr sportu zahrne fotbal a podrubrika se ukáže až po výběru", () => {
  const rubrics = [
    { id: 1, parentId: null, name: "Sport", slug: "sport", sortOrder: 50, articleCount: 0 },
    { id: 2, parentId: 1, name: "Fotbal", slug: "fotbal", sortOrder: 10, articleCount: 1 },
    { id: 3, parentId: null, name: "Kultura", slug: "kultura", sortOrder: 30, articleCount: 1 },
  ];
  const zapas = {
    id: 1,
    slug: "zapas",
    title: "Zápas",
    excerpt: "V sobotu.",
    body: "Text.",
    category: "Fotbal",
    rubricId: 2,
    parentName: "Sport",
    imageKey: null,
    createdOn: "2026-09-01",
    authorName: "",
  };
  const koncert = {
    ...zapas,
    id: 2,
    slug: "koncert",
    title: "Koncert",
    category: "Kultura",
    rubricId: 3,
    parentName: "",
  };
  assert.equal(rubricLabel(zapas), "Sport · Fotbal");
  assert.equal(findRubric(rubrics, "Sport")?.id, 1);
  assert.equal(findRubric(rubrics, "fotbal")?.id, 2);
  assert.equal(articleInRubric(zapas, rubrics[0], rubrics), true);
  assert.equal(articleInRubric(koncert, rubrics[0], rubrics), false);
  assert.equal(articleInRubric(zapas, rubrics[1], rubrics), true);
  assert.equal(articleInRubric(koncert, rubrics[1], rubrics), false);
  const ctx = { path: "/zpravy", copy: {}, minimal: false, mainOrigin: "http://127.0.0.1:8787" };
  const data = { articles: [zapas, koncert], ads: [], rubrics };
  const all = newsPage(data, ctx, "");
  assert.match(all, /href="\/zpravy\?rubrika=sport"/);
  assert.equal(all.includes("rubrika=fotbal"), false);
  assert.equal(all.includes("rubric-sub"), false);
  assert.match(all, /class="rubric-tab has-sub" href="\/zpravy\?rubrika=sport"/);
  assert.match(all, /2 zprávy/);
  assert.match(all, /Zápas/);
  assert.match(all, /Koncert/);
  const sport = newsPage(data, ctx, "sport");
  assert.match(sport, /class="rubric-sub"/);
  assert.match(sport, /Všechno<span class="sub-count">1<\/span>/);
  assert.equal(sport.includes("rubrika=kultura"), true);
  assert.match(sport, /href="\/zpravy\?rubrika=fotbal"/);
  assert.match(sport, /Zápas/);
  assert.equal(sport.includes("Koncert"), false);
  assert.match(sport, /<h1>Sport<\/h1>/);
  const fotbal = newsPage(data, ctx, "Fotbal");
  assert.match(fotbal, /<title>Sport · Fotbal \|/);
  assert.match(fotbal, /<h1>Fotbal<\/h1>/);
  assert.match(fotbal, /class="sub-chip is-on" href="\/zpravy\?rubrika=fotbal" aria-current="page"/);
  assert.match(fotbal, /class="crumbs"[^]*rubrika=sport">Sport<\/a>/);
  assert.match(fotbal, /Zápas/);
  assert.equal(fotbal.includes("Koncert"), false);
  const desk = adminRubrics(
    { path: "/redakce", copy: {} },
    { signedIn: true, user: { role: "hlavni", name: "Redakce" }, showDefaultPassword: false, rubrics },
    "",
    {},
  );
  assert.match(desk, /Nová rubrika/);
  assert.match(desk, /action="\/redakce\/rubriky\/ulozit"/);
  assert.match(desk, /Hlavní rubrika/);
  assert.match(desk, /Podrubrika · Sport/);
  assert.match(desk, />Fotbal</);
  assert.match(desk, /href="\/redakce\/rubriky"/);
});

test("stránka O nás dělí volný text na odstavce", () => {
  assert.deepEqual(paragraphs("První.\r\n\r\nDruhý\nřádek.\n  \n\nTřetí."), ["První.", "Druhý\nřádek.", "Třetí."]);
  const html = aboutPage({ contactNote: "Pište na <drbna>" }, { path: "/o-nas", copy: { about_body: "Úvod.\n\nDalší <b>odstavec</b>." } });
  assert.match(html, /<p class="lede">Úvod\.<\/p>/);
  assert.match(html, /<p>Další &lt;b&gt;odstavec&lt;\/b&gt;\.<\/p>/);
  assert.match(html, /Pište na &lt;drbna&gt;/);
});

test("bod výřezu fotky se zaokrouhlí na desítky a nese ho třída", () => {
  assert.equal(readFocus("47 28"), "50 30");
  assert.equal(readFocus("-5 140"), "0 100");
  assert.equal(readFocus(""), "");
  assert.equal(readFocus("50"), "");
  assert.equal(readFocus("x 20"), "");
  assert.equal(focusClass("50 30"), "fx-5 fy-3");
  assert.equal(focusClass(""), "");
  // Plakát se neořezává.
  assert.equal(readFocus("cele"), "cele");
  assert.equal(focusClass("cele"), "is-whole");
  const card = storyPhoto({ imageKey: "clanky/a.webp", imageFocus: "20 80" }, "story-photo");
  assert.match(card, /class="story-photo fx-2 fy-8"/);
  assert.doesNotMatch(card, /style=/);
  assert.equal(storyPhoto({ imageKey: null }, "cover"), "");
});

test("detail zprávy ukáže fotku celou a pod ní popisek", () => {
  assert.equal(readCaption("  Foto:\n  Jana  "), "Foto: Jana");
  assert.equal(readCaption("x".repeat(300)).length, 200);
  const html = articleFigure({ imageKey: "clanky/a.webp", imageCaption: "Foto: <Jana>" });
  assert.match(html, /<figcaption>Foto: &lt;Jana&gt;<\/figcaption>/);
  assert.match(html, /class="article-photo"/);
  assert.doesNotMatch(articleFigure({ imageKey: "clanky/a.webp", imageCaption: "" }), /figcaption/);
});

test("fotka v detailu stojí u zprávy pořád na stejné straně, mezi zprávami se střídá", () => {
  const sides = ["a", "b", "c", "d", "e", "f"].map((slug) => figureSide({ slug }));
  assert.deepEqual(new Set(sides), new Set(["left", "right"]));
  assert.equal(figureSide({ slug: "pout" }), figureSide({ slug: "pout" }));
  assert.match(articleFigure({ slug: "pout", imageKey: "clanky/a.webp" }), /article-figure is-(left|right)/);
});

test("popisek fotky prolinkuje licenci Creative Commons", () => {
  assert.equal(
    captionHtml("Foto: Petr, CC BY-SA 4.0"),
    'Foto: Petr, <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.cs" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>',
  );
  assert.match(captionHtml("CC BY 3.0"), /licenses\/by\/3\.0\//);
  assert.match(captionHtml("Foto: CC0"), /publicdomain\/zero\/1\.0/);
  assert.equal(captionHtml("Foto: <b>Jana</b>"), "Foto: &lt;b&gt;Jana&lt;/b&gt;");
});

test("titulka u odstávky ukáže pár míst a kolik jich je ještě", async () => {
  const { teaserPlaces } = await import("../src/outages-view.js");
  const placeLabels = ["Tomáše Svobody (od náměstí k Policii ČR)", "Bédy Křídla", "Vackova", "Hilmarova", "Husova", "Na Sklípku", "Crhova", "Na Vinici", "náměstí (polovina)"];
  assert.equal(teaserPlaces({ placeLabels }), "Tomáše Svobody, Bédy Křídla, Vackova a dalších 6 míst");
  assert.equal(teaserPlaces({ placeLabels: ["Husova"] }), "Husova");
  assert.equal(teaserPlaces({ placeLabels: ["Husova"], morePlaces: 1 }), "Husova a ještě 1 místo");
  assert.equal(teaserPlaces({ placeLabels: ["Husova"], morePlaces: 7 }), "Husova a dalších 7 míst");
  assert.equal(teaserPlaces({}), "");
});

test("odkaz na Facebook jde upravit i vypnout pomlčkou", () => {
  assert.equal(facebookUrl({}), "https://www.facebook.com/groups/kopidlenskadrbna");
  assert.equal(facebookUrl({ facebook_url: "-" }), "");
  assert.equal(facebookUrl({ facebook_url: "javascript:alert(1)" }), "");
  const page = layout({ title: "T", path: "/", body: "", copy: {} });
  assert.match(page, /<footer>[\s\S]*facebook\.com\/groups\/kopidlenskadrbna[\s\S]*<\/footer>/);
  assert.doesNotMatch(layout({ title: "T", path: "/", body: "", copy: { facebook_url: "-" } }), /facebook\.com\/groups/);
});

test("služby jsou v menu pod Praktické, na mobilu na konci", () => {
  const page = layout({ path: "/odstavky", copy: {}, title: "T", description: "", body: "" });
  const desktop = page.match(/<nav class="nav" aria-label="Hlavní">(.*?)<\/nav>/s)[1];
  assert.match(desktop, /<summary class="nav-link is-on">Praktické<\/summary><div class="nav-drop">.*href="\/popelnice".*href="\/odstavky".*<\/div><\/details><a class="nav-link" href="\/reklamy">/s);
  assert.match(desktop, /^<a class="nav-link" href="\/zpravy">/);
  const mobile = page.match(/<nav aria-label="Mobilní">(.*?)<\/nav>/s)[1];
  assert.match(mobile, /href="\/o-nas">O nás<\/a><p class="nav-head">Praktické<\/p><a class="nav-link" href="\/popelnice">/);
  assert.match(page, /<script src="\/nav\.js" defer><\/script>/);
  const news = layout({ path: "/zpravy", copy: {}, title: "T", description: "", body: "" });
  assert.match(news, /<summary class="nav-link">Praktické<\/summary>/);
});
