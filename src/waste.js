export function pragueToday(now = new Date()) {
  return pragueNow(now).date;
}

/** Den a hodina v Evropě/Praha. Hodiny procesu se nepoužijí, worker je v UTC. */
export function pragueNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${pick("hour").padStart(2, "0")}:${pick("minute").padStart(2, "0")}`,
  };
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Stejný výpočet ISO týdne jako na popelnice.kopidlenskadrbna.org */
export function isoWeek(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(x.getUTCFullYear(), 0, 1);
  return Math.ceil(((x.getTime() - yearStart) / 86400000 + 1) / 7);
}

export function civilWeekday(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function nextPickup(today, rule) {
  let cursor = today;
  for (let i = 0; i < 28; i += 1) {
    if (civilWeekday(cursor) === rule.weekday && isoWeek(cursor) % 2 === rule.weekParity) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

export function upcomingPickups(first, stepDays, count) {
  const step = Math.max(1, stepDays);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(addDays(first, step * i));
  return out;
}

export function buildWasteView(rule, today = pragueToday()) {
  const nextDate = nextPickup(today, rule);
  return {
    ...rule,
    today,
    nextDate,
    daysUntil: daysBetween(today, nextDate),
    upcoming: upcomingPickups(nextDate, rule.stepDays, 6),
  };
}
