// Kdy a na jaké dny psát článek „Kam vyrazit“: běžný víkend, volno se svátkem a samostatný svátek uprostřed týdne.
// Volné dny jsou sobota, neděle a státní svátky; souvislý úsek volných dnů je jedno období.
// - Úsek s víkendem: když začíná sobotou, přidá se k němu pátek (večerní akce) a článek se píše v pátek ráno,
//   když začíná svátkem (Velký pátek, svátek ve čtvrtek a v pátek), píše se den předem. Pondělní svátek ho prodlouží.
// - Úsek bez víkendu (svátek uprostřed týdne): krátký článek den předem, jen na ty dny.
// S článkem na pracovní týden (`autoTyden`, `withWeekdays`) je týden pokrytý celý dvěma články, které se den překrývají:
// víkendový sahá až do úterý, týdenní (píše se v pondělí, vyjde večer) od úterý do pátku. Samostatný svátek pak
// článek nemá, je v tom, který ho pokrývá.

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

const holidaysIn = (from, to) => {
  const found = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) if (holidayName(day)) found.push({ day, name: holidayName(day) });
  return found;
};

// Období od `start` dál (nejvýš `limit` dní dopředu), seřazená podle začátku. Každé má:
// { key (začátek, podle něj se pozná, že článek už je), from, to, write (den, kdy se článek píše), kind: "vikend" | "volno" | "svatek", holidays: [{ day, name }] }.
// S `volno: false` (článek na volno je v redakci vypnutý) je volno se svátkem obyčejný víkend pátek až neděle.
export function outingsFrom(start, limit = 21, { volno = true } = {}) {
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
    if (weekend && !volno && holidays.length) {
      const saturday = days.find((each) => weekday(each) === 6) ?? shiftDay(days.find((each) => weekday(each) === 0), -1);
      const friday = shiftDay(saturday, -1);
      const sunday = shiftDay(saturday, 1);
      periods.push({ key: friday, from: friday, to: sunday, write: friday, kind: "vikend", holidays: holidaysIn(friday, sunday) });
    } else if (weekend && weekday(day) === 6) {
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

// Týdenní článek začíná v úterý (je-li svátek, první pracovní den po něm, nejpozději ve čtvrtek).
const WEEK_STARTS = [2, 3, 4];

// Z období s víkendem udělá dvojice: víkend (volno) prodloužený do prvního dne týdenního článku a týdenní článek
// od toho dne do začátku dalšího víkendu (včetně, ať se překrývají). Samostatné svátky vypadnou, jsou v nich.
// Když se týdenní článek do mezery nevejde (Štědrý den ve středu), víkend sahá až do dne před dalším obdobím.
export function withWeekdays(periods) {
  const big = periods.filter((period) => period.kind !== "svatek");
  const out = [];
  big.forEach((period, index) => {
    const next = big[index + 1];
    if (!next) return out.push(period);
    let first = "";
    for (let day = shiftDay(period.to, 1); day < next.from && !first; day = shiftDay(day, 1)) {
      if (!isOff(day) && WEEK_STARTS.includes(weekday(day))) first = day;
    }
    const tail = first || shiftDay(next.from, -1);
    out.push(tail > period.to ? { ...period, to: tail, offTo: period.to, holidays: holidaysIn(period.from, tail) } : period);
    if (first) out.push({ key: first, from: first, to: next.from, write: shiftDay(first, -1), kind: "tyden", holidays: holidaysIn(first, next.from) });
  });
  return out;
}

// Na co psát teď (tlačítko v redakci): období, které ještě neskončilo, od dneška (`key` zůstává).
export function outingFor(today) {
  const period = outingsFrom(today).find((each) => each.to >= today);
  return { ...period, from: period.from > today ? period.from : today };
}

// Které články se píšou samy (přepínače v redakci): víkendy, volno se svátkem, samostatné svátky, pracovní týden.
const kindOn = (settings, kind) =>
  ({ vikend: settings.weekly, volno: settings.autoVolno, svatek: settings.autoSvatek, tyden: settings.autoTyden })[kind] ?? false;

// Plánovaná období podle přepínačů redakce.
export function plannedOutings(settings, start, limit = 21) {
  if (!settings.autoTyden) return outingsFrom(start, limit, { volno: settings.autoVolno }).filter((period) => kindOn(settings, period.kind));
  // O týden zpátky, ať je známý víkend před prvním týdenním článkem.
  const periods = withWeekdays(outingsFrom(shiftDay(start, -7), limit + 7, { volno: settings.autoVolno }));
  return periods.filter((period) => period.to >= start && kindOn(settings, period.kind));
}

// Kdy se článek v den `write` píše: týdenní odpoledne (vychází večer, ať vidí akce přidané přes den),
// ostatní hned první běh po půlnoci (do šesti večer, kdyby noční běhy selhaly).
export const writeWindow = (period) => (period.kind === "tyden" ? ["12:00", "24:00"] : ["00:00", "18:00"]);

// Cron: článek se píše v den `write` v jeho okně a jen jednou za období (`weekendOn` = jeho `key`).
export function outingDue(settings, now) {
  const period = plannedOutings(settings, now.date).find((each) => each.write === now.date);
  if (!period || settings.weekendOn === period.key) return null;
  const [from, to] = writeWindow(period);
  return now.time >= from && now.time < to ? period : null;
}

// Ruční článek nejvýš na tolik dní a nejpozději tolik dní dopředu.
export const MANUAL_MAX_DAYS = 14;

// Ruční článek na dny od–do: svátky v nich najde sám, druh podle nich a podle délky ("tyden": jen pracovní dny,
// "dny": jiný rozsah).
export function periodBetween(from, to, today) {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(from) || !valid.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return { error: "Vyberte den od a do." };
  if (from < today) return { error: "Článek jde napsat jen na dny, které ještě nebyly." };
  if (to < from) return { error: "Den do musí být stejný nebo pozdější než den od." };
  if (to > shiftDay(today, MANUAL_MAX_DAYS)) return { error: `Nejvýš ${MANUAL_MAX_DAYS} dní dopředu.` };
  const holidays = holidaysIn(from, to);
  const days = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  const weekendOnly = days.every((day) => [5, 6, 0].includes(weekday(day)));
  const hasWeekend = days.some((day) => [6, 0].includes(weekday(day)));
  const lonelyHoliday = days.length === 1 && holidays.length && !hasWeekend;
  // Aspoň dva dny jen z pondělí až pátku: článek na pracovní týden.
  const workweek = days.length >= 2 && days.every((day) => weekday(day) >= 1 && weekday(day) <= 5);
  const kind = lonelyHoliday ? "svatek" : holidays.length && hasWeekend ? "volno" : !holidays.length && weekendOnly ? "vikend" : workweek ? "tyden" : "dny";
  return { key: from, from, to, write: today, kind, holidays, manual: true };
}
