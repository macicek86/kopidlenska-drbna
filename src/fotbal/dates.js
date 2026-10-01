// Kontrola dat v aktualitě klubu: den v týdnu musí sedět na datum a datum pozvánky na rozpis.
// Klub se občas přepíše („neděle 3. 10.“, ale 3. 10. je sobota). Takový článek nesmí jít rovnou na web.

const WEEKDAYS = [
  ["neděle", "neděli"],
  ["pondělí"],
  ["úterý"],
  ["středa", "středu"],
  ["čtvrtek"],
  ["pátek"],
  ["sobota", "sobotu"],
];
const WEEKDAY_NAMES = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
const MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];

const DAY_WORD = WEEKDAYS.flat().join("|");
const MONTH_WORD = MONTHS.join("|");
// „neděle 3. 10. 2026“, „v sobotu 3.10.“, „neděli, 4. října“
const DATED_DAY = new RegExp(`(${DAY_WORD})\\s*,?\\s*(\\d{1,2})\\.\\s*(?:(\\d{1,2})\\.?|(${MONTH_WORD}))(?:\\s*(\\d{4}))?`, "giu");

function weekdayOf(word) {
  return WEEKDAYS.findIndex((forms) => forms.includes(word.toLowerCase()));
}

function iso(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Datum bez roku patří k roku zveřejnění; když by vyšlo o víc než půl roku dřív, je to už příští rok (pozvánka v prosinci na leden).
function withYear(day, month, year, around) {
  if (year) return { year: Number(year), guessed: false };
  const base = /^\d{4}-\d{2}-\d{2}$/.test(around ?? "") ? around : "";
  if (!base) return null;
  const sameYear = Number(base.slice(0, 4));
  return { year: iso(sameYear, month, day) < shift(base, -183) ? sameYear + 1 : sameYear, guessed: true };
}

function shift(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function realDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  return value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value : null;
}

function czech(date) {
  const [year, month, day] = date.split("-").map(Number);
  return `${day}. ${month}. ${year}`;
}

// Všechna místa v textu, kde je den v týdnu i s datem. `around` je datum zveřejnění kvůli roku.
export function datedWeekdays(text, around) {
  const found = [];
  for (const match of String(text ?? "").matchAll(DATED_DAY)) {
    const day = Number(match[2]);
    const month = match[3] ? Number(match[3]) : MONTHS.indexOf(match[4].toLowerCase()) + 1;
    const year = withYear(day, month, match[5], around);
    if (!year || month < 1 || month > 12) continue;
    const real = realDate(year.year, month, day);
    found.push({ text: match[0].trim(), weekday: weekdayOf(match[1]), date: real ? iso(year.year, month, day) : "", real: real ? real.getUTCDay() : -1 });
  }
  return found;
}

// Datum zápasu z rozpisu, když se k aktualitě našel („Zápas: Domácí – Hosté, 2026-10-03 16:00…“).
export function scheduleDate(extra) {
  return String(extra ?? "").match(/^Zápas: [^\n]*?, (\d{4}-\d{2}-\d{2})/m)?.[1] ?? "";
}

// Seznam pochybností o datu pro redakci. Prázdný znamená, že je všechno v pořádku.
export function dateDoubts(item) {
  const doubts = [];
  const found = datedWeekdays(`${item.title ?? ""}\n${item.text ?? ""}`, item.publishedOn);
  for (const entry of found) {
    if (!entry.date) doubts.push(`„${entry.text}“ není skutečné datum.`);
    else if (entry.real !== entry.weekday) doubts.push(`„${entry.text}“: ${czech(entry.date)} je ${WEEKDAY_NAMES[entry.real]}, ne ${WEEKDAY_NAMES[entry.weekday]}.`);
  }
  const planned = item.kind === "pozvanka" ? scheduleDate(item.extra) : "";
  if (planned && found.length && !found.some((entry) => entry.date === planned)) {
    doubts.push(`V rozpisu klubu je zápas ${czech(planned)} (${WEEKDAY_NAMES[new Date(`${planned}T12:00:00Z`).getUTCDay()]}), v textu jiné datum.`);
  }
  return [...new Set(doubts)];
}
