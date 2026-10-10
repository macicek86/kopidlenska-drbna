// Ruční zkouška e-mailu na otevírací dobu s pravým Claudem: nehezky napsané věty a co z nich Drběna vyčte.
// Stojí pár korun (jedno volání Haiku na větu), proto není v `npm run check`. Každá chyba z produkce přibude jako řádek.
// Spuštění: node scripts/mail-nuance.mjs   (klíč ANTHROPIC_API_KEY z .dev.vars nebo z prostředí)
import { readFileSync } from "node:fs";
import { callClaude } from "../src/claude.js";
import { calendarText, mailSchema, MAIL_SYSTEM } from "../src/mailin/ai.js";

const apiKey = process.env.ANTHROPIC_API_KEY || readFileSync(new URL("../.dev.vars", import.meta.url), "utf8").match(/ANTHROPIC_API_KEY=(.*)/)?.[1]?.trim().replace(/^["']|["']$/g, "");
const env = { ANTHROPIC_API_KEY: apiKey };
const today = "2026-10-10"; // sobota
const weekday = 6;
const ROWS = {
  8: "[misto:8] Duhovka (mateřské centrum) · po 7:30–12:00 a 13:00–16:00, út 7:30–14:00, st–pá 7:30–12:00 a 13:00–16:00",
  3: "[misto:3] Knihovna · po, st 8:00–12:00 a 13:00–17:00, pá 8:00–12:00",
  5: "[misto:5] KVC · po–pá 9:00–17:00",
};
const overview = (ids) => `Otevírací doba míst:\n${ids.map((id) => ROWS[id]).join("\n")}\n\nLékaři:\n(nic)`;

// Dny, které změna pokrývá.
function days(from, to) {
  const out = [];
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) out.push(day.toISOString().slice(0, 10));
  return out;
}
const key = (target, kind, day, close, open) => `${target}|${kind}|${day}|${close}|${open}`;
function covered(changes) {
  const set = new Set();
  for (const c of changes) for (const day of days(c.starts_on, c.ends_on || c.starts_on)) set.add(key(c.target.replace(/^\[|\]$/g, ""), c.kind, day, c.close_at ?? "", c.open_from ?? ""));
  return set;
}

// ids: místa, která adresa spravuje (jedno = e-mail nemusí místo jmenovat).
// expect: [{ t, kind, on: den | [od, do], close, open }], nebo "nejasne" / "neni_doba" / "slots" (prodloužení: časy, ne close_at/open_from).
const T = (id, kind, on, extra = {}) => ({ t: `misto:${id}`, kind, on, ...extra });
const CASES = [
  [[8], "Bude mít zavřeno v úterý a ve čtvrtek jen do 15 hodin", [T(8, "zavreno", "2026-10-13"), T(8, "docasna", "2026-10-15", { close: "15:00" })]],
  [[8], "ve stredu zavreno ve ctvrtek az od 10 v patek normal", [T(8, "zavreno", "2026-10-14"), T(8, "docasna", "2026-10-15", { open: "10:00" })]],
  [[8, 3, 5], "duhovka dnes zavreno", [T(8, "zavreno", "2026-10-10")]],
  [[8], "dnes zavreno", [T(8, "zavreno", "2026-10-10")]],
  [[8], "zitra do 12", [T(8, "docasna", "2026-10-11", { close: "12:00" })]],
  [[8], "pristi tyden zavreno dovolena", [T(8, "zavreno", ["2026-10-12", "2026-10-18"])]],
  [[8, 3, 5], "Knihovna v pondeli zavřeno v pátek jen do 10 děkuji", [T(3, "zavreno", "2026-10-12"), T(3, "docasna", "2026-10-16", { close: "10:00" })]],
  [[8, 3, 5], "kvc zavreno 20.10 a 21.10", [T(5, "zavreno", ["2026-10-20", "2026-10-21"])]],
  [[8], "dnes otevřeno do 18", "slots"],
  [[8], "v utery otevirame uz v 7", "slots"],
  [[8], "dobry den ve ctvrtek mame skoleni takze prijdte az po obede od 13", [T(8, "docasna", "2026-10-15", { open: "13:00" })]],
  [[8, 3, 5], "vsechno zavreno od 19.10 do 23.10 skoleni", [T(8, "zavreno", ["2026-10-19", "2026-10-23"]), T(3, "zavreno", ["2026-10-19", "2026-10-23"]), T(5, "zavreno", ["2026-10-19", "2026-10-23"])]],
  [[8, 3, 5], "zavreno", "nejasne"],
  [[8], "dekuju za clanek moc se povedl", "neni_doba"],
];

let bad = 0;
for (const [ids, text, expect] of CASES) {
  const content = [
    `Dnes je sobota ${today} (10. října 2026).`,
    calendarText(today, weekday),
    "Odesílatel: spravce@example.cz",
    `Co smí měnit:\n${overview(ids)}`,
    `Předmět: (bez předmětu)\n\nText e-mailu:\n${text}`,
  ].join("\n\n");
  const answer = await callClaude(env, { system: MAIL_SYSTEM, content, schema: mailSchema(), cheap: true });
  const raw = answer.raw ?? {};
  const changes = raw.changes ?? [];
  let pass;
  if (!answer.ok) pass = false;
  else if (expect === "nejasne" || expect === "neni_doba") pass = raw.verdict === expect;
  else if (expect === "slots") {
    // Buď časy ve slots, nebo se zeptá; close_at/open_from u prodloužení kód zachytí (changeInput vrátí chybu).
    pass = raw.verdict === "nejasne" || (raw.verdict === "zmeny" && changes.length === 1 && changes[0].slots.length > 0 && !changes[0].close_at && !changes[0].open_from);
    const guarded = raw.verdict === "zmeny" && changes.length === 1 && !changes[0].slots.length;
    if (!pass && guarded) pass = "kód zachytí";
  } else {
    const have = covered(changes);
    const want = new Set(expect.flatMap((w) => { const [from, to] = Array.isArray(w.on) ? w.on : [w.on, w.on]; return days(from, to).map((day) => key(w.t, w.kind, day, w.close ?? "", w.open ?? "")); }));
    pass = raw.verdict === "zmeny" && have.size === want.size && [...want].every((item) => have.has(item));
  }
  if (!pass) bad += 1;
  console.log(`${pass === true ? "ok  " : pass ? "ok* " : "CHYBA"} ${text}${typeof pass === "string" ? `  (${pass})` : ""}`);
  if (!pass) console.log("      ", answer.ok ? JSON.stringify({ verdict: raw.verdict, question: raw.question, changes: changes.map(({ slots, ...rest }) => ({ ...rest, slots: slots.map((s) => `${s.day} ${s.from}-${s.to}`) })) }) : answer.error);
}
console.log(`\n${CASES.length - bad}/${CASES.length} sedí`);
process.exit(bad ? 1 : 0);
