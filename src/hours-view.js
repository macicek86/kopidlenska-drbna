// Stránky s týdenními hodinami: Lékaři a Otevírací doba. Sdílí výpis týdne, upozornění a dlaždice změn.
import { text as tx } from "./copy.js";
import { activeChange, hasOpenSlot, homeNotice, periodClosed, spanSummary } from "./doctors.js";
import { esc } from "./html.js";
import { formatLong } from "./format.js";
import { placeNotices, placeSummary, temporaryChanges, upcomingNewHours } from "./places.js";
import { closureLabel, dayLabel, layout } from "./view.js";
import { civilWeekday } from "./waste.js";

function phoneLink(phone) {
  const text = String(phone ?? "").trim();
  if (!text) return "";
  const digits = text.replace(/[^\d+]/g, "");
  if (digits.length < 9) return esc(text);
  const href = digits.startsWith("+") ? digits : digits.startsWith("420") ? `+${digits}` : `+420${digits}`;
  return `<a href="tel:${esc(href)}">${esc(text)}</a>`;
}

function glueDates(text) {
  return esc(text)
    .replace(/(\d+)\. (\d+)\.(?: (\d{4}))?/g, (_, day, month, year) =>
      year ? `${day}.&nbsp;${month}.&nbsp;${year}` : `${day}.&nbsp;${month}.`,
    )
    .replace(/ (od|do) (?=\d)/g, " $1&nbsp;");
}

// Dopoledne a odpoledne se nepíše, je to zřejmé z času.
function partLine(part) {
  if (!part?.open) return "";
  const note = part.note ? `<span class="hint">${esc(part.note)}</span>` : "";
  return `<p class="part"><span class="slot"><strong>${esc(`${part.from}–${part.to}`)}</strong></span>${note}</p>`;
}

function doctorWeekList(week, today, { superseded = false } = {}) {
  const todayDay = civilWeekday(today);
  return `<ul class="week-list doctor-week">${week
    .map((slot) => {
      const morning = partLine(slot.morning);
      const afternoon = partLine(slot.afternoon);
      const open = Boolean(morning || afternoon);
      const todayRow = slot.day === todayDay;
      const loud = todayRow && !superseded;
      const classes = [loud ? "is-today" : "", todayRow && superseded ? "is-quiet" : "", open ? "" : "is-off"].filter(Boolean).join(" ");
      const mark = loud
        ? `<span class="today-mark">dnes</span>`
        : todayRow
          ? `<span class="today-quiet">dnes neplatí</span>`
          : "";
      const body = open ? `<div class="parts">${morning}${afternoon}</div>` : `<strong>zavřeno</strong>`;
      return `<li${classes ? ` class="${classes}"` : ""}><span class="day">${esc(dayLabel(slot.day))}${mark}</span>${body}</li>`;
    })
    .join("")}</ul>`;
}

function doctorChangeTiles(changes) {
  return changes
    .map((change) => {
      const hours = periodClosed(change) ? "Zavřeno" : spanSummary(change);
      return `<article class="date-tile"><strong>${esc(closureLabel(change))}</strong><span>${esc(change.note)}</span><span>${esc(hours)}</span></article>`;
    })
    .join("");
}

function noticeBanner(notice, extraClass = "") {
  const lead = `${notice.name} ${notice.state.charAt(0).toLowerCase()}${notice.state.slice(1)}`;
  return `<div class="banner doctor-notice${extraClass}"><p>${glueDates(lead)}</p>${notice.note ? `<p class="banner-note">${glueDates(notice.note)}</p>` : ""}${notice.detail ? `<p class="banner-note">${glueDates(notice.detail)}</p>` : ""}</div>`;
}

