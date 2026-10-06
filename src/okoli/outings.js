// Kdy a na jaké dny psát článek „Kam vyrazit“: běžný víkend, volno se svátkem a samostatný svátek uprostřed týdne.
// Volné dny jsou sobota, neděle a státní svátky; souvislý úsek volných dnů je jedno období.
// - Úsek s víkendem: když začíná sobotou, přidá se k němu pátek (večerní akce) a článek se píše v pátek ráno,
//   když začíná svátkem (Velký pátek, svátek ve čtvrtek a v pátek), píše se den předem. Pondělní svátek ho prodlouží.
// - Úsek bez víkendu (svátek uprostřed týdne): krátký článek den předem, jen na ty dny.

const DAY_NAMES = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

export function shiftDay(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

export function czechDay(day) {
  const [, month, date] = day.split("-").map(Number);
  return `${DAY_NAMES[weekday(day)]} ${date}. ${month}.`;
}

// Velikonoční neděle (gregoriánský kalendář, anonymní algoritmus).
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const date = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

const FIXED = [
  ["01-01", "Nový rok a Den obnovy samostatného českého státu"],
  ["05-01", "Svátek práce"],
  ["05-08", "Den vítězství"],
  ["07-05", "Den slovanských věrozvěstů Cyrila a Metoděje"],
  ["07-06", "Den upálení mistra Jana Husa"],
  ["09-28", "Den české státnosti (svatý Václav)"],
  ["10-28", "Den vzniku samostatného československého státu"],
  ["11-17", "Den boje za svobodu a demokracii"],
  ["12-24", "Štědrý den"],
  ["12-25", "1. svátek vánoční"],
  ["12-26", "2. svátek vánoční"],
];

const cache = new Map();

// Státní svátky roku jako Map den → název.
export function holidaysOf(year) {
  if (!cache.has(year)) {
    const easter = easterSunday(year);
    const days = new Map(FIXED.map(([day, name]) => [`${year}-${day}`, name]));
    days.set(shiftDay(easter, -2), "Velký pátek");
    days.set(shiftDay(easter, 1), "Velikonoční pondělí");
    cache.set(year, days);
  }
  return cache.get(year);
}

export const holidayName = (day) => holidaysOf(Number(day.slice(0, 4))).get(day) ?? "";

const isOff = (day) => weekday(day) === 0 || weekday(day) === 6 || Boolean(holidayName(day));

// Období od `start` dál (nejvýš `limit` dní dopředu), seřazená podle začátku. Každé má:
// { key (začátek, podle něj se pozná, že článek už je), from, to, write (den, kdy se článek píše), kind: "vikend" | "volno" | "svatek", holidays: [{ day, name }] }.
export function outingsFrom(start, limit = 21) {
  const periods = [];
  let day = shiftDay(start, -3);
  const end = shiftDay(start, limit);
  while (day <= end) {
    if (!isOff(day)) {
      day = shiftDay(day, 1);
      continue;
    }
    let last = day;
    while (isOff(shiftDay(last, 1))) last = shiftDay(last, 1);
    const days = [];
    for (let each = day; each <= last; each = shiftDay(each, 1)) days.push(each);
    const holidays = days.filter(holidayName).map((each) => ({ day: each, name: holidayName(each) }));
    const weekend = days.some((each) => weekday(each) === 6 || weekday(each) === 0);
    if (weekend && weekday(day) === 6) {
      // Běžně od pátku: páteční večer patří k víkendu a článek se píše v pátek ráno.
      const friday = shiftDay(day, -1);
      periods.push({ key: friday, from: friday, to: last, write: friday, kind: holidays.length ? "volno" : "vikend", holidays });
    } else {
      periods.push({ key: day, from: day, to: last, write: shiftDay(day, -1), kind: weekend ? "volno" : "svatek", holidays });
    }
    day = shiftDay(last, 1);
  }
  return periods;
}

// Na co psát teď (tlačítko v redakci): období, které ještě neskončilo, od dneška (`key` zůstává).
export function outingFor(today) {
  const period = outingsFrom(today).find((each) => each.to >= today);
  return { ...period, from: period.from > today ? period.from : today };
}

// Cron: článek se píše ráno v den `write` (od šesti do šesti večer) a jen jednou za období (`weekendOn` = jeho `key`).
export function outingDue(settings, now) {
  if (!settings.weekly || now.time < "06:00" || now.time >= "18:00") return null;
  const period = outingsFrom(now.date).find((each) => each.write === now.date);
  if (!period || settings.weekendOn === period.key) return null;
  return period;
}
