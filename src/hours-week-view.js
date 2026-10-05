// Výpis hodin lékařů a míst: běžný týden od pondělí, a když se v příštích 7 dnech něco mění, příštích 7 dní (stejné dny po sobě sloučené, změny přepíšou běžné hodiny a jsou zvýrazněné),
// běžný týden v okně a stručné dlaždice změn, které do 7 dní celé nespadají.
import { periodClosed } from "./doctors.js";
import { addDays, civilWeekday, daysBetween } from "./waste.js";
import { esc } from "./html.js";
import { dayGroups, laterChanges, weekGroups } from "./hours-days.js";
import { closureLabel, dayLabel } from "./view.js";
import { formatLong } from "./format.js";

// Dopoledne a odpoledne se nepíše, je to zřejmé z času.
function partLine(part) {
  if (!part?.open) return "";
  const note = part.note ? `<span class="hint">${esc(part.note)}</span>` : "";
  return `<p class="part"><span class="slot"><strong>${esc(`${part.from}–${part.to}`)}</strong></span>${note}</p>`;
}

function dayBody(slot) {
  const parts = `${partLine(slot.morning)}${partLine(slot.afternoon)}`;
  return parts ? `<div class="parts">${parts}</div>` : `<strong>zavřeno</strong>`;
}

function shortDate(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return `${day}.&nbsp;${month}.`;
}

// Běžný týden (v okně „Běžné hodiny“, bez zvýraznění dneška).
export function regularWeekList(week) {
  return `<ul class="week-list doctor-week">${(week ?? [])
    .map((slot) => {
      const open = Boolean(slot.morning?.open || slot.afternoon?.open);
      return `<li${open ? "" : ` class="is-off"`}><span class="day">${esc(dayLabel(slot.day))}</span>${dayBody(slot)}</li>`;
    })
    .join("")}</ul>`;
}

// Časy bez poznámek jdou na jeden řádek, s poznámkou má každý svůj.
function groupBody(slot) {
  const parts = [slot.morning, slot.afternoon].filter((part) => part?.open);
  if (!parts.length || parts.some((part) => part.note)) return dayBody(slot);
  return `<p class="parts one-line">${parts.map((part) => `<strong>${esc(`${part.from}–${part.to}`)}</strong>`).join(", ")}</p>`;
}

// „Pondělí 5. 10.“, sloučené dny „Pondělí–čtvrtek 5.–8. 10.“ (přes konec měsíce „30. 9.–2. 10.“).
function groupLabel(from, to) {
  const first = dayLabel(civilWeekday(from));
  if (from === to) return `${esc(first)} ${shortDate(from)}`;
  const last = dayLabel(civilWeekday(to)).toLowerCase();
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? `${Number(from.slice(8))}.` : shortDate(from);
  return `${esc(first)}–${esc(last)} ${start}–${shortDate(to)}`;
}

// Běžný týden sloučený s daty tohoto týdne („Pondělí–čtvrtek 5.–8. 10.“), od pondělí do neděle.
// Řádek s dneškem je zvýrazněný.
export function weekGroupsList(week, today) {
  const offset = (day) => (day + 6) % 7;
  const monday = addDays(today, -offset(civilWeekday(today)));
  return `<ul class="week-list doctor-week next-days">${weekGroups(week)
    .map(({ from, to, slot }) => {
      const first = addDays(monday, offset(from));
      const last = addDays(monday, offset(to));
      const isToday = first <= today && today <= last;
      const mark = isToday ? `<span class="today-mark">dnes</span>` : "";
      return `<li${isToday ? ` class="is-today"` : ""}><span class="day">${groupLabel(first, last)}${mark}</span>${groupBody(slot)}</li>`;
    })
    .join("")}</ul>`;
}

// Zavření přes víc než týden: „Středa 7. 10. – úterý 20. 10.“ (kratší jako ostatní řádky).
function rangeLabel(from, to) {
  if (daysBetween(from, to) < 7) return groupLabel(from, to);
  return `${esc(dayLabel(civilWeekday(from)))} ${shortDate(from)} – ${esc(dayLabel(civilWeekday(to)).toLowerCase())} ${shortDate(to)}`;
}

