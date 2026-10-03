// Měsíční kalendář na stránce /akce. Měsíc je v adrese (`?mesic=2026-10`), takže šipky fungují i bez JS;
// `public/events.js` jen vymění kalendář bez načtení celé stránky.
import { esc } from "./html.js";
import { escTie } from "./typo.js";

export const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const MONTHS_SHORT = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];
const WEEK = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];

const pad = (n) => String(n).padStart(2, "0");

export function monthShort(iso) {
  return MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? "";
}

// Měsíc z adresy, jinak ten dnešní. Jen rozumné roky, ať se nedá prolistovat do nekonečna.
export function readMonth(value, today) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? ""));
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= 2020 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
  }
  return { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
}

function shift({ year, month }, by) {
  const index = year * 12 + month - 1 + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const monthKey = ({ year, month }) => `${year}-${pad(month)}`;

function monthHref(month, today) {
  return monthKey(month) === today.slice(0, 7) ? "/akce#kalendar" : `/akce?mesic=${monthKey(month)}#kalendar`;
}

function dayCell(iso, day, events, today) {
  const classes = ["cal-day"];
  if (iso === today) classes.push("is-today");
  else if (iso < today) classes.push("is-past");
  if (events.length) classes.push("has-events");
  const items = events
    .map((event) => `<li><a href="#akce-${event.id}" title="${esc(event.title)}">${escTie(event.title)}</a></li>`)
    .join("");
  return `<li class="${classes.join(" ")}">
          <span class="cal-num">${day}</span>
          ${items ? `<ul class="cal-events">${items}</ul>` : ""}
        </li>`;
}

// Seznam akcí měsíce pod mřížkou: na mobilu místo nadpisů v políčkách, na počítači schovaný.
function monthList(events, today) {
  if (!events.length) return "";
  return `<ul class="cal-list">${events
    .map(
      (event) => `<li${event.startsOn === today ? ` class="is-today"` : ""}>
          <a href="#akce-${event.id}"><span class="cal-list-date">${Number(event.startsOn.slice(8, 10))}. ${esc(monthShort(event.startsOn))}</span> ${escTie(event.title)}</a>
        </li>`,
    )
    .join("")}</ul>`;
}

export function calendarHtml(events, today, monthParam, copy) {
  const current = readMonth(monthParam, today);
  const key = monthKey(current);
  const inMonth = events.filter((event) => event.startsOn.slice(0, 7) === key);
  const byDay = new Map();
  for (const event of inMonth) {
    const day = Number(event.startsOn.slice(8, 10));
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  const days = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate();
  // Týden začíná pondělím.
  const lead = (new Date(Date.UTC(current.year, current.month - 1, 1)).getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(`<li class="cal-day is-blank" aria-hidden="true"></li>`);
  for (let day = 1; day <= days; day += 1) {
    cells.push(dayCell(`${key}-${pad(day)}`, day, byDay.get(day) ?? [], today));
  }
  const prev = shift(current, -1);
  const next = shift(current, 1);
  const away = key !== today.slice(0, 7);
  const label = `${MONTHS[current.month - 1]} ${current.year}`;
  return `<section class="card cal" id="kalendar" data-cal aria-label="${esc(copy.calendar)}">
      <div class="cal-head">
        <a class="cal-arrow" href="${monthHref(prev, today)}" data-cal-nav aria-label="${esc(MONTHS[prev.month - 1])} ${prev.year}">‹</a>
        <h2 tabindex="-1">${esc(label)}</h2>
        <a class="cal-arrow" href="${monthHref(next, today)}" data-cal-nav aria-label="${esc(MONTHS[next.month - 1])} ${next.year}">›</a>
      </div>
      <p class="cal-sub">${
        away ? `<a href="/akce#kalendar" data-cal-nav>${esc(copy.back)}</a>` : ""
      }<span>${esc(copy.count(inMonth.length))}</span></p>
      <div class="cal-week" aria-hidden="true">${WEEK.map((name) => `<span>${name}</span>`).join("")}</div>
      <ol class="cal-grid">${cells.join("")}</ol>
      ${monthList(inMonth, today)}
    </section>`;
}
