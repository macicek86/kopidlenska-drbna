// Běžná otevírací doba pro vyhledávače a mapy (schema.org, JSON-LD) na stránkách Otevírací doba, Lékaři
// a Sběrné dvory: běžný týden, dočasné změny a zavření (specialOpeningHoursSpecification) a nová doba od data.
import { periodClosed } from "./doctors.js";
import { upcomingNewHours } from "./places.js";
import { addDays, daysBetween, civilWeekday } from "./waste.js";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name) => `https://schema.org/${name}`);

function absolute(base, path) {
  return base ? `${base}${path}` : path;
}

// Telefon jako +420…, jinak nic.
export function ldPhone(phone) {
  const digits = String(phone ?? "").replace(/[^\d+]/g, "");
  if (digits.replace("+", "").length < 9) return "";
  return digits.startsWith("+") ? digits : digits.startsWith("420") ? `+${digits}` : `+420${digits}`;
}

function address(place) {
  const text = String(place ?? "").trim();
  const street = text.replace(/,?\s*Kopidlno$/i, "").trim();
  return {
    "@type": "PostalAddress",
    ...(street && street.toLowerCase() !== "kopidlno" ? { streetAddress: street } : {}),
    addressLocality: "Kopidlno",
    addressCountry: "CZ",
  };
}

// Části dne z týdne lékařů a míst (dopoledne, odpoledne) nebo sběrných dvorů (jeden úsek).
function parts(slot) {
  if ("morning" in slot) return [slot.morning, slot.afternoon].filter((part) => part?.open);
  return slot.open ? [slot] : [];
}

// Stejné časy v různé dny jako jedna položka se seznamem dnů.
export function hoursSpec(week, extra = {}) {
  const groups = new Map();
  for (const slot of week ?? []) {
    for (const part of parts(slot)) {
      const key = `${part.from}-${part.to}`;
      if (!groups.has(key)) groups.set(key, { opens: part.from, closes: part.to, days: [] });
      groups.get(key).days.push(DAY[slot.day]);
    }
  }
  return [...groups.values()].map((group) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: group.days.length === 1 ? group.days[0] : group.days,
    opens: group.opens,
    closes: group.closes,
    ...extra,
  }));
}

function closedSpec(startsOn, endsOn, day = null) {
  return {
    "@type": "OpeningHoursSpecification",
    ...(day == null ? {} : { dayOfWeek: DAY[day] }),
    opens: "00:00",
    closes: "00:00",
    validFrom: startsOn,
    validThrough: endsOn,
  };
}

// Dočasná změna: zavřeno celé období, nebo jiné hodiny ve dny, které do období padnou (ostatní z nich zavřené).
export function changeSpec(change) {
  if (periodClosed(change)) return [closedSpec(change.startsOn, change.endsOn)];
  return hoursInSpan(change);
}

// Jiná doba ve dny, které období zasáhne (u sběrného dvora, kde je den jeden úsek, i bez `periodClosed`).
function hoursInSpan(change) {
  const days = new Set();
  const total = Math.min(daysBetween(change.startsOn, change.endsOn), 6);
  for (let step = 0; step <= total; step += 1) days.add(civilWeekday(addDays(change.startsOn, step)));
  const week = (change.week ?? []).filter((slot) => days.has(slot.day));
  const open = hoursSpec(week, { validFrom: change.startsOn, validThrough: change.endsOn });
  const closed = week.filter((slot) => !parts(slot).length).map((slot) => closedSpec(change.startsOn, change.endsOn, slot.day));
  return [...open, ...closed];
}

function entity(type, id, name, extra) {
  return { "@context": "https://schema.org", "@type": type, "@id": id, name, ...extra };
}

function withHours(spec, special) {
  return {
    ...(spec.length ? { openingHoursSpecification: spec } : {}),
    ...(special.length ? { specialOpeningHoursSpecification: special } : {}),
  };
}

export function placeLd(base, place, today) {
  const url = absolute(base, `/oteviraci-doba#misto-${place.id}`);
  // Nová doba, která teprve přijde: běžná platí do dne před ní, nová od jejího začátku.
  const next = upcomingNewHours(place, today)[0];
  const spec = next
    ? [...hoursSpec(place.week, { validThrough: addDays(next.startsOn, -1) }), ...hoursSpec(next.week, { validFrom: next.startsOn })]
    : hoursSpec(place.week);
  const special = (place.changes ?? []).filter((change) => change.kind !== "trvala").flatMap(changeSpec);
  const phone = ldPhone(place.phone);
  return entity("CivicStructure", url, place.name, {
    ...(place.label ? { description: place.label } : {}),
    url,
    address: address(place.place),
    ...(phone ? { telephone: phone } : {}),
    ...withHours(spec, special),
  });
}

export function doctorLd(base, doctor) {
  const url = absolute(base, `/lekari#lekar-${doctor.id}`);
  const phone = ldPhone(doctor.phone);
  return entity("Physician", url, doctor.name, {
    ...(doctor.specialty ? { description: doctor.specialty } : {}),
    url,
    address: address(doctor.place),
    ...(phone ? { telephone: phone } : {}),
    ...withHours(hoursSpec(doctor.week), (doctor.changes ?? []).flatMap(changeSpec)),
  });
}

export function yardLd(base, yard) {
  const url = absolute(base, `/sberne-dvory#dvur-${yard.id}`);
  const spec = yard.legacy ? [] : hoursSpec(yard.week);
  const special = [
    ...(yard.closures ?? []).map((closure) => closedSpec(closure.startsOn, closure.endsOn)),
    ...(yard.changes ?? []).flatMap(hoursInSpan),
  ];
  return entity("RecyclingCenter", url, yard.name, {
    ...(yard.accepts ? { description: yard.accepts } : {}),
    url,
    address: address(yard.place),
    ...withHours(spec, special),
  });
}
