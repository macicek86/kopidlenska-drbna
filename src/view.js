import { pickAd, safeAdLink } from "./ads.js";
import { byline } from "./db.js";
import { esc, mediaUrl } from "./html.js";
import { storyPhoto } from "./photo.js";
import { rubricKicker } from "./rubric-nav.js";
import { text as tx } from "./copy.js";
import { countdownLabel, formatDayMonth, formatLong, formatShort, ruleLabel } from "./format.js";
import { civilWeekday } from "./waste.js";
import {
  HOME_LEAD_DAYS,
  activeChange,
  hasOpenSlot,
  homeNotice,
  periodClosed,
  spanSummary,
} from "./doctors.js";
import { homeStatus, hoursSummary, statusLine, WEEK_DAYS } from "./yards.js";
import { outagesTeaser } from "./outages-view.js";

export { outageCard, outageEmpty, outagesPage } from "./outages-view.js";

export function externalHref(copy) {
  const value = tx(copy, "popelnice_url").trim();
  return /^https?:\/\//i.test(value) ? value : "https://popelnice.kopidlenskadrbna.org/";
}

const NAV = [
  ["/zpravy", "nav_news"],
  ["/akce", "nav_events"],
  ["/reklamy", "nav_ads"],
  ["/popelnice", "nav_bins"],
  ["/sberne-dvory", "nav_yards"],
  ["/lekari", "nav_doctors"],
  ["/odstavky", "nav_outages"],
  ["/o-nas", "nav_about"],
];

const OG_IMAGE = "/og.webp";
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

