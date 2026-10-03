// Příštích 7 dní lékaře nebo místa: běžné hodiny, které na konkrétní den přepíše změna.
// Dočasná změna platí od starts_on do ends_on (u překryvu ta, která začíná později),
// nová (trvalá) doba místa od starts_on dál. Z ní se den zvýrazní jen dokud nezačne platit (pak je to běžná doba).
import { addDays, civilWeekday } from "./waste.js";

export const NEXT_DAYS = 7;

function laterChange(best, change) {
  if (!best) return change;
  if (change.startsOn !== best.startsOn) return change.startsOn > best.startsOn ? change : best;
  return Number(change.id) > Number(best.id) ? change : best;
}

function slotOf(week, iso) {
  const day = civilWeekday(iso);
  return (week ?? []).find((slot) => slot.day === day) ?? { day, morning: { open: false }, afternoon: { open: false } };
}

// Jeden den: hodiny, které ten den opravdu platí, a změna, ze které jsou (nebo null).
export function hoursOn(entity, iso, today) {
  const changes = entity.changes ?? [];
  const temporary = changes.filter((change) => change.kind !== "trvala" && change.startsOn <= iso && iso <= change.endsOn).reduce(laterChange, null);
  if (temporary) return { iso, slot: slotOf(temporary.week, iso), change: temporary, kind: "zmena" };
  const fresh = changes.filter((change) => change.kind === "trvala" && change.startsOn > today && change.startsOn <= iso).reduce(laterChange, null);
  if (fresh) return { iso, slot: slotOf(fresh.week, iso), change: fresh, kind: "nova" };
  return { iso, slot: slotOf(entity.week, iso), change: null, kind: "" };
}

export function nextDays(entity, today, count = NEXT_DAYS) {
  return Array.from({ length: count }, (_, step) => hoursOn(entity, addDays(today, step), today));
}

// Změny, které v 7 dnech celé nejsou (začnou nebo skončí později). Ty se ukážou zvlášť pod dny.
export function laterChanges(entity, today, count = NEXT_DAYS) {
  const last = addDays(today, count - 1);
  return (entity.changes ?? [])
    .filter((change) => (change.kind === "trvala" ? change.startsOn > last : change.endsOn > last))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}
