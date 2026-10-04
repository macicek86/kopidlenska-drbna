import assert from "node:assert/strict";
import test from "node:test";
import { welcomeTemplate } from "../src/welcome.js";
import { layout } from "../src/view.js";
import { adminTexts } from "../src/admin/settings.js";

test("uvítací okno je v šabloně s výčtem, výzvou a zkušebním provozem", () => {
  const html = welcomeTemplate({}, false);
  assert.match(html, /^<template data-welcome="1">/);
  assert.match(html, /<dialog class="welcome"/);
  assert.match(html, /<ul><li>zprávy z\u00a0Kopidlna/);
  assert.match(html, /<a href="\/o-nas">/);
  assert.match(html, /zkušebním provozu/);
  assert.match(html, /data-welcome-close>Rozumím</);
  // Bez chatu ani tlačítko, ani věta o chatu.
  assert.doesNotMatch(html, /data-chat-open/);
  assert.doesNotMatch(html, /Sedí vpravo dole/);
});

test("se zapnutým chatem uvítací okno nabídne zeptat se Drběny", () => {
  const html = welcomeTemplate({}, true);
  assert.match(html, /data-welcome-close data-chat-open="">Zeptat se Drběny</);
  assert.match(html, /Sedí vpravo dole/);
});

test("text redakce: odstavce, výčet a escapování", () => {
  const html = welcomeTemplate({ welcome_body: "Ahoj <b>sousedé</b>\n\n- jedna\n- dvě\n\nKonec\nřádek" }, false);
  assert.match(html, /<p>Ahoj &lt;b&gt;sousedé&lt;\/b&gt;<\/p>/);
  assert.match(html, /<ul><li>jedna<\/li><li>dvě<\/li><\/ul>/);
  assert.match(html, /<p>Konec<br>řádek<\/p>/);
});

test("pomlčka uvítací okno vypne i se skriptem", () => {
  assert.equal(welcomeTemplate({ welcome_body: " - " }, true), "");
  const page = layout({ title: "T", description: "D", path: "/", body: "", copy: { welcome_body: "-" } });
  assert.doesNotMatch(page, /welcome/);
  assert.match(layout({ title: "T", description: "D", path: "/", body: "", copy: {} }), /<script src="\/welcome\.js" defer>/);
});

test("zvednutá verze jde do šablony, redakce ji nabídne zvednout", () => {
  assert.match(welcomeTemplate({ welcome_version: "1791100000000" }, false), /^<template data-welcome="1791100000000">/);
  const page = adminTexts({ copy: { welcome_version: "1791100000000" } }, { signedIn: true, user: { role: "hlavni" }, contactNote: "x" }, null);
  assert.match(page, /name="welcome_again"/);
  assert.match(page, /Naposledy znovu ukázáno/);
});