function siteOrigin(origin, mainOrigin) {
  const value = String(origin || mainOrigin || "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(value) ? value : "";
}

export { esc, mediaUrl } from "./html.js";

function active(path, href) {
  return path === href || path.startsWith(`${href}/`) ? " is-on" : "";
}

export function layout({ title, description, path, minimal, mainOrigin, origin, body, script = "", head = "", copy = {} }) {
  const brandHref = minimal ? "/popelnice" : "/";
  const base = siteOrigin(origin, mainOrigin);
  const pagePath = typeof path === "string" && path.startsWith("/") ? path : "/";
  const pageUrl = base ? `${base}${pagePath}` : "";
  const ogImage = base ? `${base}${OG_IMAGE}` : OG_IMAGE;
  const siteName = tx(copy, "site_name");
  const brandImg = minimal ? "/kozel-popelar.webp" : "/kozel-maskot.webp";
  const links = NAV.map(
    ([href, key]) =>
      `<a class="nav-link${active(path, href)}" href="${href}">${esc(tx(copy, key))}</a>`,
  ).join("");
  const headerNav = minimal
    ? `<a class="btn btn-line" href="${esc(mainOrigin)}">${esc(tx(copy, "link_whole"))}</a>`
    : `<nav class="nav" aria-label="Hlavní">${links}</nav>
       <details class="mobile-nav">
         <summary>${esc(tx(copy, "menu_label"))}</summary>
         <nav aria-label="Mobilní">${links}</nav>
       </details>`;
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="cs_CZ">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${pageUrl ? `<meta property="og:url" content="${esc(pageUrl)}">` : ""}
  <meta property="og:image" content="${esc(ogImage)}">
  <meta property="og:image:type" content="image/webp">
  <meta property="og:image:width" content="${OG_WIDTH}">
  <meta property="og:image:height" content="${OG_HEIGHT}">
  <meta property="og:image:alt" content="${esc(siteName)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(ogImage)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
  ${head}
</head>
<body>
  <div class="wrap">
    <a class="skip" href="#obsah">${esc(tx(copy, "skip"))}</a>
    <header class="top">
      <a class="brand" href="${brandHref}">
        <img src="${brandImg}" alt="">
        <span>${esc(tx(copy, "brand_line"))}<span>${esc(tx(copy, "brand_accent"))}</span></span>
      </a>
      ${headerNav}
    </header>
    <main id="obsah">${body}</main>
    <footer>
      <p>${esc(tx(copy, "footer_copy"))}</p>
      <p class="fine">${esc(tx(copy, "footer_fine"))}</p>
      ${minimal ? "" : `<a href="/redakce">${esc(tx(copy, "footer_admin"))}</a>`}
    </footer>
  </div>
  ${script}
</body>
</html>`;
}

function note(message, kind) {
  if (!message) return "";
  return `<p class="note ${kind === "ok" ? "note-ok" : "note-bad"}" role="status">${esc(message)}</p>`;
}

export function flashOf(message) {
  if (message && typeof message === "object") {
    return { text: String(message.text ?? ""), kind: message.kind === "bad" ? "bad" : "ok" };
  }
  return { text: String(message ?? ""), kind: "ok" };
}

export function signedWhen(article, when) {
  const name = byline(article);
  return name ? `${when} · ${name}` : when;
}

export function credit(person) {
  const shown = byline(person);
  const name = String(person?.authorName ?? person?.name ?? "").trim();
  if (!shown) return "";
  if (name && shown !== name) return `${shown} (${name})`;
  return shown;
}

export function closureLabel(closure) {
  if (closure.startsOn === closure.endsOn) return formatLong(closure.startsOn);
  return `${formatLong(closure.startsOn)} – ${formatLong(closure.endsOn)}`;
}

export function homePage(data, ctx) {
  const lead = data.articles[0];
  const rest = data.articles.slice(1, 4);
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today).slice(0, 3);
  const leadHtml = lead
    ? `<a class="card card-lead" href="/zpravy/${esc(lead.slug)}">
        ${storyPhoto(lead, "cover")}
        ${rubricKicker(lead)}
        <h3>${esc(lead.title)}</h3>
        <p class="muted">${esc(lead.excerpt)}</p>
        <p class="meta">${esc(signedWhen(lead, formatDayMonth(lead.createdOn)))}</p>
      </a>`
    : `<p class="card muted">${esc(tx(ctx.copy, "empty_articles"))}</p>`;
  const restHtml = rest
    .map(
      (article) => `<a class="card card-side" href="/zpravy/${esc(article.slug)}">
        ${rubricKicker(article)}
        <h3>${esc(article.title)}</h3>
      </a>`,
    )
    .join("");
  const eventsHtml = upcoming.length
    ? `<div class="cards-3">${upcoming
        .map(
          (event) => `<article class="card">
            <p class="kicker">${esc(formatLong(event.startsOn))}</p>
            <h3>${esc(event.title)}</h3>
            <p class="muted">${esc(event.place)}${event.startsTime ? ` · ${esc(event.startsTime)}` : ""}</p>
          </article>`,
        )
        .join("")}</div>`
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "empty_events"))}</p>`;

  return layout({
    ...ctx,
    title: tx(ctx.copy, "site_name"),
    description: tx(ctx.copy, "home_description"),
    body: `
      <section class="hero">
        <div class="mascot">
          <span class="sun" aria-hidden="true"></span>
          <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>
          <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "hero_alt"))}">
        </div>
        <div>
          <p class="pill">${esc(tx(ctx.copy, "hero_pill"))}</p>
          <h1>${esc(tx(ctx.copy, "hero_title"))}<span>${esc(tx(ctx.copy, "hero_accent"))}</span></h1>
          <p class="lede">${esc(tx(ctx.copy, "hero_lede"))}</p>
          <div class="card waste-teaser">
            <p class="eyebrow">${esc(tx(ctx.copy, "home_waste_eyebrow"))}</p>
            <p class="date">${esc(formatLong(data.waste.nextDate))}</p>
            <p class="count">${esc(countdownLabel(data.waste.daysUntil, ctx.copy))}</p>
            <div class="row">
              <a class="btn btn-primary" href="/popelnice">${esc(tx(ctx.copy, "home_waste_button"))}</a>
              <a class="btn btn-line" href="${esc(externalHref(ctx.copy))}" target="_blank" rel="noreferrer">${esc(tx(ctx.copy, "popelnice_label"))}</a>
            </div>
          </div>
          ${yardsTeaser(data, ctx)}
          ${doctorsTeaser(data, ctx)}
          ${outagesTeaser(data, ctx)}
        </div>
      </section>
      <section class="block">
        <div class="section-head"><h2>${esc(tx(ctx.copy, "home_news_heading"))}</h2><a href="/zpravy">${esc(tx(ctx.copy, "home_news_all"))}</a></div>
        <div class="news-grid">${leadHtml}<div class="stack">${restHtml}</div></div>
        ${adSlot(data, ctx)}
      </section>
      <section class="block">
        <div class="section-head"><h2>${esc(tx(ctx.copy, "home_events_heading"))}</h2><a href="/akce">${esc(tx(ctx.copy, "home_events_all"))}</a></div>
        ${eventsHtml}
      </section>`,
  });
}

export function contentAd(data, ctx) {
  const ad = Object.hasOwn(data, "ad") ? data.ad : pickAd(data.ads);
  return ad ? adPanel(ad, ctx.copy) : "";
}

function adSlot(data, ctx) {
  const html = contentAd(data, ctx);
  return html ? `<div class="ad-slot">${html}</div>` : "";
}

function adLinkHtml(link, label, preview) {
  if (!link) return "";
  if (preview) return `<span>${esc(label)}</span>`;
  const external = /^https?:\/\//i.test(link);
  const attrs = external ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<a href="${esc(link)}"${attrs}>${esc(label)}</a>`;
}

export function adPanel(ad, copy, options = {}) {
  const preview = Boolean(options.preview);
  const heading = options.heading === "h1" ? "h1" : "h3";
  const link = typeof safeAdLink(ad.link) === "string" ? safeAdLink(ad.link) : "";
  const flag = tx(copy, "ads_flag");
  const sample = ad.sample ? ` · ${tx(copy, "ads_sample")}` : "";
  const titleText = String(ad.title ?? "").trim();
  const bodyText = String(ad.body ?? "").trim();
  const placeText = String(ad.place ?? "").trim();
  const titleShown = titleText || (preview ? "Název nabídky" : "");
  const bodyShown = bodyText || (preview ? "Krátký text, který uvidí sousedé." : "");
  const permalink = !preview && heading !== "h1" && ad.slug;
  const titleInner = permalink ? `<a href="/reklamy/${esc(ad.slug)}">${esc(titleShown)}</a>` : esc(titleShown);
  const when = ad.createdOn ? formatDayMonth(ad.createdOn) : "";
  const who = byline(ad);
  const meta = [when, who].filter(Boolean).join(" · ");
  const more = adLinkHtml(link, tx(copy, "ads_more"), preview);
  const photo = ad.imageKey
    ? `<img class="ad-photo"${preview ? ` data-ad="photo"` : ""} src="${mediaUrl(ad.imageKey)}" alt="">`
    : preview
      ? `<img class="ad-photo" data-ad="photo" alt="" hidden>`
      : "";
  const placeRow =
    placeText || preview
      ? `<p class="ad-place"${preview ? ` data-ad="place"` : ""}${placeText ? "" : " hidden"}>${esc(placeText)}</p>`
      : "";
  const linkRow = preview
    ? `<p class="ad-link" data-ad="link"${more ? "" : " hidden"}>${more || esc(tx(copy, "ads_more"))}</p>`
    : more
      ? `<p class="ad-link">${more}</p>`
      : "";
  const solo = heading === "h1" ? " ad-solo" : "";
  const previewAttr = preview ? ` data-ad-preview aria-label="Náhled panelu"` : "";
  const titleAttrs = preview
    ? ` data-ad="title" data-empty="Název nabídky"${titleText ? "" : ` class="is-placeholder"`}`
    : "";
  const bodyAttrs = preview ? ` data-ad="body" data-empty="Krátký text, který uvidí sousedé."` : "";
  const bodyClass = `ad-text${preview && !bodyText ? " is-placeholder" : ""}`;
  return `<aside class="ad-panel${ad.imageKey ? " has-photo" : ""}${solo}"${previewAttr}>
    <p class="ad-flag">${esc(flag)}${esc(sample)}</p>
    <div class="ad-layout">
      ${photo}
      <div class="ad-copy">
        <${heading}${titleAttrs}>${titleInner}</${heading}>
        <p class="${bodyClass}"${bodyAttrs}>${esc(bodyShown)}</p>
        ${placeRow}
        ${linkRow}
        ${meta ? `<p class="ad-meta">${esc(meta)}</p>` : ""}
      </div>
    </div>
  </aside>`;
}

export function adsPage(data, ctx) {
  const ads = data.ads ?? [];
  const list = ads.length
    ? ads.map((ad) => adPanel(ad, ctx.copy)).join("")
    : `<p class="muted">${esc(tx(ctx.copy, "ads_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "ads_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "ads_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "ads_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "ads_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "ads_lede"))}</p>
      <div class="ads-grid">${list}</div>`,
  });
}

export function adPage(ad, ctx) {
  return layout({
    ...ctx,
    title: `${ad.title} | ${tx(ctx.copy, "site_name")}`,
    description: ad.body,
    body: `
      <a class="back" href="/reklamy">${esc(tx(ctx.copy, "ads_back"))}</a>
      ${adPanel(ad, ctx.copy, { heading: "h1" })}`,
  });
}

export function missingAdPage(ctx) {
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "ads_missing")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "ads_missing"),
    body: `<h1>${esc(tx(ctx.copy, "ads_missing"))}</h1><a class="back" href="/reklamy">${esc(tx(ctx.copy, "ads_back"))}</a>`,
  });
}

export function missingPage(ctx) {
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "missing_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "missing_description"),
    body: `<h1>${esc(tx(ctx.copy, "missing_heading"))}</h1><a class="back" href="/zpravy">${esc(tx(ctx.copy, "article_back"))}</a>`,
  });
}

function eventList(title, items, empty) {
  const body = items.length
    ? `<div class="stack">${items
        .map(
          (event) => `<article class="card">
            <p class="kicker">${esc(formatLong(event.startsOn))}${event.startsTime ? ` · ${esc(event.startsTime)}` : ""}</p>
            <h3>${esc(event.title)}</h3>
            <p class="meta">${esc(event.place)}</p>
            ${event.description ? `<p class="muted">${esc(event.description)}</p>` : ""}
          </article>`,
        )
        .join("")}</div>`
    : `<p class="muted">${esc(empty)}</p>`;
  return `<section class="block"><h2>${esc(title)}</h2>${body}</section>`;
}

export function eventsPage(data, ctx) {
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today);
  const past = data.events.filter((event) => event.startsOn < data.waste.today).reverse();
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "events_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "events_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "events_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "events_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "events_lede"))}</p>
      ${eventList(tx(ctx.copy, "events_upcoming"), upcoming, tx(ctx.copy, "events_upcoming_empty"))}
      ${adSlot(data, ctx)}
      ${past.length ? eventList(tx(ctx.copy, "events_past"), past, "") : ""}`,
  });
}

export function binsPage(waste, ctx, { showExternal, standaloneTitle }) {
  const dates = waste.upcoming
    .map(
      (iso) => `<article class="date-tile"><strong>${esc(formatShort(iso))}</strong><span>${esc(formatLong(iso))}</span></article>`,
    )
    .join("");
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, standaloneTitle ? "bins_standalone" : "bins_title")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "bins_description"),
    minimal: ctx.minimal,
    body: `
      <section class="bins">
        <div class="card bin-copy">
          <p class="pill">${esc(tx(ctx.copy, "bins_pill"))}</p>
          <h1>${esc(formatLong(waste.nextDate))}</h1>
          <p class="count">${esc(countdownLabel(waste.daysUntil, ctx.copy))}</p>
          <p class="muted">${esc(waste.note)}</p>
          <p class="rule">${esc(ruleLabel(waste))}</p>
          <div class="row">
            <span class="chip">${esc(waste.holidayNote)}</span>
            <span class="chip">${esc(tx(ctx.copy, "bins_kind"))}</span>
          </div>
          ${
            showExternal
              ? `<a class="back" href="${esc(externalHref(ctx.copy))}" target="_blank" rel="noreferrer">${esc(tx(ctx.copy, "popelnice_label"))}</a>`
              : ""
          }
          ${ctx.minimal ? "" : `<a class="back" href="/sberne-dvory">${esc(tx(ctx.copy, "bins_yards_link"))}</a>`}
        </div>
        <div class="bin-photo"><img src="/kozel-popelar.webp" alt="${esc(tx(ctx.copy, "bins_alt"))}"></div>
      </section>
      <section class="card block">
        <h2>${esc(tx(ctx.copy, "bins_more"))}</h2>
        <div class="dates">${dates}</div>
      </section>`,
  });
}

