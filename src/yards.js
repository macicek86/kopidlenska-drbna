import { addDays, civilWeekday, daysBetween } from "./waste.js";

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_IN = ["neděli", "pondělí", "úterý", "středu", "čtvrtek", "pátek", "sobotu"];
const PREP = ["v", "v", "v", "ve", "ve", "v", "v"];
const LABEL = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
const SHORT = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

export const WEEK_DAYS = ORDER.map((day) => ({ day, label: LABEL[day], short: SHORT[day] }));

export function parseIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return text;
}

export function closureSpan(starts, ends) {
  const startsOn = parseIsoDate(starts);
  if (!startsOn) return { error: "Doplňte den, od kdy je zavřeno." };
  const rawEnd = String(ends ?? "").trim();
  const endsOn = rawEnd ? parseIsoDate(rawEnd) : startsOn;
  if (!endsOn) return { error: "Konec uzavření není platné datum." };
  if (endsOn < startsOn) return { error: "Konec uzavření musí být stejný den, nebo později." };
  if (daysBetween(startsOn, endsOn) > 366) return { error: "Uzavření může trvat nejvýš rok." };
  return { startsOn, endsOn };
}

export function coversDay(closure, day) {
  return closure.startsOn <= day && day <= closure.endsOn;
}

export function parseTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function blankWeek() {
  return ORDER.map((day) => ({ day, open: false, from: "08:00", to: "16:00" }));
}

export function parseHours(raw) {
  const text = String(raw ?? "").trim();
  let parsed = null;
  if (text.startsWith("[")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!Array.isArray(parsed)) return { week: blankWeek(), legacy: text };
  const byDay = new Map();
  for (const slot of parsed) {
    const day = Number(slot?.day);
    if (!ORDER.includes(day)) continue;
    const from = parseTime(slot.from) || "08:00";
    const to = parseTime(slot.to) || "16:00";
    byDay.set(day, { day, open: Boolean(slot.open) && from < to, from, to });
  }
  return { week: ORDER.map((day) => byDay.get(day) ?? { day, open: false, from: "08:00", to: "16:00" }), legacy: "" };
}

export function normalizeWeek(slots) {
  const byDay = new Map((slots ?? []).map((slot) => [Number(slot.day), slot]));
  const week = [];
  for (const day of ORDER) {
    const slot = byDay.get(day) ?? {};
    const label = LABEL[day];
    const fallbackFrom = parseTime(slot.from) || "08:00";
    const fallbackTo = parseTime(slot.to) || "16:00";
    if (!slot.open) {
      week.push({ day, open: false, from: fallbackFrom, to: fallbackTo });
      continue;
    }
    const from = parseTime(slot.from);
    const to = parseTime(slot.to);
    if (!from || !to) return { error: `U ${label.toLowerCase()} doplňte čas od a do.` };
    if (from >= to) return { error: `U ${label.toLowerCase()} musí být konec později než začátek.` };
    week.push({ day, open: true, from, to });
  }
  if (!week.some((slot) => slot.open)) return { error: "Zaškrtněte aspoň jeden den, kdy má otevřeno." };
  return { week };
}

function openSlot(week, iso) {
  const day = civilWeekday(iso);
  return (week ?? []).find((slot) => slot.day === day && slot.open) ?? null;
}

function closureOn(closures, iso) {
  const hits = (closures ?? []).filter((closure) => coversDay(closure, iso));
  if (!hits.length) return null;
  return hits.reduce((latest, closure) => (closure.endsOn > latest.endsOn ? closure : latest));
}

export function yardStatus(yard, today, time) {
  const week = yard.week ?? parseHours(yard.hours).week;
  const clock = parseTime(time) || "00:00";
  const closure = closureOn(yard.closures, today);
  if (closure) return { kind: "closure", until: closure.endsOn, reason: String(closure.reason ?? "").trim() };
  const todaySlot = openSlot(week, today);
  if (todaySlot && clock >= todaySlot.from && clock < todaySlot.to) {
    return { kind: "open", from: todaySlot.from, to: todaySlot.to };
  }
  for (let step = 0; step <= 400; step += 1) {
    const date = step === 0 ? today : addDays(today, step);
    if (closureOn(yard.closures, date)) continue;
    const slot = openSlot(week, date);
    if (!slot) continue;
    if (step === 0 && clock >= slot.from) continue;
    return { kind: "closed", nextDate: date, from: slot.from, to: slot.to, sameDay: step === 0 };
  }
  return { kind: "closed", nextDate: "" };
}