// Příštích 7 dní od dneška. Den se změnou má štítek a důvod změny.
export function nextDaysList(entity, today) {
  return `<ul class="week-list doctor-week next-days">${dayGroups(entity, today)
    .map(({ from, to, slot, change, kind, whole }) => {
      const open = Boolean(slot.morning?.open || slot.afternoon?.open);
      const isToday = from <= today && today <= to;
      const classes = [isToday ? "is-today" : "", change ? "is-change" : "", open ? "" : "is-off"].filter(Boolean).join(" ");
      const mark = isToday ? `<span class="today-mark">dnes</span>` : "";
      const label = kind === "nova" ? "nová doba" : "změna";
      const note = change
        ? `<p class="change-note"><span class="change-mark">${label}</span>${change.note ? ` ${esc(change.note)}` : ""}</p>`
        : "";
      return `<li${classes ? ` class="${classes}"` : ""}><span class="day">${whole ? rangeLabel(from, to) : groupLabel(from, to)}${mark}</span>${groupBody(slot)}${note}</li>`;
    })
    .join("")}</ul>`;
}

// Rozpis změny: krátká změna po dnech s datem, delší jako týden.
function changeDetail(change) {
  if (change.kind !== "trvala" && daysBetween(change.startsOn, change.endsOn) < 7) {
    const days = Array.from({ length: daysBetween(change.startsOn, change.endsOn) + 1 }, (_, step) => addDays(change.startsOn, step));
    return `<ul class="week-list doctor-week">${days
      .map((iso) => {
        const slot = change.week.find((item) => item.day === civilWeekday(iso));
        const open = Boolean(slot?.morning?.open || slot?.afternoon?.open);
        return `<li${open ? "" : ` class="is-off"`}><span class="day">${esc(dayLabel(slot?.day))} ${shortDate(iso)}</span>${slot ? dayBody(slot) : "<strong>zavřeno</strong>"}</li>`;
      })
      .join("")}</ul>`;
  }
  return regularWeekList(change.week);
}

// Okno nad stránkou bez JS (HTML popover): otevře ho tlačítko, zavře křížek, Esc nebo klik vedle.
export function popoverButton(id, label, className = "pop-open") {
  return `<button type="button" class="${className}" popovertarget="${id}">${esc(label)}</button>`;
}

export function popover(id, title, subtitle, body) {
  return `<div class="hours-pop" id="${id}" popover>
    <div class="hours-pop-head">
      <div><p class="kicker">${esc(subtitle)}</p><h3>${esc(title)}</h3></div>
      <button type="button" class="pop-close" popovertarget="${id}" popovertargetaction="hide" aria-label="Zavřít">×</button>
    </div>
    <div class="hours-pop-body">${body}</div>
  </div>`;
}

// Změny mimo 7 dní: datum, co se děje a důvod. Rozpis hodin je v okně.
// `prefix` dělá id oken jedinečná (lékaři a místa mají vlastní číselné řady).
export function laterChangeTiles(entity, today, prefix) {
  return laterChanges(entity, today)
    .map((change) => {
      const fresh = change.kind === "trvala";
      const closed = !fresh && periodClosed(change);
      const when = fresh ? `od ${formatLong(change.startsOn)}` : closureLabel(change);
      const state = fresh ? "Nová doba" : closed ? "Zavřeno" : "Jiné hodiny";
      const id = `rozpis-${prefix}-${change.id}`;
      const detail = closed ? "" : `${popoverButton(id, "Rozpis")}${popover(id, entity.name, when, changeDetail(change))}`;
      return `<article class="date-tile"><strong>${esc(when)}</strong><span class="tile-state">${state}</span>${change.note ? `<span>${esc(change.note)}</span>` : ""}${detail}</article>`;
    })
    .join("");
}
