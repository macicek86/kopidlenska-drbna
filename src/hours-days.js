// Příštích 7 dní lékaře nebo místa: běžné hodiny, které na konkrétní den přepíše změna.
// Dočasná změna platí od starts_on do ends_on (u překryvu ta, která začíná později),
// nová (trvalá) doba místa od starts_on dál. Z ní se den zvýrazní jen dokud nezačne platit (pak je to běžná doba).
import { periodClosed } from "./doctors.js";
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

function samePart(a, b) {
  if (!a?.open || !b?.open) return !a?.open && !b?.open;
  return a.from === b.from && a.to === b.to && (a.note ?? "") === (b.note ?? "");
}

function sameSlot(a, b) {
  return samePart(a.morning, b.morning) && samePart(a.afternoon, b.afternoon);
}

// Jeden den: hodiny, které ten den opravdu platí, a změna, ze které jsou (nebo null).
// Den, který změna nechává stejný jako běžně (třeba zavřená neděle), se nezvýrazní.
export function hoursOn(entity, iso, today) {
  const changes = entity.changes ?? [];
  const regular = slotOf(entity.week, iso);
  const temporary = changes.filter((change) => change.kind !== "trvala" && change.startsOn <= iso && iso <= change.endsOn).reduce(laterChange, null);
  const fresh = temporary
    ? null
    : changes.filter((change) => change.kind === "trvala" && change.startsOn > today && change.startsOn <= iso).reduce(laterChange, null);
  const change = temporary ?? fresh;
  if (!change) return { iso, slot: regular, change: null, kind: "" };
  const slot = slotOf(change.week, iso);
  if (sameSlot(slot, regular)) return { iso, slot, change: null, kind: "" };
  return { iso, slot, change, kind: temporary ? "zmena" : "nova" };
}

export function nextDays(entity, today, count = NEXT_DAYS) {
  return Array.from({ length: count }, (_, step) => hoursOn(entity, addDays(today, step), today));
}

// Mění se v příštích 7 dnech něco proti běžným hodinám? Jen pak se hodiny vypíšou po dnech s datem.
export function changesSoon(entity, today, count = NEXT_DAYS) {
  return nextDays(entity, today, count).some((day) => day.change);
}

// Zavření (dočasná změna bez jediné otevřené hodiny) je v 7 dnech jeden řádek přes celé období.
function wholeClosure(change) {
  return Boolean(change) && change.kind !== "trvala" && periodClosed(change);
}

// Změny, které v 7 dnech celé nejsou (začnou nebo skončí později). Ty se ukážou zvlášť pod dny.
// Zavření, které v 7 dnech začne, tam má řádek i s koncem, takže zvlášť není.
export function laterChanges(entity, today, count = NEXT_DAYS) {
  const last = addDays(today, count - 1);
  return (entity.changes ?? [])
    .filter((change) => (change.kind === "trvala" ? change.startsOn > last : change.endsOn > last))
    .filter((change) => !(wholeClosure(change) && change.startsOn <= last))
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

function sameChange(a, b) {
  return (a.change?.id ?? null) === (b.change?.id ?? null) && a.kind === b.kind;
}

// Příštích 7 dní sloučené: po sobě jdoucí dny se stejnými hodinami (a stejnou změnou) jsou jeden řádek,
// dnešek je vždy zvlášť. Běžně zavřené dny se vynechají, zavřeno kvůli změně zůstane.
// Zavření je jeden řádek od začátku do konce (i přes dnešek, víkend a za 7 dní), `whole` to označí.
export function dayGroups(entity, today, count = NEXT_DAYS) {
  const groups = [];
  for (const day of nextDays(entity, today, count)) {
    const last = groups.at(-1);
    if (wholeClosure(day.change)) {
      if (!groups.some((group) => group.whole && group.change.id === day.change.id)) {
        groups.push({ ...day, from: day.change.startsOn, to: day.change.endsOn, whole: true });
      }
      continue;
    }
    const joins = last && day.iso !== today && last.from !== today && sameChange(last, day) && sameSlot(last.slot, day.slot);
    if (joins) last.to = day.iso;
    else groups.push({ ...day, from: day.iso, to: day.iso });
  }
  // Dnešek, který je běžně zavřený uprostřed zavření, nemá vlastní řádek: „dnes“ je u zavření.
  const closedToday = groups.some((group) => group.whole && group.from <= today && today <= group.to);
  const shown = groups.filter((group) =>
    group.from === today && !group.change ? !closedToday : group.change || group.slot.morning?.open || group.slot.afternoon?.open,
  );
  // Končí výpis zavřením, je vidět i první den, kdy se zase otevře (i za 7 dní).
  const last = shown.at(-1);
  if (last?.whole) {
    const open = firstOpenAfter(entity, last.to, today);
    if (open) shown.push({ ...open, from: open.iso, to: open.iso, reopen: true });
  }
  return shown;
}

// První otevřený den po `iso` (nejvýš za dva měsíce), nebo null.
function firstOpenAfter(entity, iso, today) {
  for (let step = 1; step <= 62; step += 1) {
    const day = hoursOn(entity, addDays(iso, step), today);
    if (day.slot.morning?.open || day.slot.afternoon?.open) return day;
  }
  return null;
}

// Běžný týden od pondělí sloučený stejně jako 7 dní: stejné dny po sobě jsou jeden řádek, zavřené dny chybí.
// Neposouvá se podle dneška, data jsou z tohoto týdne.
export function weekGroups(week) {
  const groups = [];
  for (const slot of week ?? []) {
    const last = groups.at(-1);
    if (last && sameSlot(last.slot, slot)) last.to = slot.day;
    else groups.push({ slot, from: slot.day, to: slot.day });
  }
  return groups.filter((group) => group.slot.morning?.open || group.slot.afternoon?.open);
}
