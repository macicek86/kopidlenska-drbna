import { addDays, civilWeekday, daysBetween } from "./waste.js";
import { spanWeekdays } from "./week-shift.js";

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

// Týden dočasné jiné doby z uloženého JSON (sloupec `hours` u změny), nebo null, když jde o zavření.
export function weekOfChange(raw) {
  const text = String(raw ?? "").trim();
  if (!text.startsWith("[")) return null;
  const { week } = parseHours(text);
  return week.some((slot) => slot.open) ? week : null;
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

// Doba, která ten den platí: dočasná změna (nejnovější, když se jich víc překrývá), jinak běžná.
// `change` je jen u dne s jinou dobou, i když v něm zavřeno (týden změny ten den nemá otevřeno).
function effective(yard, iso) {
  const hits = (yard.changes ?? []).filter((change) => coversDay(change, iso));
  if (hits.length) {
    const change = hits.reduce((latest, item) => (item.id >= latest.id ? item : latest));
    return { slot: openSlot(change.week, iso), change, note: String(change.reason ?? "").trim() };
  }
  return { slot: openSlot(weekOf(yard), iso), change: null, note: "" };
}

function nextOpening(yard, startDate) {
  for (let step = 0; step <= 400; step += 1) {
    const date = step === 0 ? startDate : addDays(startDate, step);
    if (closureOn(yard.closures, date)) continue;
    const { slot, note } = effective(yard, date);
    if (slot) return { date, from: slot.from, to: slot.to, note };
  }
  return null;
}

export function yardStatus(yard, today, time) {
  const clock = parseTime(time) || "00:00";
  const closure = closureOn(yard.closures, today);
  if (closure) {
    return {
      kind: "closure",
      until: closure.endsOn,
      reason: String(closure.reason ?? "").trim(),
      next: nextOpening(yard, addDays(closure.endsOn, 1)),
    };
  }
  const { slot: todaySlot, note } = effective(yard, today);
  if (todaySlot && clock >= todaySlot.from && clock < todaySlot.to) {
    return { kind: "open", from: todaySlot.from, to: todaySlot.to, note };
  }
  if (todaySlot && clock < todaySlot.from) {
    return { kind: "later", from: todaySlot.from, to: todaySlot.to, note };
  }
  const tomorrow = addDays(today, 1);
  const ahead = closureOn(yard.closures, tomorrow);
  return {
    kind: "closed",
    finished: Boolean(todaySlot),
    next: nextOpening(yard, tomorrow),
    ahead: ahead
      ? { until: ahead.endsOn, reason: String(ahead.reason ?? "").trim(), onlyTomorrow: ahead.endsOn === tomorrow }
      : null,
  };
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

function dated(iso, today) {
  return numeric(iso, iso.slice(0, 4) !== today.slice(0, 4));
}

function speak(parts) {
  return parts.filter(Boolean).join(" ");
}

function opensOn(next, today, again) {
  if (!next) return { sentence: "", short: "" };
  if (next.date === addDays(today, 1)) {
    return {
      sentence: `Zítra otevře ${range(next.from, next.to)}.`,
      short: `Zítra ${range(next.from, next.to)}.`,
    };
  }
  const when = nextPhrase(next.date, today);
  const lead = again ? "Otevře znovu" : "Příště otevře";
  const shortLead = again ? "Otevře znovu" : "Příště";
  return {
    sentence: finish(`${lead} ${when} ${range(next.from, next.to)}`),
    short: finish(`${shortLead} ${when} ${range(next.from, next.to)}`),
  };
}

function dayAside(yard, today) {
  const date = addDays(today, 1);
  const closure = closureOn(yard.closures, date);
  if (closure) {
    const reason = String(closure.reason ?? "").trim();
    const why = reason ? ` ${finish(reason)}` : "";
    const span = closure.endsOn === date ? "" : ` do ${dated(closure.endsOn, today)}`;
    const sentence = closure.endsOn === date
      ? `Zítra je mimořádně zavřený.${why}`
      : `Od zítřka je mimořádně zavřený${span}.${why}`;
    const short = closure.endsOn === date
      ? `Zítra mimořádně zavřeno.${why}`
      : `Od zítřka mimořádně zavřeno${span}.${why}`;
    const next = nextOpening(yard, date);
    const again = opensOn(next, today, true);
    return {
      sentence: speak([sentence, again.sentence]),
      short: speak([short, again.short]),
    };
  }
  const { slot, note } = effective(yard, date);
  if (slot) {
    const text = `Zítra ${range(slot.from, slot.to)}.`;
    return { sentence: speak([text, note ? finish(note) : ""]), short: speak([text, note ? finish(note) : ""]) };
  }
  if (note) return { sentence: speak(["Zítra má zavřeno.", finish(note)]), short: speak(["Zítra zavřeno.", finish(note)]) };
  return { sentence: "Zítra má zavřeno.", short: "Zítra zavřeno." };
}

function presented(yard, today, time) {
  const name = yard.name;
  if (yard.legacy && !(yard.week ?? []).some((slot) => slot.open)) {
    return { kind: "legacy", name, state: yard.legacy, detail: "", tomorrow: "", line: `${name}. ${yard.legacy}` };
  }
  const status = yardStatus(yard, today, time);
  if (status.kind === "open") {
    const aside = dayAside(yard, today);
    return {
      kind: "open",
      name,
      state: "Teď otevřený",
      detail: speak([`${status.from}–${status.to}`, status.note ? `· ${status.note}` : ""]),
      tomorrow: aside.short,
      line: speak([`${name} je teď otevřený, dnes ${status.from}–${status.to}.`, status.note ? finish(status.note) : "", aside.sentence]),
    };
  }
  if (status.kind === "later") {
    const aside = dayAside(yard, today);
    return {
      kind: "later",
      name,
      state: `Otevře v ${status.from}`,
      detail: speak([`Dnes do ${status.to}.`, status.note ? finish(status.note) : ""]),
      tomorrow: aside.short,
      line: speak([
        `${name} dnes otevře v ${status.from} a má otevřeno do ${status.to}.`,
        status.note ? finish(status.note) : "",
        aside.sentence,
      ]),
    };
  }
  if (status.kind === "closure") {
    const todayOnly = status.until === today;
    const again = opensOn(status.next, today, true);
    const head = todayOnly
      ? `${name} je dnes mimořádně zavřený.`
      : `${name} je mimořádně zavřený do ${numeric(status.until, true)}.`;
    return {
      kind: "closure",
      name,
      state: todayOnly ? "Dnes mimořádně zavřený" : `Mimořádně zavřený do ${numeric(status.until, true)}`,
      detail: status.reason,
      tomorrow: again.short,
      line: speak([head, status.reason ? finish(status.reason) : "", again.sentence]),
    };
  }
  const head = status.finished ? `${name} má dnes už zavřeno.` : `${name} má dnes zavřeno.`;
  if (status.ahead) {
    const why = status.ahead.reason ? ` ${finish(status.ahead.reason)}` : "";
    const span = status.ahead.onlyTomorrow ? "" : ` do ${dated(status.ahead.until, today)}`;
    const sentence = status.ahead.onlyTomorrow
      ? `Zítra je mimořádně zavřený.${why}`
      : `Od zítřka je mimořádně zavřený${span}.${why}`;
    const short = status.ahead.onlyTomorrow
      ? `Zítra mimořádně zavřeno.${why}`
      : `Od zítřka mimořádně zavřeno${span}.${why}`;
    const again = opensOn(status.next, today, false);
    return {
      kind: "closed",
      name,
      state: status.finished ? "Dnes už zavřený" : "Dnes zavřený",
      detail: short,
      tomorrow: again.short,
      line: speak([head, sentence, again.sentence]),
    };
  }
  const again = opensOn(status.next, today, false);
  return {
    kind: "closed",
    name,
    state: status.finished ? "Dnes už zavřený" : "Dnes zavřený",
    detail: again.short,
    tomorrow: "",
    line: speak([head, again.sentence]),
  };
}

export function statusLine(yard, today, time) {
  return presented(yard, today, time).line;
}

export function homeStatus(yard, today, time) {
  const item = presented(yard, today, time);
  return { kind: item.kind, name: item.name, state: item.state, detail: item.detail, tomorrow: item.tomorrow };
}

export function hoursSummary(yard) {
  if (yard.legacy && !(yard.week ?? []).some((slot) => slot.open)) return yard.legacy;
  const open = (yard.week ?? []).filter((slot) => slot.open);
  if (!open.length) return "Bez otevřeného dne";
  return open.map((slot) => `${SHORT[slot.day]} ${slot.from}–${slot.to}`).join(", ");
}

// Jiná doba dočasné změny jen ve dnech v týdnu, které období zasáhne („So 08:00–10:00“).
export function changeSummary(change) {
  const days = spanWeekdays(change.startsOn, change.endsOn);
  return hoursSummary({ week: (change.week ?? []).filter((slot) => days.has(slot.day)) });
}
