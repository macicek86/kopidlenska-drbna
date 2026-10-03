// Titulka: maskot s upozorněními vedle sebe, pod tím zprávy, reklama a akce.
import { esc } from "./html.js";
import { storyPhoto } from "./photo.js";
import { rubricKicker } from "./rubric-nav.js";
import { text as tx } from "./copy.js";
import { countdownLabel, formatDayMonth, formatLong } from "./format.js";
import { homeNotice } from "./doctors.js";
import { groupedNotices } from "./places.js";
import { homeStatus } from "./yards.js";
import { outagesTeaser } from "./outages-view.js";
import { siteLd } from "./seo.js";
import { clockOf, contentAd, layout, signedWhen, siteOrigin } from "./view.js";

function wasteTeaser(data, ctx) {
  return `<div class="card waste-teaser">
    <p class="eyebrow">${esc(tx(ctx.copy, "home_waste_eyebrow"))}</p>
    <p class="date">${esc(formatLong(data.waste.nextDate))}</p>
    <p class="count">${esc(countdownLabel(data.waste.daysUntil, ctx.copy))}</p>
    <div class="row">
      <a class="btn btn-primary" href="/popelnice">${esc(tx(ctx.copy, "home_waste_button"))}</a>
    </div>
  </div>`;
}

function yardsTeaser(data, ctx) {
  const yards = data.yards ?? [];
  if (!yards.length) return "";
  const now = clockOf(data);
  const lines = yards
    .map((yard) => {
      const item = homeStatus(yard, now.date, now.time);
      const kind =
        item.kind === "open" ? "is-open" : item.kind === "later" ? "is-later" : item.kind === "closure" ? "is-closure" : "is-shut";
      return `<li class="${kind}">
        <p class="yard-home-name">${esc(item.name)}</p>
        <p class="yard-home-state">${esc(item.state)}</p>
        ${item.detail ? `<p class="yard-home-detail">${esc(item.detail)}</p>` : ""}
        ${item.tomorrow ? `<p class="yard-home-detail">${esc(item.tomorrow)}</p>` : ""}
      </li>`;
    })
    .join("");
  return `<div class="card waste-teaser">
    <p class="eyebrow">${esc(tx(ctx.copy, "home_yards_button"))}</p>
    <ul class="yard-home">${lines}</ul>
    <div class="row"><a class="btn btn-primary" href="/sberne-dvory">${esc(tx(ctx.copy, "home_yards_button"))}</a></div>
  </div>`;
}

function doctorsTeaser(data, ctx) {
  const today = clockOf(data).date;
  const lines = (data.doctors ?? [])
    .map((doctor) => {
      const item = homeNotice(doctor, today);
      if (!item) return "";
      return `<li class="is-change">
        <p class="yard-home-name">${esc(item.name)}</p>
        <p class="yard-home-detail">${esc(item.specialty)}</p>
        <p class="yard-home-state">${esc(item.state)}</p>
        ${item.note ? `<p class="yard-home-detail">${esc(item.note)}</p>` : ""}
        ${item.detail ? `<p class="yard-home-detail">${esc(item.detail)}</p>` : ""}
      </li>`;
    })
    .filter(Boolean)
    .join("");
  if (!lines) return "";
  return `<div class="card waste-teaser">
    <p class="eyebrow">${esc(tx(ctx.copy, "home_doctors_button"))}</p>
    <ul class="yard-home">${lines}</ul>
    <div class="row"><a class="btn btn-primary" href="/lekari">${esc(tx(ctx.copy, "home_doctors_button"))}</a></div>
  </div>`;
}

