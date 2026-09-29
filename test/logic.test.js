import assert from "node:assert/strict";
import test from "node:test";
import { verifyPassword } from "../src/password.js";
import { countdownLabel } from "../src/format.js";
import { buildWasteView, isoWeek, pragueNow } from "../src/waste.js";
import { pickAd, readAdFields, readSeenAd, safeAdLink, seenAdCookie } from "../src/ads.js";
import { byline, knownPermissions, redactedFlag, textWasEdited, userCan } from "../src/db.js";
import { prepareArticleBody, renderArticleHtml } from "../src/rich.js";
import { adPanel, adminAds, articlePage, homePage, newsPage } from "../src/view.js";
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
  assert.equal(home.includes("<script"), false);
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

  const article = articlePage(articles[0], ctx, { ad });
  assert.match(article, /ad-slot/);
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
  assert.match(queued, /Reklamy \(1\)/);
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
