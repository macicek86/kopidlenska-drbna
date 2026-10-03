// Kalendář akcí: stránka /akce (Drběna, dnešní akce, měsíční kalendář z `events-calendar.js`, seznamy) a odkazy pod akcí (zpráva na drbně, odkaz jinam), které má i titulka.
import { pageAds, weaveAds } from "./ad-weave.js";
import { text as tx } from "./copy.js";
import { calendarHtml, monthShort } from "./events-calendar.js";
import { weekdayName } from "./format.js";
import { esc } from "./html.js";
import { eventLd } from "./seo.js";
import { escTie } from "./typo.js";
import { civilWeekday } from "./waste.js";
import { adPanel, askLine, layout, siteOrigin } from "./view.js";

// Akce se čtou méně často než zprávy, reklama v seznamu jen po každých deseti.
const AD_SPACING = { first: 10, every: 10 };

function linkHost(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Odkazy pod akcí: zpráva na drbně a odkaz jinam (web pořadatele…), ten se otevře zvlášť.
export function eventLinks(event, ctx) {
  const links = [];
  if (event.articleSlug) {
    links.push(`<a href="/zpravy/${esc(event.articleSlug)}">${esc(tx(ctx.copy, "events_article"))} ›</a>`);
  }
  const host = event.link ? linkHost(event.link) : "";
  if (host) links.push(`<a href="${esc(event.link)}" target="_blank" rel="noopener nofollow">${esc(host)} ↗</a>`);
  return links.length ? `<p class="event-links">${links.join("")}</p>` : "";
}

function eventKicker(event, today, copy) {
  const day = event.startsOn === today ? tx(copy, "events_today_short") : weekdayName(civilWeekday(event.startsOn));
  // U akcí z jiného roku i rok, ať se loňské neplete s letošními.
  const year = event.startsOn.slice(0, 4) !== today.slice(0, 4) ? ` ${event.startsOn.slice(0, 4)}` : "";
  return [day + year, event.startsTime].filter(Boolean).join(" · ");
}

function eventCard(event, ctx, today) {
  const isToday = event.startsOn === today ? " is-today" : "";
  return `<article class="card event-card${isToday}" id="akce-${esc(event.id)}">
            <p class="event-date"><span class="event-day">${Number(event.startsOn.slice(8, 10))}.</span><span class="event-month">${esc(monthShort(event.startsOn))}</span></p>
            <div class="event-body">
              <p class="kicker">${esc(eventKicker(event, today, ctx.copy))}</p>
              <h3>${escTie(event.title)}</h3>
              <p class="meta">${esc(event.place)}</p>
              ${event.description ? `<p class="muted">${escTie(event.description)}</p>` : ""}
              ${eventLinks(event, ctx)}
            </div>
          </article>`;
}

function eventList(title, items, empty, ctx, ads, { today, className = "" } = {}) {
  const cards = items.map((event) => eventCard(event, ctx, today));
  const body = items.length
    ? `<div class="stack">${weaveAds(cards, ads, ctx.copy, AD_SPACING).join("")}</div>`
    : `<p class="muted">${esc(empty)}</p>`;
  return `<section class="block events-list${className}"><h2>${esc(title)}</h2>${body}</section>`;
}

function monthCount(count, copy) {
  if (!count) return tx(copy, "events_month_empty");
  return `Tenhle měsíc: ${count} ${count < 5 ? "akce" : "akcí"}`;
}

export function eventsPage(data, ctx, { month = "" } = {}) {
  const today = data.waste.today;
  const todays = data.events.filter((event) => event.startsOn === today);
  const upcoming = data.events.filter((event) => event.startsOn > today);
  const past = data.events.filter((event) => event.startsOn < today).reverse();
  // První reklama mezi nadcházejícími a proběhlými, ostatní do dlouhých seznamů.
  const [slotAd, ...ads] = pageAds(data);
  const calendar = calendarHtml(data.events, today, month, {
    calendar: tx(ctx.copy, "events_calendar"),
    back: tx(ctx.copy, "events_calendar_back"),
    count: (count) => monthCount(count, ctx.copy),
  });
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "events_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "events_description"),
    canonical: "/akce",
    jsonLd: [...todays, ...upcoming].map((event) => eventLd(siteOrigin(ctx.origin, ctx.mainOrigin), event)),
    script: `<script src="/events.js" defer></script>`,
    body: `
      <section class="card events-hero">
        <div class="events-copy">
          <p class="pill">${esc(tx(ctx.copy, "events_eyebrow"))}</p>
          <h1>${esc(tx(ctx.copy, "events_heading"))}</h1>
          <p class="lede">${esc(tx(ctx.copy, "events_lede"))}</p>
          ${askLine(ctx, "events", "K akcím: ")}
        </div>
        <div class="events-drbena">
          <span class="events-sun" aria-hidden="true"></span>
          <img src="/drbena-akce.webp" width="560" height="740" alt="${esc(tx(ctx.copy, "events_alt"))}">
        </div>
      </section>
      ${todays.length ? eventList(tx(ctx.copy, "events_today"), todays, "", ctx, [], { today, className: " events-today" }) : ""}
      ${calendar}
      ${eventList(tx(ctx.copy, "events_upcoming"), upcoming, tx(ctx.copy, "events_upcoming_empty"), ctx, ads, { today })}
      ${slotAd ? `<div class="ad-slot">${adPanel(slotAd, ctx.copy)}</div>` : ""}
      ${past.length ? eventList(tx(ctx.copy, "events_past"), past, "", ctx, ads, { today }) : ""}`,
  });
}
