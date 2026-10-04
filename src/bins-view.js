import { esc } from "./html.js";
import { text as tx } from "./copy.js";
import { countdownLabel, formatDayMonth, formatLong, ruleLabel, weekdayName } from "./format.js";
import { civilWeekday, daysBetween } from "./waste.js";
import { layout } from "./view.js";

function nextDates(waste, copy) {
  // První termín je velký nahoře, tady jsou až ty po něm.
  return waste.upcoming
    .filter((iso) => iso !== waste.nextDate)
    .map(
      (iso) => `<li class="bins-date">
        <span class="bins-day">${esc(weekdayName(civilWeekday(iso)))}</span>
        <strong>${esc(formatDayMonth(iso))}</strong>
        <span class="bins-in">${esc(countdownLabel(daysBetween(waste.today, iso), copy).replace(/\.$/, ""))}</span>
      </li>`,
    )
    .join("");
}

export function binsPage(waste, ctx) {
  const soon = waste.daysUntil <= 1 ? " is-soon" : "";
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "bins_title")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "bins_description"),
    body: `
      <section class="card bins-hero">
        <div class="bins-copy">
          <p class="pill">${esc(tx(ctx.copy, "bins_pill"))}</p>
          <h1>${esc(formatLong(waste.nextDate))}</h1>
          <p class="bins-count${soon}">${esc(countdownLabel(waste.daysUntil, ctx.copy))}</p>
          <p class="bins-kind">${esc(tx(ctx.copy, "bins_kind"))}</p>
          <ul class="bins-facts">
            <li>${esc(ruleLabel(waste))}</li>
            <li>${esc(waste.holidayNote)}</li>
          </ul>
          <p class="bins-note">${esc(waste.note)}</p>
          <a class="back" href="/sberne-dvory">${esc(tx(ctx.copy, "bins_yards_link"))} →</a>
        </div>
        <div class="bins-drbena">
          <span class="bins-sun" aria-hidden="true"></span>
          <img src="/drbena-popelnice.webp" width="685" height="880" alt="${esc(tx(ctx.copy, "bins_alt"))}">
        </div>
      </section>
      <section class="card block">
        <h2>${esc(tx(ctx.copy, "bins_more"))}</h2>
        <ol class="bins-dates">${nextDates(waste, ctx.copy)}</ol>
      </section>`,
  });
}
