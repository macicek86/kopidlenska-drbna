// Otevírací doba jako data (/oteviraci-doba.json): místa, lékaři a sběrné dvory s běžným týdnem a změnami,
// které ještě platí nebo přijdou. Pro weby a aplikace, které si chtějí hodiny ukázat samy.
import { periodClosed } from "../doctors.js";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

// Týden po dnech od pondělí, každý den seznam úseků (prázdný = zavřeno).
function weekJson(week) {
  const byDay = new Map((week ?? []).map((slot) => [slot.day, slot]));
  return ORDER.map((day) => {
    const slot = byDay.get(day);
    const parts = !slot ? [] : "morning" in slot ? [slot.morning, slot.afternoon].filter((part) => part?.open) : slot.open ? [slot] : [];
    return { day: DAYS[day], hours: parts.map((part) => ({ from: part.from, to: part.to, ...(part.note ? { note: part.note } : {}) })) };
  });
}

function changeJson(change) {
  const permanent = change.kind === "trvala";
  return {
    kind: permanent ? "new_hours" : periodClosed(change) ? "closed" : "temporary",
    starts_on: change.startsOn,
    ...(permanent ? {} : { ends_on: change.endsOn }),
    note: change.note,
    ...(permanent || !periodClosed(change) ? { week: weekJson(change.week) } : {}),
  };
}

export function hoursJson(base, { places = [], doctors = [], yards = [] }) {
  return {
    source: `${base}/oteviraci-doba`,
    places: places.map((place) => ({
      id: place.id,
      name: place.name,
      label: place.label,
      address: place.place,
      phone: place.phone,
      url: `${base}/oteviraci-doba#misto-${place.id}`,
      week: weekJson(place.week),
      changes: (place.changes ?? []).map(changeJson),
      offers: place.offers ?? [],
    })),
    doctors: doctors.map((doctor) => ({
      id: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      address: doctor.place,
      phone: doctor.phone,
      url: `${base}/lekari#lekar-${doctor.id}`,
      week: weekJson(doctor.week),
      changes: (doctor.changes ?? []).map(changeJson),
    })),
    yards: yards.map((yard) => ({
      id: yard.id,
      name: yard.name,
      address: yard.place,
      accepts: yard.accepts,
      url: `${base}/sberne-dvory#dvur-${yard.id}`,
      ...(yard.legacy ? { hours_text: yard.legacy } : { week: weekJson(yard.week) }),
      closures: (yard.closures ?? []).map((closure) => ({
        kind: "closed",
        starts_on: closure.startsOn,
        ends_on: closure.endsOn,
        note: closure.reason,
      })),
    })),
  };
}