function clockOf(data) {
  return data.now ?? { date: data.waste.today, time: "12:00" };
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

export function dayLabel(day) {
  return WEEK_DAYS.find((item) => item.day === day)?.label ?? "";
}

function weekList(week, today) {
  const todayDay = civilWeekday(today);
  return `<ul class="week-list">${week
    .map((slot) => {
      const mark = slot.day === todayDay ? " is-today" : "";
      const off = slot.open ? "" : " is-off";
      const when = slot.open ? `${slot.from}–${slot.to}` : "zavřeno";
      return `<li class="${mark}${off}"><span>${esc(dayLabel(slot.day))}</span><strong>${esc(when)}</strong></li>`;
    })
    .join("")}</ul>`;
}

function yardStatusHtml(yard, now) {
  const item = homeStatus(yard, now.date, now.time);
  const line = esc(statusLine(yard, now.date, now.time));
  if (item.kind === "closure") return `<p class="banner">${line}</p>`;
  if (item.kind === "open") return `<p class="count">${line}</p>`;
  if (item.kind === "later") return `<p class="soon">${line}</p>`;
  return `<p class="meta">${line}</p>`;
}

export function yardsPage(data, ctx) {
  const today = data.waste.today;
  const now = clockOf(data);
  const cards = (data.yards ?? []).length
    ? (data.yards ?? [])
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
            : weekList(yard.week, today);
          return `<article class="card yard">
            <p class="kicker">${esc(yard.place)}</p>
            <h2>${esc(yard.name)}</h2>
            ${yardStatusHtml(yard, now)}
            <p class="kicker">${esc(tx(ctx.copy, "yards_accepts"))}</p>
            <p class="keep-lines">${esc(yard.accepts)}</p>
            <p class="kicker">${esc(tx(ctx.copy, "yards_hours"))}</p>
            ${hours}
            ${planned}
          </article>`;
        })
        .join("")
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "yards_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "yards_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "yards_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "yards_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "yards_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "yards_lede"))}</p>
      <div class="stack">${cards}</div>`,
  });
}

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

function partLine(label, part) {
  if (!part?.open) return "";
  const note = part.note ? `<span class="hint">${esc(part.note)}</span>` : "";
  return `<p class="part"><span class="slot"><strong>${esc(`${part.from}–${part.to}`)}</strong><span class="when">${esc(label)}</span></span>${note}</p>`;
}

function doctorWeekList(week, today, { superseded = false } = {}) {
  const todayDay = civilWeekday(today);
  return `<ul class="week-list doctor-week">${week
    .map((slot) => {
      const morning = partLine("dopoledne", slot.morning);
      const afternoon = partLine("odpoledne", slot.afternoon);
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

export function doctorsPage(data, ctx) {
  const today = data.waste.today;
  const cards = (data.doctors ?? []).length
    ? (data.doctors ?? [])
        .map((doctor) => {
          const current = activeChange(doctor, today);
          const notice = current ? homeNotice(doctor, today) : null;
          const banner = notice
            ? `<div class="banner doctor-notice"><p>${glueDates(`${notice.name} ${notice.state.charAt(0).toLowerCase()}${notice.state.slice(1)}`)}</p>${notice.note ? `<p class="banner-note">${glueDates(notice.note)}</p>` : ""}${notice.detail ? `<p class="banner-note">${glueDates(notice.detail)}</p>` : ""}</div>`
            : "";
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
      <div class="stack">${cards}</div>`,
  });
}

export function brokenPage(message) {
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Kopidlenská drbna</title>
  <body style="font-family:sans-serif;padding:2rem"><h1>Stránka se teď nenačte</h1><p>${esc(message)}</p></body></html>`;
}
