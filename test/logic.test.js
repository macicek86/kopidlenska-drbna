import assert from "node:assert/strict";
import test from "node:test";
import { verifyPassword } from "../src/password.js";
import { countdownLabel } from "../src/format.js";
import { buildWasteView, isoWeek } from "../src/waste.js";
import { redactedFlag, textWasEdited } from "../src/db.js";
import { prepareArticleBody, renderArticleHtml } from "../src/rich.js";

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
