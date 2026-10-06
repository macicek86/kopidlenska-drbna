// Jedna změna hodin jako řádek do e-mailu odesílateli („Dětská hernička: pondělí 12. října až neděle 18. října, zavřeno“).
// Bere uloženou hodnotu sekce (co vrací `read` akce), takže sedí i po úpravě redakcí při schválení.
import { formatLong } from "../format.js";
import { addDays, civilWeekday, daysBetween } from "../waste.js";
import { hoursSummary as yardHours } from "../yards.js";

const ORDER = [1, 2, 3, 4, 5, 6, 0];

// 07:30 → 7:30
export function clock(time) {
  return String(time ?? "").replace(/^0(\d)/, "$1");
}
const SHORT = ["ne", "po", "út", "st", "čt", "pá", "so"];

function dayText(slot) {
  return [slot?.morning, slot?.afternoon]
    .filter((part) => part?.open)
    .map((part) => `${clock(part.from)}–${clock(part.to)}`)
    .join(" a ");
}

// Týden s dopolednem a odpolednem po lidsku: stejné dny po sobě sloučí („po–pá 7:30–12:00 a 13:00–14:00“).
// `days` omezí výpis na dny v týdnu, které období opravdu má; zavřené dny vynechá.
export function weekText(week, days = null) {
  const groups = [];
  for (const day of ORDER) {
    if (days && !days.has(day)) continue;
    const text = dayText((week ?? []).find((slot) => slot.day === day));
    const last = groups.at(-1);
    if (text && last?.text === text && last.end === ORDER[ORDER.indexOf(day) - 1]) last.end = day;
    else if (text) groups.push({ start: day, end: day, text });
  }
  return groups.map((group) => `${SHORT[group.start]}${group.end !== group.start ? `–${SHORT[group.end]}` : ""} ${group.text}`).join(", ");
}

function spanDays(value) {
  const days = new Set();
  const total = Math.min(daysBetween(value.startsOn, value.endsOn), 6);
  for (let step = 0; step <= total; step += 1) days.add(civilWeekday(addDays(value.startsOn, step)));
  return days;
}

function day(iso) {
  const text = formatLong(iso);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function span(value) {
  return value.startsOn === value.endsOn ? day(value.startsOn) : `${day(value.startsOn)} až ${day(value.endsOn)}`;
}

// Běžné hodiny lékaře a dvora datum nemají, run.js ho připíše z e-mailu.
function since(value) {
  return value.startsOn ? `od ${day(value.startsOn)} ` : "";
}

export function describeChange(section, action, value, name) {
  const who = name ? `${name}: ` : "";
  if (section === "dvory") {
    if (action === "uzavreni") return `${who}${span(value)}, zavřeno${value.reason ? ` (${value.reason})` : ""}`;
    return `${who}${since(value)}nová běžná doba: ${yardHours({ week: value.week })}`;
  }
  if (action === "hodiny") return `${who}${since(value)}nová běžná doba: ${weekText(value.week)}`;
  if (value.kind === "trvala") return `${who}od ${day(value.startsOn)} nová běžná doba: ${weekText(value.week)}`;
  const note = value.note ? ` (${value.note})` : "";
  const open = weekText(value.week, spanDays(value));
  return `${who}${span(value)}, ${open ? `otevřeno ${open}` : "zavřeno"}${note}`;
}