// Zavřeno, jiná nebo nová otevírací doba. Stejné upozornění u víc míst je jeden řádek se všemi názvy.
function placesTeaser(data, ctx) {
  const notices = groupedNotices(data.places, clockOf(data).date);
  if (!notices.length) return "";
  const lines = notices
    .map(
      (item) => `<li class="is-change">
        <p class="yard-home-name">${esc(item.names.join(", "))}</p>
        <p class="yard-home-state">${esc(item.state)}</p>
        ${item.note ? `<p class="yard-home-detail">${esc(item.note)}</p>` : ""}
        ${item.detail ? `<p class="yard-home-detail">${esc(item.detail)}</p>` : ""}
      </li>`,
    )
    .join("");
  return `<div class="card waste-teaser">
    <p class="eyebrow">${esc(tx(ctx.copy, "home_places_eyebrow"))}</p>
    <ul class="yard-home">${lines}</ul>
    <div class="row"><a class="btn btn-primary" href="/oteviraci-doba">${esc(tx(ctx.copy, "home_places_button"))}</a></div>
  </div>`;
}

function newsHtml(data, ctx) {
  const lead = data.articles[0];
  const rest = data.articles.slice(1, 4);
  const leadHtml = lead
    ? `<a class="card card-lead" href="/zpravy/${esc(lead.slug)}">
        ${storyPhoto(lead, "cover")}
        ${rubricKicker(lead)}
        <h3>${esc(lead.title)}</h3>
        <p class="muted">${esc(lead.excerpt)} <span class="side-more">víc ›</span></p>
        <p class="meta">${esc(signedWhen(lead, formatDayMonth(lead.createdOn)))}</p>
      </a>`
    : `<p class="card muted">${esc(tx(ctx.copy, "empty_articles"))}</p>`;
  const restHtml = rest
    .map(
      (article) => `<a class="card card-side" href="/zpravy/${esc(article.slug)}">
        ${rubricKicker(article)}
        <h3>${esc(article.title)}</h3>
        <p class="muted side-excerpt"><span>${esc(article.excerpt)}</span> <span class="side-more">víc ›</span></p>
      </a>`,
    )
    .join("");
  return `<div class="news-grid">${leadHtml}<div class="stack">${restHtml}</div></div>`;
}

function eventsHtml(data, ctx) {
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today).slice(0, 3);
  if (!upcoming.length) return `<p class="card dashed muted">${esc(tx(ctx.copy, "empty_events"))}</p>`;
  return `<div class="cards-3">${upcoming
    .map(
      (event) => `<article class="card">
        <p class="kicker">${esc(formatLong(event.startsOn))}</p>
        <h3>${esc(event.title)}</h3>
        <p class="muted">${esc(event.place)}${event.startsTime ? ` · ${esc(event.startsTime)}` : ""}</p>
      </article>`,
    )
    .join("")}</div>`;
}

export function homePage(data, ctx) {
  const ad = contentAd(data, ctx);
  return layout({
    ...ctx,
    title: tx(ctx.copy, "site_name"),
    description: tx(ctx.copy, "home_description"),
    jsonLd: siteLd(siteOrigin(ctx.origin, ctx.mainOrigin), ctx.copy),
    body: `
      <section class="hero home-hero">
        <div class="mascot">
          <span class="sun" aria-hidden="true"></span>
          <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>
          <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "hero_alt"))}">
        </div>
        <div>
          <p class="pill">${esc(tx(ctx.copy, "hero_pill"))}</p>
          <h1>${esc(tx(ctx.copy, "hero_title"))}<span>${esc(tx(ctx.copy, "hero_accent"))}</span></h1>
          <p class="lede">${esc(tx(ctx.copy, "hero_lede"))}</p>
          <div class="home-today">
            ${wasteTeaser(data, ctx)}
            ${yardsTeaser(data, ctx)}
            ${placesTeaser(data, ctx)}
            ${doctorsTeaser(data, ctx)}
            ${outagesTeaser(data, ctx)}
          </div>
        </div>
      </section>
      <section class="block">
        <div class="section-head"><h2>${esc(tx(ctx.copy, "home_news_heading"))}</h2><a href="/zpravy">${esc(tx(ctx.copy, "home_news_all"))}</a></div>
        ${newsHtml(data, ctx)}
        ${ad ? `<div class="ad-slot">${ad}</div>` : ""}
      </section>
      <section class="block">
        <div class="section-head"><h2>${esc(tx(ctx.copy, "home_events_heading"))}</h2><a href="/akce">${esc(tx(ctx.copy, "home_events_all"))}</a></div>
        ${eventsHtml(data, ctx)}
      </section>`,
  });
}