export function doctorsPage(data, ctx) {
  const today = data.waste.today;
  const cards = (data.doctors ?? []).length
    ? (data.doctors ?? [])
        .map((doctor) => {
          const current = activeChange(doctor, today);
          const notice = current ? homeNotice(doctor, today) : null;
          const banner = notice ? noticeBanner(notice) : "";
          const rest = doctor.changes.filter((change) => change.id !== current?.id);
          const planned = rest.length
            ? `<p class="kicker">${esc(tx(ctx.copy, "doctors_changes"))}</p><div class="dates compact">${doctorChangeTiles(rest)}</div>`
            : "";
          const phone = phoneLink(doctor.phone);
          const hours = hasOpenSlot(doctor.week)
            ? doctorWeekList(doctor.week, today, { superseded: Boolean(notice) })
            : `<p class="muted">${esc(tx(ctx.copy, "doctors_missing_hours"))}</p>`;
          return `<article class="card yard">
            <p class="kicker">${esc(doctor.specialty)}</p>
            <h2>${esc(doctor.name)}</h2>
            <p class="meta">${esc(doctor.place)}${phone ? ` · ${phone}` : ""}</p>
            ${banner}
            <p class="kicker">${esc(tx(ctx.copy, banner ? "doctors_regular" : "doctors_hours"))}</p>
            ${hours}
            ${planned}
          </article>`;
        })
        .join("")
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "doctors_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "doctors_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "doctors_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "doctors_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "doctors_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "doctors_lede"))}</p>
      <div class="stack doctor-grid">${cards}</div>`,
  });
}

function newHoursTiles(changes) {
  return changes
    .map(
      (change) =>
        `<article class="date-tile"><strong>od ${esc(formatLong(change.startsOn))}</strong>${change.note ? `<span>${esc(change.note)}</span>` : ""}<span>${esc(placeSummary(change))}</span></article>`,
    )
    .join("");
}

function placeCard(place, today, ctx) {
  const temporary = temporaryChanges(place);
  const current = activeChange({ changes: temporary }, today);
  const notices = placeNotices(place, today).filter((notice) => (notice.kind === "new" ? notice.startsOn <= today : Boolean(current)));
  const banners = notices.map((notice) => noticeBanner(notice, notice.kind === "new" ? " is-new" : "")).join("");
  const rest = temporary.filter((change) => change.id !== current?.id);
  const planned = rest.length
    ? `<p class="kicker">${esc(tx(ctx.copy, "places_changes"))}</p><div class="dates compact">${doctorChangeTiles(rest)}</div>`
    : "";
  const upcoming = upcomingNewHours(place, today);
  const later = upcoming.length
    ? `<p class="kicker">${esc(tx(ctx.copy, "places_new_hours"))}</p><div class="dates compact">${newHoursTiles(upcoming)}</div>`
    : "";
  const phone = phoneLink(place.phone);
  const hours = hasOpenSlot(place.week)
    ? doctorWeekList(place.week, today, { superseded: Boolean(current) })
    : `<p class="muted">${esc(tx(ctx.copy, "places_missing_hours"))}</p>`;
  const meta = [esc(place.place), phone].filter(Boolean).join(" · ");
  // Bloky karty jsou řádky mřížky (záhlaví, nadpis týdne, 7 dnů, změny), na počítači se srovnají s kartami vedle.
  return `<article class="card yard place-card" id="misto-${place.id}">
    <div class="place-head">
      ${place.label ? `<p class="kicker">${esc(place.label)}</p>` : ""}
      <h2>${esc(place.name)}</h2>
      ${meta ? `<p class="meta">${meta}</p>` : ""}
      ${banners}
    </div>
    <p class="kicker">${esc(tx(ctx.copy, current ? "places_regular" : "places_hours"))}</p>
    ${hours}
    <div class="place-more">${planned}${later}</div>
  </article>`;
}

export function placesPage(data, ctx) {
  const today = data.waste.today;
  const places = data.places ?? [];
  const cards = places.length
    ? places.map((place) => placeCard(place, today, ctx)).join("")
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "places_empty"))}</p>`;
  const jump = places.length > 1
    ? `<nav class="place-jump" aria-label="Rychlý přechod na místo">${places
        .map((place) => `<a class="chip" href="#misto-${place.id}">${esc(place.name)}</a>`)
        .join("")}</nav>`
    : "";
  // Chybějící místo: s chatem otevře Drběnu s předvyplněnou větou, bez něj vede na kontakt.
  const ask = `<p class="place-ask">${esc(tx(ctx.copy, "places_ask"))} ${
    ctx.chat
      ? `<a href="/o-nas" data-chat-open="Chybí mi tu místo: ">${esc(tx(ctx.copy, "places_ask_chat"))}</a>`
      : `<a href="/o-nas">${esc(tx(ctx.copy, "places_ask_mail"))}</a>`
  }</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "places_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "places_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "places_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "places_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "places_lede"))}</p>
      ${ask}
      ${jump}
      <div class="stack place-grid">${cards}</div>`,
  });
}
