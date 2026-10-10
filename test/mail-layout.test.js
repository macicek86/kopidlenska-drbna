import assert from "node:assert/strict";
import test from "node:test";
import { mailButtons, mailParagraphs, mailShell, MAIL_LOGO } from "../src/mail-layout.js";
import { noticeMail } from "../src/notify.js";

test("obálka e-mailu: logo s popiskem, styly přímo v prvcích, text se escapuje", () => {
  const html = mailShell({ preheader: "Úvod", body: mailParagraphs("A <b>&\nB") + mailButtons([{ label: "Schválit", url: "https://x/?a=1&b=2", tone: "primary" }]) });
  assert.match(html, new RegExp(`<img src="${MAIL_LOGO.replace(/[.]/g, "\\.")}"[^>]*alt="Kopidlenská drbna"`));
  assert.doesNotMatch(html, /<style|class=/);
  assert.match(html, /A &lt;b&gt;&amp;<br>B/);
  assert.match(html, /href="https:\/\/x\/\?a=1&amp;b=2"/);
  assert.match(html, /display:none[^>]*>Úvod</);
});

test("upozornění redakci jde do obálky a bez odkazu nemá tlačítko", () => {
  const withLink = noticeMail({ subject: "S", intro: "Úvod", fields: [["Kdo", "Jana"]], link: "https://www.kopidlenskadrbna.org/redakce" });
  assert.match(withLink.html, /Otevřít v redakci/);
  assert.match(withLink.html, /mail-logo\.png/);
  assert.doesNotMatch(noticeMail({ subject: "S", intro: "Úvod" }).html, /Otevřít v redakci/);
  assert.match(withLink.text, /V redakci: https/);
});
