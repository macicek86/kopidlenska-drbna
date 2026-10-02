// Otevírací doba míst v Kopidlně (úřad, knihovna, KVC…): běžný týden, dočasné změny a nová (trvalá) otevírací doba.
// Týden má stejný tvar jako u lékařů (dopoledne a odpoledne), logiku změn bere z doctors.js.
import { addDays } from "./waste.js";
import { blankWeek, HOME_LEAD_DAYS, hasOpenSlot, homeNotice, hoursSummary, numeric } from "./doctors.js";

export { HOME_LEAD_DAYS };
// Jak dlouho titulka upozorňuje na novou otevírací dobu: tolik dní předem a tolik dní potom.
export const NEW_HOURS_DAYS = 14;
export const PLACE_MISSING = "Otevírací doba zatím není doplněná";
const OTHER = "jinou otevírací dobu";

export function temporaryChanges(place) {
  return (place.changes ?? []).filter((change) => change.kind !== "trvala");
}

export function permanentChanges(place) {
  return (place.changes ?? []).filter((change) => change.kind === "trvala");
}

// Nová otevírací doba, o které má titulka mluvit: platí nejvýš NEW_HOURS_DAYS, nebo začne do NEW_HOURS_DAYS.
export function visibleNewHours(place, today) {
  const from = addDays(today, -NEW_HOURS_DAYS);
  const to = addDays(today, NEW_HOURS_DAYS);
  const list = permanentChanges(place).filter((change) => change.startsOn >= from && change.startsOn <= to);
  if (!list.length) return null;
  const started = list.filter((change) => change.startsOn <= today);
  if (started.length) return started.reduce((best, change) => (change.startsOn >= best.startsOn ? change : best));
  return list.reduce((best, change) => (change.startsOn < best.startsOn ? change : best));
}

// Nová otevírací doba, která teprve začne (na stránce místa se ukáže pod běžnou).
export function upcomingNewHours(place, today) {
  return permanentChanges(place)
    .filter((change) => change.startsOn > today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

function newHoursNotice(place, change, today) {
  const when = numeric(change.startsOn, today);
  return {
    name: place.name,
    specialty: place.label,
    state: change.startsOn > today ? `Od ${when} bude mít novou otevírací dobu.` : `Od ${when} má novou otevírací dobu.`,
    detail: hoursSummary(change, PLACE_MISSING),
    note: change.note,
    kind: "new",
    startsOn: change.startsOn,
  };
}

// Upozornění jednoho místa pro titulku: dočasná změna (nebo zavřeno) a nová otevírací doba.
export function placeNotices(place, today) {
  const list = [];
  const temporary = homeNotice({ ...place, changes: temporaryChanges(place) }, today, { other: OTHER });
  if (temporary) list.push(temporary);
  const fresh = visibleNewHours(place, today);
  if (fresh) list.push(newHoursNotice(place, fresh, today));
  return list;
}

// Stejné upozornění u víc míst (třeba knihovna, KVC i hernička zavřené kvůli školení) se na titulce sloučí do jednoho.
export function groupedNotices(places, today) {
  const groups = new Map();
  for (const place of places ?? []) {
    for (const notice of placeNotices(place, today)) {
      const key = [notice.kind, notice.state, notice.note, notice.detail].join("|");
      const group = groups.get(key);
      if (group) group.names.push(notice.name);
      else groups.set(key, { ...notice, names: [notice.name] });
    }
  }
  return [...groups.values()];
}

export function placeSummary(place) {
  return hoursSummary(place, PLACE_MISSING);
}

export { hasOpenSlot };

function slot(day, morning, afternoon) {
  const part = (range, fallback) =>
    range ? { open: true, from: range[0], to: range[1], note: "" } : { open: false, from: fallback[0], to: fallback[1], note: "" };
  return { day, morning: part(morning, ["08:00", "12:00"]), afternoon: part(afternoon, ["13:00", "17:00"]) };
}

function weekOf(slots) {
  const byDay = new Map(slots.map((item) => [item.day, item]));
  return blankWeek().map((item) => byDay.get(item.day) ?? item);
}

const KVC = "Hilmarova 86, Kopidlno";
const KVC_WEEK = [1, 2, 3, 4].map((day) => slot(day, ["09:00", "12:00"], ["13:00", "17:00"])).concat(slot(5, ["09:00", "12:00"]));

// Výchozí místa podle webu města (říjen 2026). Lékárna zatím bez hodin, doplní je redakce.
export const PLACE_SEEDS = [
  {
    name: "Městský úřad",
    label: "Úřední hodiny",
    place: "náměstí Hilmarovo 13, Kopidlno",
    phone: "493 655 682",
    week: weekOf([
      slot(1, ["08:00", "12:00"], ["13:00", "17:00"]),
      slot(2, ["08:00", "12:00"], ["13:00", "15:00"]),
      slot(3, ["08:00", "12:00"], ["13:00", "17:00"]),
      slot(4, ["08:00", "12:00"], ["13:00", "15:00"]),
      slot(5, ["08:00", "12:00"]),
    ]),
  },
  {
    name: "Knihovna",
    label: "Městská knihovna",
    place: KVC,
    phone: "724 773 142",
    week: weekOf([slot(1, null, ["13:00", "17:00"]), slot(2, ["09:00", "12:00"], ["13:00", "17:00"]), slot(4, ["09:00", "12:00"], ["13:00", "17:00"])]),
  },
  { name: "Komunitní a vzdělávací centrum", label: "KVC", place: KVC, phone: "776 080 190", week: weekOf(KVC_WEEK) },
  { name: "Dětská hernička", label: "V KVC, 1. patro", place: KVC, phone: "776 080 190", week: weekOf(KVC_WEEK) },
  {
    name: "Turistické informační centrum",
    label: "Infocentrum, od října do května",
    place: KVC,
    phone: "725 817 938",
    week: weekOf([1, 2, 3, 4].map((day) => slot(day, ["08:00", "12:00"], ["13:00", "17:00"])).concat(slot(5, ["08:00", "12:00"]))),
  },
  { name: "Lékárna", label: "Lékárna", place: "Kopidlno", phone: "", week: blankWeek() },
].map((seed, index) => ({ ...seed, sortOrder: index, published: 1 }));
