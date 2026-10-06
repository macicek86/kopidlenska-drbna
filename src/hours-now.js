// Otevírací doba: kdo má teď otevřeno. Jeden řádek na místo nahoře na stránce, odkaz vede na jeho kartu.
// Počítá se z hodin, které ten den opravdu platí (i se změnou), takže dovolená nebo zavírka je vidět i tady.
import { changeOver, hasOpenSlot } from "./doctors.js";
import { esc } from "./html.js";
import { hoursOn, NEXT_DAYS } from "./hours-days.js";
import { addDays, civilWeekday } from "./waste.js";

const WHEN = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];

function spans(slot) {
  return [slot.morning, slot.afternoon].filter((part) => part?.open).sort((a, b) => a.from.localeCompare(b.from));
}

// „08:00“ → „8:00“, v souvislém textu se nula na začátku nepíše.
function clock(time) {
  return time.replace(/^0(?=\d)/, "");
}

function whenLabel(iso, today) {
  if (iso === addDays(today, 1)) return "zítra";
  return WHEN[civilWeekday(iso)];
}

// Stav místa v daný čas: { open, text, note }. `now` je { date, time } v Praze.
export function stateNow(entity, now) {
  const today = now.date;
  const day = hoursOn(entity, today, today);
  // Změna, která dnes po zavření skončila, už poznámku nedává.
  const note = day.change && !changeOver(day.change, now) ? (day.change.note ?? "") : "";
  const parts = spans(day.slot);
  const current = parts.find((part) => part.from <= now.time && now.time < part.to);
  if (current) return { open: true, text: `Otevřeno do ${clock(current.to)}`, note: "" };
  const later = parts.find((part) => part.from > now.time);
  if (later) {
    const text = parts.some((part) => part.to <= now.time) ? `Pauza, znovu od ${clock(later.from)}` : `Dnes od ${clock(later.from)}`;
    return { open: false, soon: true, text, note };
  }
  for (let step = 1; step <= NEXT_DAYS; step += 1) {
    const iso = addDays(today, step);
    const next = hoursOn(entity, iso, today);
    const first = spans(next.slot)[0];
    if (first) return { open: false, text: `Zavřeno, ${whenLabel(iso, today)} od ${clock(first.from)}`, note: note || (next.change?.note ?? "") };
  }
  return { open: false, text: "Zavřeno", note };
}

export function nowOverview(places, now, heading) {
  const rows = places
    .filter((place) => hasOpenSlot(place.week) || (place.changes ?? []).length)
    .map((place) => {
      const state = stateNow(place, now);
      const kind = state.open ? "is-open" : state.soon ? "is-soon" : "is-closed";
      const note = state.note ? `<span class="now-note">${esc(state.note)}</span>` : "";
      return `<li class="${kind}"><a href="#misto-${place.id}">${esc(place.name)}</a><span class="now-state">${esc(state.text)}${note}</span></li>`;
    })
    .join("");
  if (!rows) return "";
  return `<section class="card now-board" aria-labelledby="ted-otevreno">
    <h2 id="ted-otevreno">${esc(heading)} <span class="now-time">${esc(clock(now.time))}</span></h2>
    <ul class="now-list">${rows}</ul>
  </section>`;
}
