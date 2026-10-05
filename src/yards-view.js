// Stránka Sběrné dvory: běžný týden, stav teď a mimořádná uzavření.
import { text as tx } from "./copy.js";
import { esc } from "./html.js";
import { yardLd } from "./hours-ld.js";
import { shareLayout, sharedRow } from "./hours-share.js";
import { addDays, civilWeekday } from "./waste.js";
import { coversDay, homeStatus, statusLine } from "./yards.js";
import { askLine, clockOf, closureLabel, dayLabel, layout, siteOrigin } from "./view.js";

// Běžný týden od pondělí. Den, jehož nejbližší výskyt (dnes až za 6 dní) padne do mimořádného
// uzavření, má hodiny přeškrtnuté.
function weekList(week, today, closures = []) {
  const todayDay = civilWeekday(today);
  return `<ul class="week-list">${week
    .map((slot) => {
      const date = addDays(today, (slot.day - todayDay + 7) % 7);
      const closed = slot.open && closures.some((closure) => coversDay(closure, date));
      const classes = [slot.day === todayDay ? "is-today" : "", slot.open ? "" : "is-off", closed ? "is-closure" : ""]
        .filter(Boolean)
        .join(" ");
      const hours = esc(`${slot.from}–${slot.to}`);
      const when = closed
        ? `<em>zavřeno ${shortDay(date)}</em> <s>${hours}</s>`
        : slot.open
          ? hours
          : "zavřeno";
      return `<li${classes ? ` class="${classes}"` : ""}><span>${esc(dayLabel(slot.day))}</span><strong>${when}</strong></li>`;
    })
    .join("")}</ul>`;
}

function shortDay(iso) {
  const [, month, day] = iso.split("-").map(Number);
  return `${day}.&nbsp;${month}.`;
}

function yardStatusHtml(yard, now) {
  const item = homeStatus(yard, now.date, now.time);
  const line = esc(statusLine(yard, now.date, now.time));
  if (item.kind === "closure") return `<p class="banner">${line}</p>`;
  if (item.kind === "open") return `<p class="count">${line}</p>`;
  if (item.kind === "later") return `<p class="soon">${line}</p>`;
  return `<p class="meta">${line}</p>`;
}

export function yardsPage(data, ctx, params) {
  const today = data.waste.today;
  const now = clockOf(data);
  const yards = data.yards ?? [];
  // Jeden dvůr přes celou šířku jako dřív, dva vedle sebe, víc po třech.
  const several = yards.length > 1;
  const grid = several ? ` place-grid ${yards.length === 2 ? "yard-grid-2" : "yard-grid-3"}` : "";
  const cards = yards.length
    ? yards
        .map((yard) => {
          const later = yard.closures.filter((closure) => closure.startsOn > today);
          const planned = later.length
            ? `<p class="kicker">${esc(tx(ctx.copy, "yards_upcoming"))}</p><div class="dates compact">${later
                .map(
                  (closure) =>
                    `<article class="date-tile"><strong>${esc(closureLabel(closure))}</strong><span>${esc(closure.reason)}</span></article>`,
                )
                .join("")}</div>`
            : "";
          const hours = yard.legacy
            ? `<p class="keep-lines">${esc(yard.legacy)}</p>`
            : weekList(yard.week, today, yard.closures);
          // Víc dvorů: stejné řádky mřížky jako karty otevírací doby (záhlaví, nadpis týdne, 7 dnů, uzavření).
          return `<article class="card yard${several ? " place-card" : ""}" id="dvur-${yard.id}">
            <div class="place-head">
              <p class="kicker">${esc(yard.place)}</p>
              <h2>${esc(yard.name)}</h2>
              ${yardStatusHtml(yard, now)}
              <p class="kicker">${esc(tx(ctx.copy, "yards_accepts"))}</p>
              <p class="keep-lines">${esc(yard.accepts)}</p>
            </div>
            <p class="kicker">${esc(tx(ctx.copy, "yards_hours"))}</p>
            ${hours}
            <div class="place-more">${planned}</div>
          </article>`;
        })
        .join("")
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "yards_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "yards_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "yards_description"),
    ...shareLayout("dvur", sharedRow("dvur", yards, params), today, tx(ctx.copy, "site_name")),
    jsonLd: ctx.feedOn?.hoursLd === false ? [] : yards.map((yard) => yardLd(siteOrigin(ctx.origin, ctx.mainOrigin), yard)),
    feeds: [["/oteviraci-doba/feed.xml", "Změny otevírací doby"]],
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "yards_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "yards_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "yards_lede"))}</p>
      ${askLine(ctx, "yards", "U sběrných dvorů je něco špatně: ")}
      <div class="stack${grid}">${cards}</div>`,
  });
}

