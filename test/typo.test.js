import assert from "node:assert/strict";
import test from "node:test";
import { escTie, tie, tieHtml } from "../src/typo.js";

const show = (value) => value.replace(/ /g, "~");

test("tie sváže krátká slova, data, čísla, tituly a pomlčku", () => {
  assert.equal(
    show(tie("V pondělí 5. října 2026 od 17:00 hod. a v Kopidlně Ing. Tomáš, č. p. 86, za 200 Kč – zdarma (a taky)")),
    "V~pondělí 5.~října 2026~od 17:00~hod. a~v~Kopidlně Ing.~Tomáš, č.~p.~86, za 200~Kč~– zdarma (a~taky)",
  );
  assert.equal(show(tie("Konec věty 5. Pak dál")), "Konec věty 5. Pak dál");
  assert.equal(show(tie("dva slova bez ničeho")), "dva slova bez ničeho");
});

test("tieHtml mění jen text, ne značky, a sváže i slovo před značkou", () => {
  assert.equal(
    show(tieHtml(`<p>V <strong>pondělí</strong> a <a href="/a b" rel="noopener noreferrer">odkaz</a></p>`)),
    `<p>V~<strong>pondělí</strong> a~<a href="/a b" rel="noopener noreferrer">odkaz</a></p>`,
  );
});

test("escTie nejdřív escapuje", () => {
  assert.equal(show(escTie("<b> a v")), "&lt;b&gt; a~v");
});
