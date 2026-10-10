// Zkrácení běžného týdne („jen do 10“, „až od 13“) a pomocníci pro dočasné změny: pro místa a lékaře
// (dopoledne a odpoledne) i sběrné dvory (jeden úsek za den). Používá formulář s více obdobími
// (src/periods.js) i e-mail na otevírací dobu (src/mailin/ai.js).
import { addDays, civilWeekday, daysBetween } from "./waste.js";

// Dny v týdnu (0 = neděle), které období zasáhne; delší než týden zasáhne všechny.
export function spanWeekdays(startsOn, endsOn) {
  const days = new Set();
  const total = Math.min(daysBetween(startsOn, endsOn || startsOn), 6);
  for (let step = 0; step <= total; step += 1) days.add(civilWeekday(addDays(startsOn, step)));
  return days;
}

// Běžný týden zkrácený na „otevírá v“ / „zavírá v“: úseky se jen oříznou, polední pauza zůstane. `days` omezí
// zkrácení na dny v týdnu, které období zasáhne, ostatní zůstanou běžné.
export function trimWeek(week, openFrom, closeAt, days = null) {
  const cut = (part) => {
    if (!part?.open) return part;
    const from = openFrom && openFrom > part.from ? openFrom : part.from;
    const to = closeAt && closeAt < part.to ? closeAt : part.to;
    return from < to ? { ...part, from, to } : { ...part, open: false };
  };
  return (week ?? []).map((slot) => {
    if (days && !days.has(slot.day)) return slot;
    return "morning" in slot ? { ...slot, morning: cut(slot.morning), afternoon: cut(slot.afternoon) } : cut(slot);
  });
}

function openParts(slot) {
  const parts = !slot ? [] : "morning" in slot ? [slot.morning, slot.afternoon] : [slot];
  return parts.filter((part) => part?.open).map((part) => `${part.from}-${part.to}`).join(",");
}

// Mění se v některém ze dnů něco? (Zkrácení „do 15“ v den, který běžně končí ve 14, nic nezmění.)
export function weekDiffers(regular, changed, days) {
  const find = (week, day) => (week ?? []).find((slot) => slot.day === day);
  return [...days].some((day) => openParts(find(regular, day)) !== openParts(find(changed, day)));
}

// Je v některém dni z `days` otevřeno? (Pro zjištění, jestli má změna vůbec něco otevřeného.)
export function anyOpen(week, days = null) {
  return (week ?? []).some((slot) => (!days || days.has(slot.day)) && openParts(slot));
}
