import { addDays, civilWeekday, daysBetween } from "./waste.js";

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const LABEL = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
const SHORT = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const WHEN = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];

export const HOME_LEAD_DAYS = 14;
export const WEEK_DAYS = ORDER.map((day) => ({ day, label: LABEL[day], short: SHORT[day] }));

const MORNING = { from: "08:00", to: "12:00" };
const AFTERNOON = { from: "13:00", to: "17:00" };

function parseIsoDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return text;
}

function parseTime(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function clipNote(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function closedPart(from, to) {
  return { open: false, from, to, note: "" };
}

function openPart(from, to, note = "") {
  return { open: true, from, to, note: clipNote(note) };
}

export function blankWeek() {
  return ORDER.map((day) => ({
    day,
    morning: closedPart(MORNING.from, MORNING.to),
    afternoon: closedPart(AFTERNOON.from, AFTERNOON.to),
  }));
}

function readPart(raw, fallback) {
  const from = parseTime(raw?.from) || fallback.from;
  const to = parseTime(raw?.to) || fallback.to;
  const note = clipNote(raw?.note);
  return { open: Boolean(raw?.open) && from < to, from, to, note };
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
  if (!Array.isArray(parsed)) return blankWeek();
  const byDay = new Map();
  for (const slot of parsed) {
    const day = Number(slot?.day);
    if (!ORDER.includes(day)) continue;
    byDay.set(day, {
      day,
      morning: readPart(slot.morning, MORNING),
      afternoon: readPart(slot.afternoon, AFTERNOON),
    });
  }
  return ORDER.map((day) => byDay.get(day) ?? { day, morning: closedPart(MORNING.from, MORNING.to), afternoon: closedPart(AFTERNOON.from, AFTERNOON.to) });
}

function checkPart(day, label, raw, fallback) {
  const where = `${WHEN[day]} ${label}`;
  const note = clipNote(raw?.note);
  const fallbackFrom = parseTime(raw?.from) || fallback.from;
  const fallbackTo = parseTime(raw?.to) || fallback.to;
  if (!raw?.open) return { part: { open: false, from: fallbackFrom, to: fallbackTo, note } };
  const from = parseTime(raw?.from);
  const to = parseTime(raw?.to);
  if (!from || !to) return { error: `${cap(where)} doplňte čas od a do.` };
  if (from >= to) return { error: `${cap(where)} musí být konec později než začátek.` };
  return { part: { open: true, from, to, note } };
}

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function normalizeWeek(slots) {
  const byDay = new Map((slots ?? []).map((slot) => [Number(slot.day), slot]));
  const week = [];
  for (const day of ORDER) {
    const slot = byDay.get(day) ?? {};
    const morning = checkPart(day, "dopoledne", slot.morning, MORNING);
    if (morning.error) return morning;
    const afternoon = checkPart(day, "odpoledne", slot.afternoon, AFTERNOON);
    if (afternoon.error) return afternoon;
    if (morning.part.open && afternoon.part.open && afternoon.part.from < morning.part.to) {
      return { error: `${LABEL[day]}: odpoledne musí začít až po dopoledni, ať se časy nepřekrývají.` };
    }
    week.push({ day, morning: morning.part, afternoon: afternoon.part });
  }
  return { week };
}

export function hasOpenSlot(week) {
  return (week ?? []).some((slot) => slot.morning?.open || slot.afternoon?.open);
}

export function changeSpan(starts, ends) {
  const startsOn = parseIsoDate(starts);
  if (!startsOn) return { error: "Doplňte den, od kdy změna platí." };
  const rawEnd = String(ends ?? "").trim();
  const endsOn = rawEnd ? parseIsoDate(rawEnd) : startsOn;
  if (!endsOn) return { error: "Konec změny není platné datum." };
  if (endsOn < startsOn) return { error: "Konec změny musí být stejný den, nebo později." };
  if (daysBetween(startsOn, endsOn) > 366) return { error: "Dočasná změna může trvat nejvýš rok." };
  return { startsOn, endsOn };
}

function slotOn(week, iso) {
  const day = civilWeekday(iso);
  return (week ?? []).find((slot) => slot.day === day) ?? null;
}

function eachDate(startsOn, endsOn, visit) {
  const total = daysBetween(startsOn, endsOn);
  for (let step = 0; step <= total; step += 1) visit(addDays(startsOn, step));
}

export function periodClosed(change) {
  let closed = true;
  eachDate(change.startsOn, change.endsOn, (iso) => {
    const slot = slotOn(change.week, iso);
    if (slot?.morning?.open || slot?.afternoon?.open) closed = false;
  });
  return closed;
}

function laterChange(best, change) {
  if (!best) return change;
  if (change.startsOn !== best.startsOn) return change.startsOn > best.startsOn ? change : best;
  return Number(change.id) > Number(best.id) ? change : best;
}

function earlierChange(best, change) {
  if (!best) return change;
  if (change.startsOn !== best.startsOn) return change.startsOn < best.startsOn ? change : best;
  return Number(change.id) < Number(best.id) ? change : best;
}

export function activeChange(doctor, today) {
  const list = (doctor.changes ?? []).filter((change) => change.startsOn <= today && today <= change.endsOn);
  return list.reduce(laterChange, null);
}

export function visibleHomeChange(doctor, today) {
  const horizon = addDays(today, HOME_LEAD_DAYS);
  const list = (doctor.changes ?? []).filter((change) => change.endsOn >= today && change.startsOn <= horizon);
  if (!list.length) return null;
  const active = list.filter((change) => change.startsOn <= today);
  if (active.length) return active.reduce(laterChange, null);
  return list.reduce(earlierChange, null);
}

export function numeric(iso, today) {
  const [year, month, day] = iso.split("-").map(Number);
  return iso.slice(0, 4) === today.slice(0, 4) ? `${day}. ${month}.` : `${day}. ${month}. ${year}`;
}

function whenPhrase(change, today) {
  const from = numeric(change.startsOn, today);
  if (change.startsOn === change.endsOn) return from;
  return `od ${from} do ${numeric(change.endsOn, today)}`;
}

function partText(label, part) {
  if (!part?.open) return "";
  const note = part.note ? `, ${part.note}` : "";
  return `${label} ${part.from}–${part.to}${note}`;
}

export function spanSummary(change) {
  const byDay = new Map();
  eachDate(change.startsOn, change.endsOn, (iso) => {
    const day = civilWeekday(iso);
    if (byDay.has(day)) return;
    const slot = slotOn(change.week, iso);
    const text = [partText("dopoledne", slot?.morning), partText("odpoledne", slot?.afternoon)].filter(Boolean).join(", ");
    if (text) byDay.set(day, `${SHORT[day]} ${text}`);
  });
  return ORDER.filter((day) => byDay.has(day))
    .map((day) => byDay.get(day))
    .join("; ");
}

// `other` je konec věty u jiných hodin. Otevírací doba míst ho mění na „jinou otevírací dobu“.
export function homeNotice(doctor, today, { other = "jiné ordinační hodiny" } = {}) {
  const change = visibleHomeChange(doctor, today);
  if (!change) return null;
  const closed = periodClosed(change);
  const when = whenPhrase(change, today);
  return {
    name: doctor.name,
    specialty: doctor.specialty,
    state: closed ? `Má ${when} zavřeno.` : `Má ${when} ${other}.`,
    detail: closed ? "" : spanSummary(change),
    note: change.note,
    kind: closed ? "closed" : "change",
  };
}

export function hoursSummary(doctor, missing = "Ordinační hodiny zatím nejsou doplněné") {
  if (!hasOpenSlot(doctor.week)) return missing;
  return (doctor.week ?? [])
    .map((slot) => {
      const text = [partText("dopoledne", slot.morning), partText("odpoledne", slot.afternoon)].filter(Boolean).join(", ");
      return text ? `${SHORT[slot.day]} ${text}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

function dayHours(day, morning, afternoon) {
  return {
    day,
    morning: morning ? openPart(morning[0], morning[1], morning[2]) : closedPart(MORNING.from, MORNING.to),
    afternoon: afternoon ? openPart(afternoon[0], afternoon[1], afternoon[2]) : closedPart(AFTERNOON.from, AFTERNOON.to),
  };
}

function weekOf(days) {
  const byDay = new Map(days.map((slot) => [slot.day, slot]));
  return ORDER.map((day) => byDay.get(day) ?? dayHours(day));
}

const ULRYCH_AM = "do 9:00 odběry, do 9:30 akutní, od 10:00 objednaní, ordinuje MUDr. Ulrych";
const TUESDAY_AM = "do 9:30 akutní, od 10:00 objednaní, ordinuje MUDr. Ulrych";
const THURSDAY_AM = "do 9:30 akutní, od 10:00 objednaní, ordinuje MUDr. Ulrychová";
const FRIDAY_AM = "do 9:00 odběry, do 9:30 akutní, od 10:00 objednaní, ordinují MUDr. Ulrych a MUDr. Ulrychová";

export const DOCTOR_SEEDS = [
  {
    name: "Ordinace Kopidlno",
    specialty: "Praktický lékař pro dospělé",
    place: "Tomáše Svobody 141, Kopidlno",
    phone: "493 552 147",
    sortOrder: 0,
    published: 1,
    week: weekOf([
      dayHours(1, ["07:00", "12:30", ULRYCH_AM], ["13:00", "18:00", "objednaní, ordinuje MUDr. Ulrych"]),
      dayHours(2, ["08:00", "12:30", TUESDAY_AM]),
      dayHours(3, ["07:00", "12:30", ULRYCH_AM]),
      dayHours(4, ["08:00", "12:00", THURSDAY_AM]),
      dayHours(5, ["07:00", "12:30", FRIDAY_AM]),
    ]),
  },
  {
    name: "MUDr. Lubomír Klíma",
    specialty: "Praktický lékař",
    place: "Tomáše Svobody 141, Kopidlno",
    phone: "493 552 107",
    sortOrder: 1,
    published: 1,
    week: blankWeek(),
  },
  {
    name: "MUDr. Jaroslava Lelková",
    specialty: "Praktický lékař pro děti a dorost",
    place: "Tomáše Svobody 141, Kopidlno",
    phone: "",
    sortOrder: 2,
    published: 1,
    week: blankWeek(),
  },
];
