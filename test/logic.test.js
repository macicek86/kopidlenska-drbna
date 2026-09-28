import assert from "node:assert/strict";
import test from "node:test";
import { verifyPassword } from "../src/password.js";
import { countdownLabel } from "../src/format.js";
import { buildWasteView, isoWeek, pragueNow } from "../src/waste.js";
import { byline, knownPermissions, redactedFlag, textWasEdited, userCan } from "../src/db.js";
import { prepareArticleBody, renderArticleHtml } from "../src/rich.js";
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
    "Sběrný dvůr Kopidlno je dnes otevřený 08:00–16:00.",
  );
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "15:59"),
    "Sběrný dvůr Kopidlno je dnes otevřený 08:00–16:00.",
  );
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "07:30"),
    "Sběrný dvůr Kopidlno je dnes zavřený. Příště bude otevřený dnes od 08:00 do 16:00.",
  );
  assert.equal(
    statusLine(yard(saved.week), "2026-09-28", "16:00"),
    "Sběrný dvůr Kopidlno je dnes zavřený. Příště bude otevřený ve čtvrtek 1. 10. od 13:00 do 17:00.",
  );
  assert.equal(
    statusLine(yard(saved.week.filter((slot) => slot.day === 4)), "2026-09-28", "10:00"),
    "Sběrný dvůr Kopidlno je dnes zavřený. Příště bude otevřený ve čtvrtek 1. 10. od 13:00 do 17:00.",
  );
  assert.equal(
    statusLine(yard([day(1, "08:00", "16:00")]), "2026-10-04", "18:00"),
    "Sběrný dvůr Kopidlno je dnes zavřený. Příště bude otevřený zítra od 08:00 do 16:00.",
  );
  assert.equal(
    statusLine(
      yard([day(1, "08:00", "16:00")], [{ startsOn: "2026-09-28", endsOn: "2027-04-01", reason: "Rekonstrukce" }]),
      "2026-09-28",
      "18:00",
    ),
    "Sběrný dvůr Kopidlno je uzavřený do 1. 4. 2027. Rekonstrukce.",
  );
  assert.equal(
    statusLine(
      yard([day(1, "08:00", "16:00")], [{ startsOn: "2026-10-05", endsOn: "2026-10-05", reason: "Svátek" }]),
      "2026-10-04",
      "12:00",
    ),
    "Sběrný dvůr Kopidlno je dnes zavřený. Příště bude otevřený v pondělí 12. 10. od 08:00 do 16:00.",
  );
  assert.equal(hoursSummary(yard(saved.week)), "Po 08:00–16:00, Čt 13:00–17:00");
  assert.deepEqual(homeStatus(yard([day(1, "08:00", "16:00"), day(2, "09:00", "15:00")]), "2026-09-28", "10:00"), {
    kind: "open",
    name: "Sběrný dvůr Kopidlno",
    state: "Dnes otevřený",
    detail: "08:00–16:00",
    tomorrow: "Zítra od 09:00 do 15:00.",
  });
  assert.deepEqual(homeStatus(yard([day(1, "08:00", "16:00"), day(2, "09:00", "15:00")]), "2026-09-28", "18:00"), {
    kind: "closed",
    name: "Sběrný dvůr Kopidlno",
    state: "Dnes zavřený",
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
      state: "Uzavřený do 31. 10. 2026",
      detail: "Nikomu se nechce dělat.",
      tomorrow: "",
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
