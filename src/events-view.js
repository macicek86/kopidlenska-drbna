// Kalendář akcí: stránka /akce a odkazy pod akcí (zpráva na drbně, odkaz jinam), které má i titulka.
import { pageAds, weaveAds } from "./ad-weave.js";
import { text as tx } from "./copy.js";
import { formatLong } from "./format.js";
import { esc } from "./html.js";
import { eventLd } from "./seo.js";
import { escTie } from "./typo.js";
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

function eventCard(event, ctx) {
  return `<article class="card">
            <p class="kicker">${esc(formatLong(event.startsOn))}${event.startsTime ? ` · ${esc(event.startsTime)}` : ""}</p>
            <h3>${escTie(event.title)}</h3>
            <p class="meta">${esc(event.place)}</p>
            ${event.description ? `<p class="muted">${escTie(event.description)}</p>` : ""}
            ${eventLinks(event, ctx)}
          </article>`;
}

function eventList(title, items, empty, ctx, ads) {
  const cards = items.map((event) => eventCard(event, ctx));
  const body = items.length
    ? `<div class="stack">${weaveAds(cards, ads, ctx.copy, AD_SPACING).join("")}</div>`
    : `<p class="muted">${esc(empty)}</p>`;
  return `<section class="block"><h2>${esc(title)}</h2>${body}</section>`;
}

export function eventsPage(data, ctx) {
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today);
  const past = data.events.filter((event) => event.startsOn < data.waste.today).reverse();
  // První reklama mezi nadcházejícími a proběhlými, ostatní do dlouhých seznamů.
  const [slotAd, ...ads] = pageAds(data);
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "events_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "events_description"),
    jsonLd: upcoming.map((event) => eventLd(siteOrigin(ctx.origin, ctx.mainOrigin), event)),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "events_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "events_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "events_lede"))}</p>
      ${askLine(ctx, "events", "K akcím: ")}
      ${eventList(tx(ctx.copy, "events_upcoming"), upcoming, tx(ctx.copy, "events_upcoming_empty"), ctx, ads)}
      ${slotAd ? `<div class="ad-slot">${adPanel(slotAd, ctx.copy)}</div>` : ""}
      ${past.length ? eventList(tx(ctx.copy, "events_past"), past, "", ctx, ads) : ""}`,
  });
}
