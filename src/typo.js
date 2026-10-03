// Česká typografie na webu: nezlomitelné mezery tam, kde se řádek zalomit nemá.
// Jednopísmenné předložky a spojky, číslo s tím, co počítá, datum, tituly a zkratky před jménem
// a pomlčka. Dělá se až při vykreslení, takže platí i pro starší zprávy a v databázi se nic nemění.
import { esc } from "./html.js";

const NBSP = " ";
const GAP = /[ \t\r\n]+/;
// Před slovem: začátek, mezera (i nezlomitelná), závorka nebo uvozovky.
const BEFORE = String.raw`(?<=^|[\s(„“"'«])`;
const SHORTS = "ksvzouaiKSVZOUAI";
const ABBREVIATIONS = ["Ing", "Mgr", "Bc", "MUDr", "MVDr", "MDDr", "PhDr", "JUDr", "RNDr", "PaedDr", "Dr", "doc", "prof", "p", "č", "čp", "tel", "sv", "ul", "nám", "str", "tzv", "cca"];

const RULES = [
  // v Kopidlně, a prvních, s rodinou
  new RegExp(`${BEFORE}([${SHORTS}])${GAP.source}(?=\\S|$)`, "gu"),
  // Ing. Tomáš, č. p. 86, tel. 731…
  new RegExp(`${BEFORE}((?:${ABBREVIATIONS.join("|")})\\.)${GAP.source}(?=\\S|$)`, "gu"),
  // 5. října, 5. 10. 2026
  new RegExp(`(?<=\\d)(\\.)${GAP.source}(?=\\d|\\p{Ll})`, "gu"),
  // 200 Kč, 17:00 hod., 3 děti
  new RegExp(`(?<=\\d)()${GAP.source}(?=\\p{L}|%)`, "gu"),
  // slovo – slovo: pomlčka nezačíná řádek
  new RegExp(`(?<=\\S)()${GAP.source}(?=[–—])`, "gu"),
];

export function tie(text) {
  let out = String(text ?? "");
  for (const rule of RULES) out = out.replace(rule, `$1${NBSP}`);
  return out;
}

// Totéž v hotovém HTML: mění jen text mezi značkami. Mezera na konci textu před značkou
// („V <strong>pondělí“) se sváže taky, slovo za ní je jen v jiném prvku.
export function tieHtml(html) {
  return String(html ?? "")
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith("<") ? part : tie(part.replace(/&nbsp;/g, NBSP))))
    .join("");
}

// esc a k tomu nezlomitelné mezery: pro nadpisy a perexy na webu, ne do atributů.
export function escTie(value) {
  return tie(esc(value));
}
