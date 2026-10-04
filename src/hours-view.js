// Stránky s týdenními hodinami: Lékaři a Otevírací doba. Sdílí výpis týdne, upozornění a dlaždice změn.
import { text as tx } from "./copy.js";
import { hasOpenSlot } from "./doctors.js";
import { esc } from "./html.js";
import { nowOverview } from "./hours-now.js";
import { laterChangeTiles, nextDaysList, popover, popoverButton, regularWeekList } from "./hours-week-view.js";
import { placeNotices } from "./places.js";
import { askLine, layout } from "./view.js";

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

function noticeBanner(notice, extraClass = "") {
  const lead = `${notice.name} ${notice.state.charAt(0).toLowerCase()}${notice.state.slice(1)}`;
  return `<div class="banner doctor-notice${extraClass}"><p>${glueDates(lead)}</p>${notice.note ? `<p class="banner-note">${glueDates(notice.note)}</p>` : ""}</div>`;
}

// Hodiny jednoho lékaře nebo místa: příštích 7 dní, pod nimi běžný týden v okně a změny, které do 7 dní nespadají.
function hoursBlock(entity, today, ctx, keys) {
  if (!hasOpenSlot(entity.week) && !(entity.changes ?? []).length) {
    return { days: `<p class="muted">${esc(tx(ctx.copy, keys.missing))}</p>`, more: "" };
  }
  const id = `bezne-${keys.prefix}-${entity.id}`;
  const label = tx(ctx.copy, keys.regular);
  const regular = hasOpenSlot(entity.week)
    ? `<p class="regular-hours">${popoverButton(id, label)}</p>${popover(id, entity.name, label, regularWeekList(entity.week))}`
    : "";
  const tiles = laterChangeTiles(entity, today, keys.prefix);
  const later = tiles ? `<p class="kicker">${esc(tx(ctx.copy, keys.changes))}</p><div class="dates compact">${tiles}</div>` : "";
  return { days: nextDaysList(entity, today), more: `${regular}${later}` };
}

const DOCTOR_KEYS = { prefix: "lekar", missing: "doctors_missing_hours", regular: "doctors_regular", changes: "doctors_changes" };
const PLACE_KEYS = { prefix: "misto", missing: "places_missing_hours", regular: "places_regular", changes: "places_changes" };

export function doctorsPage(data, ctx) {
  const today = data.waste.today;
  const cards = (data.doctors ?? []).length
    ? (data.doctors ?? [])
        .map((doctor) => {
          const phone = phoneLink(doctor.phone);
          const { days, more } = hoursBlock(doctor, today, ctx, DOCTOR_KEYS);
          return `<article class="card yard">
            <p class="kicker">${esc(doctor.specialty)}</p>
            <h2>${esc(doctor.name)}</h2>
            <p class="meta">${esc(doctor.place)}${phone ? ` · ${phone}` : ""}</p>
            <p class="kicker">${esc(tx(ctx.copy, "doctors_hours"))}</p>
            ${days}
            ${more}
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
      ${askLine(ctx, "doctors", "U lékařů je něco špatně: ")}
      <div class="stack doctor-grid">${cards}</div>`,
  });
}

// Co místo nabízí, v okně. Bez seznamu nic.
function offersBlock(place, ctx) {
  if (!place.offers?.length) return "";
  const id = `nabidka-misto-${place.id}`;
  const label = tx(ctx.copy, "places_offers");
  const list = `<ul class="offer-list">${place.offers.map((offer) => `<li>${esc(offer)}</li>`).join("")}</ul>`;
  return `<p class="place-offers">${popoverButton(id, label)}</p>${popover(id, place.name, label, list)}`;
}

function placeCard(place, today, ctx) {
  // Nová doba, která už platí, má nahoře upozornění (titulka o ní mluví ještě 14 dní).
  const banners = placeNotices(place, today)
    .filter((notice) => notice.kind === "new" && notice.startsOn <= today)
    .map((notice) => noticeBanner(notice, " is-new"))
    .join("");
  const phone = phoneLink(place.phone);
  const { days, more } = hoursBlock(place, today, ctx, PLACE_KEYS);
  const meta = [esc(place.place), phone].filter(Boolean).join(" · ");
  return `<article class="card yard place-card" id="misto-${place.id}">
    <div class="place-head">
      ${place.label ? `<p class="kicker">${esc(place.label)}</p>` : ""}
      <h2>${esc(place.name)}</h2>
      ${meta ? `<p class="meta">${meta}</p>` : ""}
      ${banners}
    </div>
    <p class="kicker">${esc(tx(ctx.copy, "places_hours"))}</p>
    ${days}
    <div class="place-more">${offersBlock(place, ctx)}${more}</div>
  </article>`;
}

export function placesPage(data, ctx) {
  const today = data.waste.today;
  const places = data.places ?? [];
  const cards = places.length
    ? places.map((place) => placeCard(place, today, ctx)).join("")
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "places_empty"))}</p>`;
  // Nahoře kdo má teď otevřeno, řádky vedou na karty míst. Bez času (třeba v testu) jen rychlé odkazy.
  const jump = data.now
    ? nowOverview(places, data.now, tx(ctx.copy, "places_now"))
    : places.length > 1
      ? `<nav class="place-jump" aria-label="Rychlý přechod na místo">${places
          .map((place) => `<a class="chip" href="#misto-${place.id}">${esc(place.name)}</a>`)
          .join("")}</nav>`
      : "";
  const ask = askLine(ctx, "places", "Chybí mi tu místo: ");
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
      <div class="stack place-grid places-list">${cards}</div>`,
  });
}