function numeric(iso, withYear) {
  const [year, month, day] = iso.split("-").map(Number);
  return withYear ? `${day}. ${month}. ${year}` : `${day}. ${month}.`;
}

function nextPhrase(iso, today) {
  const weekday = civilWeekday(iso);
  const withYear = iso.slice(0, 4) !== today.slice(0, 4);
  return `${PREP[weekday]} ${DAY_IN[weekday]} ${numeric(iso, withYear)}`;
}

function finish(text) {
  return text.endsWith(".") ? text : `${text}.`;
}

function range(from, to) {
  return `od ${from} do ${to}`;
}

function weekOf(yard) {
  return yard.week ?? parseHours(yard.hours).week;
}

function tomorrowSlot(yard, today) {
  const date = addDays(today, 1);
  if (closureOn(yard.closures, date)) return null;
  return openSlot(weekOf(yard), date);
}

function tomorrowLine(slot) {
  return slot ? `Zítra ${range(slot.from, slot.to)}.` : "";
}

function nextWhen(status, today) {
  if (status.sameDay) return "dnes";
  if (status.nextDate === addDays(today, 1)) return "zítra";
  return nextPhrase(status.nextDate, today);
}

export function statusLine(yard, today, time) {
  if (yard.legacy && !(yard.week ?? []).some((slot) => slot.open)) return `${yard.name}. ${yard.legacy}`;
  const status = yardStatus(yard, today, time);
  if (status.kind === "closure") {
    const base = finish(`${yard.name} je uzavřený do ${numeric(status.until, true)}`);
    return status.reason ? `${base} ${finish(status.reason)}` : base;
  }
  if (status.kind === "open") return `${yard.name} je dnes otevřený ${status.from}–${status.to}.`;
  if (status.nextDate) {
    return finish(
      `${yard.name} je dnes zavřený. Příště bude otevřený ${nextWhen(status, today)} ${range(status.from, status.to)}`,
    );
  }
  return `${yard.name} je dnes zavřený.`;
}

export function homeStatus(yard, today, time) {
  const name = yard.name;
  const tomorrow = tomorrowLine(tomorrowSlot(yard, today));
  if (yard.legacy && !(yard.week ?? []).some((slot) => slot.open)) {
    return { kind: "legacy", name, state: yard.legacy, detail: "", tomorrow: "" };
  }
  const status = yardStatus(yard, today, time);
  if (status.kind === "closure") {
    return { kind: "closure", name, state: `Uzavřený do ${numeric(status.until, true)}`, detail: status.reason, tomorrow };
  }
  if (status.kind === "open") {
    return { kind: "open", name, state: "Dnes otevřený", detail: `${status.from}–${status.to}`, tomorrow };
  }
  if (status.nextDate && status.sameDay) {
    return {
      kind: "closed",
      name,
      state: "Dnes zavřený",
      detail: finish(`Otevře dnes ${range(status.from, status.to)}`),
      tomorrow,
    };
  }
  if (status.nextDate === addDays(today, 1)) {
    return { kind: "closed", name, state: "Dnes zavřený", detail: tomorrow, tomorrow: "" };
  }
  if (status.nextDate) {
    return {
      kind: "closed",
      name,
      state: "Dnes zavřený",
      detail: finish(`Příště ${nextPhrase(status.nextDate, today)} ${range(status.from, status.to)}`),
      tomorrow: "",
    };
  }
  return { kind: "closed", name, state: "Dnes zavřený", detail: "", tomorrow: "" };
}

export function hoursSummary(yard) {
  if (yard.legacy && !(yard.week ?? []).some((slot) => slot.open)) return yard.legacy;
  const open = (yard.week ?? []).filter((slot) => slot.open);
  if (!open.length) return "Bez otevřeného dne";
  return open.map((slot) => `${SHORT[slot.day]} ${slot.from}–${slot.to}`).join(", ");
}
