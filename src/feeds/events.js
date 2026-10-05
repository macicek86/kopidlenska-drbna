// Akce: kalendář k odběru (/akce.ics) a feed nových akcí (/akce/feed.xml).
import { text as tx } from "../copy.js";
import { formatLong } from "../format.js";
import { esc } from "../html.js";
import { withoutTracking } from "../rich.js";
import { addDays } from "../waste.js";
import { TAG, atomFeed } from "./atom.js";
import { icsCalendar } from "./ics.js";

export const EVENTS_LIMIT = 50;
// Kalendář nese i proběhlé akce za posledního půl roku, ať v něm nezmizí hned druhý den.
const CALENDAR_PAST_DAYS = 180;

function eventUrl(base, event) {
  return event.articleSlug ? `${base}/zpravy/${encodeURIComponent(event.articleSlug)}` : `${base}/akce#akce-${event.id}`;
}

function eventWhen(event) {
  return [formatLong(event.startsOn), event.startsTime].filter(Boolean).join(", ");
}

function eventContent(base, event, copy) {
  const links = [];
  if (event.articleSlug) links.push(`<a href="${eventUrl(base, event)}">${esc(tx(copy, "events_article"))}</a>`);
  if (event.link) links.push(`<a href="${esc(withoutTracking(event.link))}">${esc(withoutTracking(event.link))}</a>`);
  return [
    `<p><strong>${esc(eventWhen(event))}</strong><br>${esc(event.place)}</p>`,
    event.description ? `<p>${esc(event.description).replaceAll("\n", "<br>")}</p>` : "",
    links.length ? `<p>${links.join("<br>")}</p>` : "",
  ].join("");
}

// Nové akce: jen ty, které ještě nebyly, od naposledy přidané.
export function eventsFeed(base, events, copy, today) {
  const site = tx(copy, "site_name");
  const fresh = events
    .filter((event) => event.published && event.startsOn >= today && event.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, EVENTS_LIMIT);
  return atomFeed({
    id: `${TAG}akce`,
    title: `${site}: ${tx(copy, "events_heading")}`,
    subtitle: tx(copy, "events_description"),
    self: `${base}/akce/feed.xml`,
    alternate: `${base}/akce`,
    author: site,
    icon: `${base}/icon-192.png`,
    entries: fresh.map((event) => ({
      id: `${TAG}akce-${event.id}`,
      title: `${event.title} (${eventWhen(event)})`,
      url: eventUrl(base, event),
      updated: event.createdAt,
      published: event.createdAt,
      summary: `${eventWhen(event)}, ${event.place}`,
      content: eventContent(base, event, copy),
    })),
  });
}

export function eventsCalendar(base, events, copy, today) {
  const from = addDays(today, -CALENDAR_PAST_DAYS);
  return icsCalendar(
    {
      name: `${tx(copy, "site_name")}: ${tx(copy, "events_heading")}`,
      description: tx(copy, "events_description"),
      events: events
        .filter((event) => event.published && event.startsOn >= from)
        .map((event) => ({
          uid: `akce-${event.id}@kopidlenskadrbna.org`,
          stamp: event.createdAt,
          startsOn: event.startsOn,
          startsTime: event.startsTime,
          title: event.title,
          place: event.place,
          description: [event.description, eventUrl(base, event)].filter(Boolean).join("\n\n"),
          url: eventUrl(base, event),
        })),
    },
  );
}
