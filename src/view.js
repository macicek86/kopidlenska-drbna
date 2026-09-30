import { PANEL_BYTES, PANEL_EDGE, pickAd, safeAdLink } from "./ads.js";
import { byline, CATEGORIES, PERMISSIONS, userCan } from "./db.js";
import { COPY, text as tx } from "./copy.js";
import { countdownLabel, formatDayMonth, formatLong, formatShort, ruleLabel, weekdayName } from "./format.js";
import { prepareArticleBody, renderArticleHtml } from "./rich.js";
import { civilWeekday } from "./waste.js";
import {
  HOME_LEAD_DAYS,
  activeChange,
  blankWeek,
  hasOpenSlot,
  homeNotice,
  hoursSummary as doctorHoursSummary,
  periodClosed,
  spanSummary,
} from "./doctors.js";
import { homeStatus, hoursSummary, statusLine, WEEK_DAYS } from "./yards.js";
import { HOME_LEAD_DAYS as OUTAGE_LEAD_DAYS } from "./outages.js";

const CATEGORY_KEY = {
  Zprávy: "cat_zpravy",
  Komunita: "cat_komunita",
  Kultura: "cat_kultura",
  Praktické: "cat_prakticke",
  Sport: "cat_sport",
};

function externalHref(copy) {
  const value = tx(copy, "popelnice_url").trim();
  return /^https?:\/\//i.test(value) ? value : "https://popelnice.kopidlenskadrbna.org/";
}

function catLabel(copy, category) {
  const key = CATEGORY_KEY[category];
  return key ? tx(copy, key) : category;
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

const AMP = "\u0026amp;";
const LT = "\u0026lt;";
const GT = "\u0026gt;";
const QUOT = "\u0026quot;";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT);
}

function mediaUrl(key) {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

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

function flashOf(message) {
  if (message && typeof message === "object") {
    return { text: String(message.text ?? ""), kind: message.kind === "bad" ? "bad" : "ok" };
  }
  return { text: String(message ?? ""), kind: "ok" };
}

function signedWhen(article, when) {
  const name = byline(article);
  return name ? `${when} · ${name}` : when;
}

function credit(person) {
  const shown = byline(person);
  const name = String(person?.authorName ?? person?.name ?? "").trim();
  if (!shown) return "";
  if (name && shown !== name) return `${shown} (${name})`;
  return shown;
}

function closureLabel(closure) {
  if (closure.startsOn === closure.endsOn) return formatLong(closure.startsOn);
  return `${formatLong(closure.startsOn)} – ${formatLong(closure.endsOn)}`;
}

function articleMeta(article) {
  const base = signedWhen(article, formatLong(article.createdOn));
  const mark = article.redacted ? ` · <span class="redigovano">Redigováno</span>` : "";
  return `<p class="meta">${esc(base)}${mark}</p>`;
}

export function homePage(data, ctx) {
  const lead = data.articles[0];
  const rest = data.articles.slice(1, 4);
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today).slice(0, 3);
  const leadHtml = lead
    ? `<a class="card card-lead" href="/zpravy/${esc(lead.slug)}">
        ${lead.imageKey ? `<img class="cover" src="${mediaUrl(lead.imageKey)}" alt="">` : ""}
        <p class="kicker">${esc(catLabel(ctx.copy, lead.category))}</p>
        <h3>${esc(lead.title)}</h3>
        <p class="muted">${esc(lead.excerpt)}</p>
        <p class="meta">${esc(signedWhen(lead, formatDayMonth(lead.createdOn)))}</p>
      </a>`
    : `<p class="card muted">${esc(tx(ctx.copy, "empty_articles"))}</p>`;
  const restHtml = rest
    .map(
      (article) => `<a class="card card-side" href="/zpravy/${esc(article.slug)}">
        <p class="kicker">${esc(catLabel(ctx.copy, article.category))}</p>
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

export function newsPage(data, ctx, rubrika) {
  const filter = rubrika && CATEGORIES.includes(rubrika) ? rubrika : "Vše";
  const visible = filter === "Vše" ? data.articles : data.articles.filter((article) => article.category === filter);
  const chips = ["Vše", ...CATEGORIES]
    .map((category) => {
      const href = category === "Vše" ? "/zpravy" : `/zpravy?rubrika=${encodeURIComponent(category)}`;
      const label = category === "Vše" ? tx(ctx.copy, "chip_all") : catLabel(ctx.copy, category);
      return `<a class="chip${filter === category ? " is-on" : ""}" href="${href}">${esc(label)}</a>`;
    })
    .join("");
  const cards = visible.map(
    (article) => `<a class="card story" href="/zpravy/${esc(article.slug)}">
            ${article.imageKey ? `<img class="cover" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
            <p class="kicker">${esc(catLabel(ctx.copy, article.category))}</p>
            <h2>${esc(article.title)}</h2>
            <p class="muted">${esc(article.excerpt)}</p>
            <p class="meta">${esc(signedWhen(article, formatDayMonth(article.createdOn)))}</p>
          </a>`,
  );
  const woven = contentAd(data, ctx);
  if (woven && cards.length) cards.splice(Math.min(2, cards.length), 0, woven);
  const list = cards.length ? cards.join("") : `<p class="muted">${esc(tx(ctx.copy, "news_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "news_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "news_description"),
    body: `<p class="eyebrow">${esc(tx(ctx.copy, "news_eyebrow"))}</p><h1>${esc(tx(ctx.copy, "news_heading"))}</h1><div class="chips">${chips}</div><div class="stack">${list}</div>`,
  });
}

export function articlePage(article, ctx, extras = {}) {
  const ad = Object.hasOwn(extras, "ad") ? extras.ad : pickAd(extras.ads);
  return layout({
    ...ctx,
    title: `${article.title} | ${tx(ctx.copy, "site_name")}`,
    description: article.excerpt,
    body: `
      <a class="back" href="/zpravy">${esc(tx(ctx.copy, "article_back"))}</a>
      <p class="eyebrow">${esc(catLabel(ctx.copy, article.category))}</p>
      <h1 class="article-title">${esc(article.title)}</h1>
      ${articleMeta(article)}
      ${article.imageKey ? `<img class="article-photo" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
      <div class="prose">${renderArticleHtml(article.body)}</div>
      ${ad ? `<div class="ad-slot">${adPanel(ad, ctx.copy)}</div>` : ""}`,
  });
}

function contentAd(data, ctx) {
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
      <div class="stack">${list}</div>`,
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

export function aboutPage(data, ctx) {
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "nav_about")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "about_description"),
    body: `
      <section class="about">
        <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "about_alt"))}">
        <div>
          <p class="eyebrow">${esc(tx(ctx.copy, "about_eyebrow"))}</p>
          <h1>${esc(tx(ctx.copy, "about_heading"))}</h1>
          <p class="lede">${esc(tx(ctx.copy, "about_lede"))}</p>
          <p>${esc(tx(ctx.copy, "about_disclaimer"))}</p>
          <p>${esc(data.contactNote)}</p>
          <div class="row links">
            <a href="/popelnice">${esc(tx(ctx.copy, "about_bins_link"))}</a>
            <a href="/sberne-dvory">${esc(tx(ctx.copy, "about_yards_link"))}</a>
            <a href="/lekari">${esc(tx(ctx.copy, "about_doctors_link"))}</a>
            <a href="/odstavky">${esc(tx(ctx.copy, "about_outages_link"))}</a>
            <a href="/reklamy">${esc(tx(ctx.copy, "about_ads_link"))}</a>
            <a href="${esc(externalHref(ctx.copy))}" target="_blank" rel="noreferrer">${esc(tx(ctx.copy, "popelnice_label"))}</a>
          </div>
        </div>
      </section>`,
  });
}

function photoControl(editing) {
  const preview = editing?.imageKey
    ? `<img class="thumb" src="${mediaUrl(editing.imageKey)}" alt="">`
    : `<span class="hint">Před odesláním se v prohlížeči zmenší a uloží jako WEBP. Delší strana nejvýš 1600 px.</span>`;
  return `<input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">${preview}`;
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

const input = "control";

function adminShell(ctx, data, tab, message, inner, options = {}) {
  const flash = flashOf(message);
  if (!data.signedIn) {
    return layout({
      ...ctx,
      path: "/redakce",
      title: "Redakce | Kopidlenská drbna",
      description: "Přihlášení do redakce Kopidlenské drbny.",
      body: `
        <section class="card login">
          <p class="eyebrow">Administrace</p>
          <h1>Redakce</h1>
          <p class="muted">Hlavní redaktor a přispěvatelé. Návštěvníci obsah jen čtou.</p>
          ${
            data.showDefaultPassword
              ? `<p class="banner">Výchozí přihlášení je jméno redakce a heslo Drbna2026. Po vstupu si ho změňte.</p>`
              : ""
          }
          <form method="post" action="/redakce/prihlasit">
            ${field("Přihlašovací jméno", `<input class="${input}" name="login" autocomplete="username" autocapitalize="none" required>`)}
            ${field("Heslo", `<input class="${input}" type="password" name="password" autocomplete="current-password" required>`)}
            <button class="btn btn-primary" type="submit">Vstoupit</button>
            ${note(flash.text, "bad")}
          </form>
        </section>`,
    });
  }

  const chief = data.user?.role === "hlavni";
  const waiting = (data.proposals ?? []).filter((item) => item.status === "pending").length;
  const newsLabel = chief && waiting ? `Zprávy (${waiting})` : "Zprávy";
  const yardTab = ["/redakce/dvory", "dvory", "Sběrné dvory"];
  const doctorTab = ["/redakce/lekari", "lekari", "Lékaři"];
  const adWaiting = (data.adProposals ?? []).filter((item) => item.status === "pending").length;
  const adTab = ["/redakce/reklamy", "reklamy", chief && adWaiting ? `Reklamy (${adWaiting})` : "Reklamy"];
  const tabs = chief
    ? [
        ["/redakce/zpravy", "zpravy", newsLabel],
        adTab,
        ["/redakce/akce", "akce", "Akce"],
        ["/redakce/texty", "texty", "Texty"],
        ["/redakce/svoz", "svoz", "Popelnice a kontakt"],
        yardTab,
        doctorTab,
        ["/redakce/odstavky", "odstavky", "Odstávky"],
        ["/redakce/lide", "lide", "Lidé"],
        ["/redakce/heslo", "heslo", "Heslo"],
      ]
    : [
        ["/redakce/zpravy", "zpravy", "Zprávy"],
        adTab,
        ...(userCan(data.user, "sberny_dvur") ? [yardTab] : []),
        ...(userCan(data.user, "doktori") ? [doctorTab] : []),
        ["/redakce/heslo", "heslo", "Heslo"],
      ];
  const tabHtml = tabs
    .map(
      ([href, id, label]) =>
        `<a class="btn ${tab === id ? "btn-ink" : "btn-line"}" href="${href}">${label}</a>`,
    )
    .join("");
  const who = chief ? "hlavní redaktor" : "přispěvatel";
  return layout({
    ...ctx,
    path: "/redakce",
    title: "Redakce | Kopidlenská drbna",
    description: "Redakce Kopidlenské drbny.",
    head: options.rich ? `<link rel="stylesheet" href="/vendor/trix/trix.css">` : "",
    script: `${options.rich ? `<script src="/vendor/trix/trix.umd.min.js" defer></script>` : ""}<script src="/editor.js" defer></script>`,
    body: `
      <div class="admin-head">
        <div>
          <p class="eyebrow">Administrace</p>
          <h1>Redakce</h1>
          <p class="muted">${esc(data.user?.name ?? "")} · ${who}</p>
        </div>
        <form method="post" action="/redakce/odhlasit"><button class="btn btn-line" type="submit">Odhlásit</button></form>
      </div>
      ${
        chief && data.showDefaultPassword
          ? `<p class="banner">Pořád platí výchozí heslo. V záložce Heslo si nastavte vlastní.</p>`
          : ""
      }
      <div class="row">${tabHtml}</div>
      ${note(flash.text, flash.kind)}
      ${inner}`,
  });
}

function categoryOptions(ctx, selected) {
  return CATEGORIES.map(
    (category) =>
      `<option value="${esc(category)}"${selected === category ? " selected" : ""}>${esc(catLabel(ctx.copy, category))}</option>`,
  ).join("");
}

function richTextField(body) {
  const html = prepareArticleBody(body).html;
  return `<div class="field"><span>Text</span>
    <div class="rich">
      <textarea class="control" name="body" maxlength="20000" rows="12" hidden>${esc(html)}</textarea>
    </div>
    <span class="hint">Nadpisy, seznamy, tučné, kurzíva, podtržení, citace a odkazy. Adresa začíná na https://, http://, mailto: nebo /.</span>
  </div>`;
}

function articleFields(ctx, source) {
  const selected = source?.category ?? "Zprávy";
  return `
    ${field("Nadpis", `<input class="${input}" name="title" required maxlength="160" value="${esc(source?.title ?? "")}">`)}
    ${field("Perex", `<textarea class="${input}" name="excerpt" required maxlength="320" rows="3">${esc(source?.excerpt ?? "")}</textarea>`)}
    ${richTextField(source?.body ?? "")}
    ${field("Rubrika", `<select class="${input}" name="category">${categoryOptions(ctx, selected)}</select>`)}
    ${field("Fotka", photoControl(source))}`;
}

function proposalKind(item) {
  return item.articleId ? "Návrh úpravy" : "Nový příspěvek";
}

function chiefArticles(ctx, data, message, query) {
  const proposal = data.proposals.find((item) => item.id === query.proposalId) ?? null;
  const editing = proposal ? null : (data.articles.find((item) => item.id === query.editingId) ?? null);
  const queue = data.proposals
    .map(
      (item) => `<li class="card">
        <p class="kicker">${proposalKind(item)} · ${esc(credit(item))}</p>
        <h3>${esc(item.title)}</h3>
        <p class="muted">${esc(item.excerpt)}</p>
        ${item.articleTitle ? `<p class="meta">Ke zprávě: ${esc(item.articleTitle)}</p>` : ""}
        <div class="row"><a class="btn btn-line" href="/redakce/zpravy?navrh=${item.id}">Otevřít</a></div>
      </li>`,
    )
    .join("");
  const list = data.articles
    .map((item) => {
      const confirm =
        query.confirmId === item.id
          ? `<form method="post" action="/redakce/zpravy/smazat">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Opravdu smazat</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/zpravy">Nechat</a>`
          : `<a class="btn btn-ghost" href="/redakce/zpravy?smazat=${item.id}">Smazat</a>`;
      return `<li class="card">
        <p class="kicker">${esc(catLabel(ctx.copy, item.category))}${credit(item) ? ` · ${esc(credit(item))}` : ""}${item.published ? "" : " · skrytá"}${item.redacted ? " · redigováno" : ""}</p>
        <h3>${esc(item.title)}</h3>
        <div class="row">
          <a class="btn btn-line" href="/redakce/zpravy?id=${item.id}">Upravit</a>
          ${confirm}
        </div>
      </li>`;
    })
    .join("");
  const form = proposal
    ? `<div class="stack"><form class="card form" method="post" action="/redakce/zpravy/schvalit" enctype="multipart/form-data">
        <h2>${proposal.articleId ? "Schválit úpravu" : "Schválit příspěvek"}</h2>
        <p class="muted">Autor na webu: ${esc(credit(proposal))}. Text můžete před schválením upravit, typicky češtinu. Ven se neukáže, co se měnilo. Když se znění liší od návrhu, u autora bude nanejvýš slovo Redigováno.</p>
        ${proposal.articleTitle ? `<p class="meta">Ke zprávě: ${esc(proposal.articleTitle)}</p>` : ""}
        <input type="hidden" name="id" value="${proposal.id}">
        ${articleFields(ctx, proposal)}
        <div class="row">
          <button class="btn btn-primary" type="submit">Schválit a zveřejnit</button>
          <a class="btn btn-ghost" href="/redakce/zpravy">Zpět</a>
        </div>
      </form>
      <form class="card form" method="post" action="/redakce/zpravy/vratit">
        <input type="hidden" name="id" value="${proposal.id}">
        ${field("Poznámka pro autora", `<textarea class="${input}" name="note" maxlength="400" rows="3" placeholder="Co má dopracovat. Může zůstat prázdné."></textarea>`)}
        <button class="btn btn-line" type="submit">Vrátit</button>
      </form></div>`
    : `<form class="card form" method="post" action="/redakce/zpravy/ulozit" enctype="multipart/form-data">
        <h2>${editing ? "Upravit zprávu" : "Nová zpráva"}</h2>
        <p class="muted">${
          !editing
            ? `Jde na web hned a podepíše se jako ${esc(byline(data.user) || "Redakce")}.`
            : credit(editing) && editing.authorId !== data.user?.id
              ? `Autor zůstává ${esc(credit(editing))}. Když změníte text, na webu se objeví nanejvýš slovo Redigováno.`
              : "Úprava jde na web hned."
        }</p>
        ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
        ${articleFields(ctx, editing)}
        <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
        <div class="row">
          <button class="btn btn-primary" type="submit">Uložit</button>
          ${editing ? `<a class="btn btn-ghost" href="/redakce/zpravy">Nová</a>` : ""}
        </div>
      </form>`;
  const queueHtml = queue
    ? `<section class="block"><h2>Ke schválení</h2><ul class="stack plain">${queue}</ul></section>`
    : "";
  return adminShell(
    ctx,
    data,
    "zpravy",
    message,
    `${queueHtml}<div class="split">${form}<ul class="stack plain">${list}</ul></div>`,
    { rich: true },
  );
}

function contributorArticles(ctx, data, message, query) {
  const opened = data.proposals.find((item) => item.id === query.proposalId) ?? null;
  const target = data.articles.find((item) => item.id === query.targetId) ?? null;
  const existingForTarget = target
    ? (data.proposals.find((item) => item.articleId === target.id) ?? null)
    : null;
  const proposal = opened ?? existingForTarget;
  const source = proposal ?? target;
  const linked = data.articles.find((item) => item.id === (proposal?.articleId ?? target?.id)) ?? null;
  const editingArticle = Boolean(proposal?.articleId || target);
  const mine = Boolean(linked && linked.authorId === data.user?.id);
  const heading = !editingArticle
    ? proposal
      ? "Váš příspěvek"
      : "Nový příspěvek"
    : mine
      ? "Úprava vaší zprávy"
      : "Návrh úpravy";
  const help = !editingArticle
    ? `Na web to přijde, až to schválí hlavní redaktor. Do té doby to tu můžete měnit. Podepíše se jako ${esc(byline(data.user))}.`
    : mine
      ? "Veřejné znění se nezmění, dokud úpravu neschválí hlavní redaktor."
      : "Cizí zprávu nejde přepsat přímo. Tohle je návrh a rozhodne o něm hlavní redaktor. Autor zůstane ten původní.";
  const formSource = source ? { ...source, imageKey: source.imageKey || linked?.imageKey || null } : null;
  const returned = proposal?.status === "rejected" && proposal.note
    ? `<p class="banner">${esc(proposal.note)}</p>`
    : proposal?.status === "rejected"
      ? `<p class="banner">Hlavní redaktor návrh vrátil. Upravte ho a pošlete znovu.</p>`
      : "";
  const form = `<form class="card form" method="post" action="/redakce/zpravy/navrh" enctype="multipart/form-data">
    <h2>${heading}</h2>
    <p class="muted">${help}</p>
    ${returned}
    ${proposal ? `<input type="hidden" name="id" value="${proposal.id}">` : ""}
    ${target && !proposal ? `<input type="hidden" name="clanek" value="${target.id}">` : ""}
    ${proposal?.articleId ? `<input type="hidden" name="clanek" value="${proposal.articleId}">` : ""}
    ${articleFields(ctx, formSource)}
    <div class="row">
      <button class="btn btn-primary" type="submit">${proposal ? "Uložit návrh" : target ? "Poslat návrh" : "Poslat ke schválení"}</button>
      ${proposal || target ? `<a class="btn btn-ghost" href="/redakce/zpravy">Nový</a>` : ""}
    </div>
  </form>`;
  const own = data.proposals
    .map((item) => {
      const confirm =
        query.withdrawId === item.id
          ? `<form method="post" action="/redakce/zpravy/stahnout">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Opravdu stáhnout</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/zpravy">Nechat</a>`
          : `<a class="btn btn-ghost" href="/redakce/zpravy?stahnout=${item.id}">Stáhnout</a>`;
      const state = item.status === "rejected" ? "Vráceno" : "Čeká na schválení";
      return `<li class="card">
        <p class="kicker">${proposalKind(item)} · ${state}</p>
        <h3>${esc(item.title)}</h3>
        ${item.note ? `<p class="muted">${esc(item.note)}</p>` : ""}
        <div class="row">
          <a class="btn btn-line" href="/redakce/zpravy?navrh=${item.id}">Upravit</a>
          ${confirm}
        </div>
      </li>`;
    })
    .join("");
  const published = data.articles
    .map((item) => {
      const mine = item.authorId === data.user?.id;
      const open = data.proposals.find((proposal) => proposal.articleId === item.id);
      const href = open ? `/redakce/zpravy?navrh=${open.id}` : `/redakce/zpravy?clanek=${item.id}`;
      return `<li class="card">
        <p class="kicker">${esc(catLabel(ctx.copy, item.category))}${credit(item) ? ` · ${esc(credit(item))}` : ""}${mine ? " · vaše" : ""}</p>
        <h3>${esc(item.title)}</h3>
        <div class="row"><a class="btn btn-line" href="${href}">${mine ? "Upravit" : "Navrhnout úpravu"}</a></div>
      </li>`;
    })
    .join("");
  const side = `
    <section class="block"><h2>Vaše návrhy</h2>${own ? `<ul class="stack plain">${own}</ul>` : `<p class="card dashed muted">Zatím tu nic nečeká.</p>`}</section>
    <section class="block"><h2>Zprávy na webu</h2><ul class="stack plain">${published}</ul></section>`;
  return adminShell(ctx, data, "zpravy", message, `<div class="split">${form}<div class="stack">${side}</div></div>`, {
    rich: true,
  });
}

export function adminArticles(ctx, data, message, query = {}) {
  if (data.user?.role === "hlavni") return chiefArticles(ctx, data, message, query);
  return contributorArticles(ctx, data, message, query);
}

function permissionBoxes(selected) {
  const have = new Set(selected ?? []);
  return PERMISSIONS.map(
    (item) =>
      `<label class="check"><input type="checkbox" name="permission" value="${esc(item.code)}"${have.has(item.code) ? " checked" : ""}> ${esc(item.label)}</label><span class="hint">${esc(item.detail)}</span>`,
  ).join("");
}

export function adminPeople(ctx, data, message, disableId) {
  const list = data.users
    .map((person) => {
      const extras = PERMISSIONS.filter((item) => person.permissions?.includes(item.code)).map((item) => item.label);
      const role = person.role === "hlavni" ? "hlavní redaktor" : ["přispěvatel", ...extras].join(" · ");
      const state = person.active ? "" : " · vypnutý";
      let controls = "";
      if (person.role !== "hlavni") {
        controls = person.active
          ? disableId === person.id
            ? `<form method="post" action="/redakce/lide/stav">
                <input type="hidden" name="id" value="${person.id}">
                <input type="hidden" name="active" value="0">
                <button class="btn btn-primary" type="submit">Opravdu vypnout</button>
              </form>
              <a class="btn btn-ghost" href="/redakce/lide">Nechat</a>`
            : `<a class="btn btn-ghost" href="/redakce/lide?vypnout=${person.id}">Vypnout</a>`
          : `<form method="post" action="/redakce/lide/stav">
              <input type="hidden" name="id" value="${person.id}">
              <input type="hidden" name="active" value="1">
              <button class="btn btn-line" type="submit">Zapnout</button>
            </form>`;
      }
      const access =
        person.role === "hlavni"
          ? ""
          : `<form class="form" method="post" action="/redakce/lide/udaje">
              <input type="hidden" name="id" value="${person.id}">
              ${field("Alias", `<input class="${input}" name="alias" maxlength="60" value="${esc(person.alias)}" autocomplete="off">`)}
              <span class="hint">Když je alias vyplněný, na webu se ukáže místo jména pod článkem. Prázdné pole znamená, že zůstane jméno.</span>
              ${permissionBoxes(person.permissions)}
              <button class="btn btn-line" type="submit">Uložit alias a oprávnění</button>
            </form>`;
      const password =
        person.role === "hlavni"
          ? ""
          : `<form class="form" method="post" action="/redakce/lide/heslo">
              <input type="hidden" name="id" value="${person.id}">
              ${field("Nové heslo", `<input class="${input}" type="password" name="next" minlength="8" required autocomplete="new-password">`)}
              <button class="btn btn-line" type="submit">Nastavit heslo</button>
            </form>`;
      return `<li class="card">
        <p class="kicker">${esc(role)}${state}</p>
        <h3>${esc(person.name)}</h3>
        <p class="meta">Na webu: ${esc(byline(person))}</p>
        <p class="muted">${esc(person.login)}</p>
        <div class="row">${controls}</div>
        ${access}
        ${password}
      </li>`;
    })
    .join("");
  const form = `<form class="card form" method="post" action="/redakce/lide/ulozit">
    <h2>Nový přispěvatel</h2>
    <p class="muted">Přispěvatel píše své zprávy a může navrhnout úpravu jiných. Na web se dostanou, až je schválíte. Cizí text přímo nezmění. Reklamu může navrhnout každý přihlášený, zvláštní oprávnění na to není, a na web přijde taky až ji schválíte. Oprávnění jdou přidávat: teď je tu sběrný dvůr a lékaři.</p>
    ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" autocomplete="off">`)}
    ${field("Alias", `<input class="${input}" name="alias" maxlength="60" autocomplete="off">`)}
    <span class="hint">Nepovinné. Když ho vyplní, na webu se ukáže místo jména. Sám si ho pak může změnit v záložce Heslo.</span>
    ${field("Přihlašovací jméno", `<input class="${input}" name="login" required minlength="3" maxlength="32" autocapitalize="none" autocomplete="off">`)}
    <span class="hint">Malá písmena a číslice, bez mezer. Třeba jana.</span>
    ${field("Heslo", `<input class="${input}" type="password" name="password" required minlength="8" autocomplete="new-password">`)}
    ${permissionBoxes([])}
    <button class="btn btn-primary" type="submit">Přidat</button>
  </form>`;
  return adminShell(ctx, data, "lide", message, `<div class="split">${form}<ul class="stack plain">${list}</ul></div>`);
}

export function adminTexts(ctx, data, message) {
  const groups = [];
  for (const item of COPY) {
    const last = groups.at(-1);
    if (!last || last.name !== item.group) groups.push({ name: item.group, items: [item] });
    else last.items.push(item);
  }
  const blocks = groups
    .map((group) => {
      const fields = group.items
        .map((item) => {
          const value = tx(ctx.copy, item.key);
          const control = item.long
            ? `<textarea class="${input}" name="${item.key}" rows="3" maxlength="${item.max}" required>${esc(value)}</textarea>`
            : `<input class="${input}" name="${item.key}" maxlength="${item.max}" required value="${esc(value)}">`;
          return field(item.label, control);
        })
        .join("");
      return `<h2>${esc(group.name)}</h2>${fields}`;
    })
    .join("");
  const form = `<form class="card form" method="post" action="/redakce/texty/ulozit">
    <h2>Texty webu</h2>
    <p class="muted">Tady se mění nápisy, titulky a odstavce na veřejných stránkách. Samotné zprávy jsou v záložce Zprávy, pozvánky v Akcích. Kontakt na redakci, vysvětlení svozu a poznámka ke svátkům zůstávají u Popelnic. Ve větách odpočtu nechte {n} tam, kde má být počet dní.</p>
    ${blocks}
    <button class="btn btn-primary" type="submit">Uložit texty</button>
  </form>`;
  return adminShell(ctx, data, "texty", message, form);
}

export function adminEvents(ctx, data, message, editingId, confirmId) {
  const editing = data.events.find((item) => item.id === editingId) ?? null;
  const list = data.events.length
    ? data.events
        .map((item) => {
          const confirm =
            confirmId === item.id
              ? `<form method="post" action="/redakce/akce/smazat">
                  <input type="hidden" name="id" value="${item.id}">
                  <input type="hidden" name="confirm" value="1">
                  <button class="btn btn-primary" type="submit">Opravdu smazat</button>
                </form>
                <a class="btn btn-ghost" href="/redakce/akce">Nechat</a>`
              : `<a class="btn btn-ghost" href="/redakce/akce?smazat=${item.id}">Smazat</a>`;
          return `<li class="card">
            <p class="kicker">${esc(formatLong(item.startsOn))}${item.published ? "" : " · skrytá"}</p>
            <h3>${esc(item.title)}</h3>
            <p class="muted">${esc(item.place)}</p>
            <div class="row">
              <a class="btn btn-line" href="/redakce/akce?id=${item.id}">Upravit</a>
              ${confirm}
            </div>
          </li>`;
        })
        .join("")
    : `<li class="card dashed muted">Zatím žádná akce. Přidejte první pozvánku vlevo.</li>`;
  const form = `<form class="card form" method="post" action="/redakce/akce/ulozit">
    <h2>${editing ? "Upravit akci" : "Nová akce"}</h2>
    ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
    ${field("Název", `<input class="${input}" name="title" required maxlength="160" value="${esc(editing?.title ?? "")}">`)}
    ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}">`)}
    <div class="pair">
      ${field("Datum", `<input class="${input}" type="date" name="startsOn" required value="${esc(editing?.startsOn ?? "")}">`)}
      ${field("Čas", `<input class="${input}" type="time" name="startsTime" value="${esc(editing?.startsTime ?? "")}">`)}
    </div>
    ${field("Popis", `<textarea class="${input}" name="description" maxlength="4000" rows="4">${esc(editing?.description ?? "")}</textarea>`)}
    <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
    <div class="row">
      <button class="btn btn-primary" type="submit">Uložit</button>
      ${editing ? `<a class="btn btn-ghost" href="/redakce/akce">Nová</a>` : ""}
    </div>
  </form>`;
  return adminShell(ctx, data, "akce", message, `<div class="split">${form}<ul class="stack plain">${list}</ul></div>`);
}

export function adminSite(ctx, data, message) {
  const waste = data.waste;
  const days = [1, 2, 3, 4, 5, 6, 0]
    .map(
      (day) =>
        `<option value="${day}"${waste.weekday === day ? " selected" : ""}>${weekdayName(day)}</option>`,
    )
    .join("");
  const form = `<form class="card form narrow" method="post" action="/redakce/svoz/ulozit">
    <h2>Popelnice a kontakt</h2>
    <p class="muted">Nejbližší svoz se počítá z tohoto pravidla, stejně jako na popelnice.kopidlenskadrbna.org. Teď vychází na ${esc(formatLong(waste.nextDate))}.</p>
    ${field("Den svozu", `<select class="${input}" name="weekday">${days}</select>`)}
    ${field(
      "Týdny",
      `<select class="${input}" name="weekParity">
        <option value="1"${waste.weekParity === 1 ? " selected" : ""}>Liché kalendářní týdny</option>
        <option value="0"${waste.weekParity === 0 ? " selected" : ""}>Sudé kalendářní týdny</option>
      </select>`,
    )}
    ${field("Opakovat po dnech", `<input class="${input}" type="number" name="stepDays" min="7" max="56" required value="${waste.stepDays}">`)}
    ${field("Vysvětlení na stránce svozu", `<textarea class="${input}" name="wasteNote" rows="4" maxlength="800">${esc(waste.note)}</textarea>`)}
    ${field("Poznámka ke svátkům", `<input class="${input}" name="holidayNote" maxlength="160" value="${esc(waste.holidayNote)}">`)}
    ${field("Kontakt na stránce O nás", `<textarea class="${input}" name="contactNote" rows="3" maxlength="600">${esc(data.contactNote)}</textarea>`)}
    <button class="btn btn-primary" type="submit">Uložit</button>
  </form>`;
  return adminShell(ctx, data, "svoz", message, form);
}

export function adminPassword(ctx, data, message) {
  const shown = byline(data.user);
  const form = `<form class="card form narrow" method="post" action="/redakce/jmeno/ulozit">
    <h2>Jméno a alias</h2>
    <p class="muted">Jméno je základ pod článkem. Alias je dobrovolný. Když ho používáte, na webu se u vašich zpráv ukáže on, ne jméno. Když alias smažete, znovu se ukáže jméno, se kterým zpráva vyšla. Teď se na webu ukáže: ${esc(shown)}.</p>
    ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" value="${esc(data.user?.name ?? "")}">`)}
    ${field("Alias", `<input class="${input}" name="alias" maxlength="60" value="${esc(data.user?.alias ?? "")}" autocomplete="nickname">`)}
    <button class="btn btn-primary" type="submit">Uložit jméno a alias</button>
  </form>
  <form class="card form narrow" method="post" action="/redakce/heslo/ulozit">
    <h2>Heslo</h2>
    ${field("Současné heslo", `<input class="${input}" type="password" name="current" autocomplete="current-password" required>`)}
    ${field("Nové heslo", `<input class="${input}" type="password" name="next" autocomplete="new-password" minlength="8" required>`)}
    <button class="btn btn-primary" type="submit">Změnit heslo</button>
  </form>`;
  return adminShell(ctx, data, "heslo", message, form);
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

function outagesTeaser(data, ctx) {
  const items = (data.outages?.items ?? [])
    .filter((item) => item.phase === "now" || item.phase === "soon")
    .slice(0, 3);
  if (!items.length) return "";
  const lines = items
    .map((item) => {
      const kind = item.phase === "now" ? "is-closure" : "is-later";
      const where = item.placeLabels?.[0] ?? "";
      return `<li class="${kind}">
        <p class="yard-home-name">${esc(item.areaName)}</p>
        <p class="yard-home-state">${esc(item.state)}</p>
        <p class="yard-home-detail">${esc(item.when)}</p>
        ${where ? `<p class="yard-home-detail">${esc(where)}</p>` : ""}
      </li>`;
    })
    .join("");
  return `<div class="card waste-teaser">
    <p class="eyebrow">${esc(tx(ctx.copy, "home_outages_button"))}</p>
    <ul class="yard-home">${lines}</ul>
    <div class="row"><a class="btn btn-primary" href="/odstavky">${esc(tx(ctx.copy, "home_outages_button"))}</a></div>
  </div>`;
}

function dayLabel(day) {
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

function hoursFields(week) {
  return `<div class="hours-grid"><span>Otevřeno ve dnech</span>${week
    .map(
      (slot) => `<div class="hours-row">
        <label class="check"><input type="checkbox" name="open-${slot.day}" value="1"${slot.open ? " checked" : ""}> ${esc(dayLabel(slot.day))}</label>
        <input class="control" type="time" name="from-${slot.day}" value="${esc(slot.from)}" aria-label="${esc(dayLabel(slot.day))} od">
        <input class="control" type="time" name="to-${slot.day}" value="${esc(slot.to)}" aria-label="${esc(dayLabel(slot.day))} do">
      </div>`,
    )
    .join("")}<span class="hint">Zaškrtněte den a doplňte od a do. Den bez fajfky je zavřený.</span></div>`;
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

function closureAdmin(yard, cancelId) {
  const items = yard.closures.length
    ? yard.closures
        .map((closure) => {
          const confirm =
            cancelId === closure.id
              ? `<form method="post" action="/redakce/dvory/uzavreni/smazat">
                  <input type="hidden" name="id" value="${closure.id}">
                  <input type="hidden" name="confirm" value="1">
                  <button class="btn btn-primary" type="submit">Opravdu zrušit</button>
                </form>
                <a class="btn btn-ghost" href="/redakce/dvory">Nechat</a>`
              : `<a class="btn btn-ghost" href="/redakce/dvory?zrusit=${closure.id}">Zrušit uzavření</a>`;
          return `<div class="date-tile">
            <strong>${esc(closureLabel(closure))}</strong>
            <span>${esc(closure.reason)}</span>
            <div class="row">${confirm}</div>
          </div>`;
        })
        .join("")
    : `<p class="muted">Žádné zapsané uzavření.</p>`;
  return `<p class="meta">Mimořádné uzavření</p>
    <div class="dates compact">${items}</div>
    <form class="form" method="post" action="/redakce/dvory/uzavreni">
      <input type="hidden" name="yardId" value="${yard.id}">
      <div class="pair">
        ${field("Od", `<input class="${input}" type="date" name="startsOn" required>`)}
        ${field("Do", `<input class="${input}" type="date" name="endsOn">`)}
      </div>
      <span class="hint">Když jde o jeden den, pole Do nechte prázdné.</span>
      ${field("Důvod", `<textarea class="${input}" name="reason" required maxlength="400" rows="2" placeholder="Třeba inventura nebo porucha vrat."></textarea>`)}
      <button class="btn btn-line" type="submit">Zapsat uzavření</button>
    </form>`;
}

export function adminYards(ctx, data, message, editingId, confirmId, cancelId) {
  const chief = data.user?.role === "hlavni";
  const editing = chief ? (data.yards.find((item) => item.id === editingId) ?? null) : null;
  const list = data.yards.length
    ? data.yards
        .map((item) => {
          const confirm =
            chief && confirmId === item.id
              ? `<form method="post" action="/redakce/dvory/smazat">
                  <input type="hidden" name="id" value="${item.id}">
                  <input type="hidden" name="confirm" value="1">
                  <button class="btn btn-primary" type="submit">Opravdu smazat</button>
                </form>
                <a class="btn btn-ghost" href="/redakce/dvory">Nechat</a>`
              : chief
                ? `<a class="btn btn-line" href="/redakce/dvory?id=${item.id}">Upravit</a>
                   <a class="btn btn-ghost" href="/redakce/dvory?smazat=${item.id}">Smazat</a>`
                : "";
          return `<li class="card">
            <p class="kicker">${esc(item.place)}${item.published ? "" : " · skrytý"}</p>
            <h3>${esc(item.name)}</h3>
            <p class="keep-lines">${esc(item.accepts)}</p>
            <p class="muted">${esc(hoursSummary(item))}</p>
            ${confirm ? `<div class="row">${confirm}</div>` : ""}
            ${closureAdmin(item, cancelId)}
          </li>`;
        })
        .join("")
    : `<li class="card dashed muted">Zatím žádný sběrný dvůr.</li>`;
  const form = chief
    ? `<form class="card form" method="post" action="/redakce/dvory/ulozit">
        <h2>${editing ? "Upravit sběrný dvůr" : "Nový sběrný dvůr"}</h2>
        <p class="muted">Název, co se tam vozí a kdy má otevřeno. Mimořádné uzavření může zapsat i člověk s oprávněním Sběrný dvůr.</p>
        ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
        ${field("Název", `<input class="${input}" name="name" required maxlength="120" value="${esc(editing?.name ?? "")}">`)}
        ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}">`)}
        ${field("Co se tam vozí", `<textarea class="${input}" name="accepts" required maxlength="1200" rows="4">${esc(editing?.accepts ?? "")}</textarea>`)}
        ${hoursFields(editing?.week ?? WEEK_DAYS.map(({ day }) => ({ day, open: false, from: "08:00", to: "16:00" })))}
        ${field("Pořadí", `<input class="${input}" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? 0}">`)}
        <span class="hint">Menší číslo je na stránce výš.</span>
        <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
        <div class="row">
          <button class="btn btn-primary" type="submit">Uložit</button>
          ${editing ? `<a class="btn btn-ghost" href="/redakce/dvory">Nový</a>` : ""}
        </div>
      </form>`
    : `<section class="card">
        <h2>Mimořádné uzavření</h2>
        <p class="muted">Dvory a otevírací dobu nastavuje hlavní redaktor. Sem se píše den, nebo rozmezí, a důvod, proč je zavřeno.</p>
      </section>`;
  return adminShell(
    ctx,
    data,
    "dvory",
    message,
    `<div class="${chief ? "split" : "stack"}">${form}<ul class="stack plain">${list}</ul></div>`,
  );
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

function slotRow(label, prefix, day, part, placeholder) {
  const name = dayLabel(day);
  return `<div class="slot-row">
    <label class="check"><input type="checkbox" name="${prefix}-open-${day}" value="1"${part.open ? " checked" : ""}> ${label}</label>
    <input class="control" type="time" name="${prefix}-from-${day}" value="${esc(part.from)}" aria-label="${esc(name)} ${label} od">
    <input class="control" type="time" name="${prefix}-to-${day}" value="${esc(part.to)}" aria-label="${esc(name)} ${label} do">
    <input class="control slot-note" type="text" name="${prefix}-note-${day}" maxlength="160" value="${esc(part.note)}" placeholder="${esc(placeholder)}" aria-label="${esc(name)} ${label}, poznámka">
  </div>`;
}

function doctorHoursFields(week) {
  const days = week?.length ? week : blankWeek();
  return `<div class="hours-grid"><span>Ordinační hodiny</span>${days
    .map(
      (slot) => `<div class="hours-day">
        <p class="meta">${esc(dayLabel(slot.day))}</p>
        ${slotRow("Dopoledne", "am", slot.day, slot.morning, "Třeba jen pro objednané")}
        ${slotRow("Odpoledne", "pm", slot.day, slot.afternoon, "Třeba jen akutní případy")}
      </div>`,
    )
    .join("")}<span class="hint">Dopoledne a odpoledne se zaškrtávají zvlášť, ať mezi nimi může být polední pauza. Ke každé půlce jde poznámka. Půlka bez fajfky v ten den není.</span></div>`;
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

function outageCard(item, { showArea, copy }) {
  const places = (item.placeLabels ?? [])
    .map((label) => `<li>${esc(label)}</li>`)
    .join("");
  const more = item.morePlaces
    ? `<p class="muted outage-more">A dalších ${esc(item.morePlaces)} míst.</p>`
    : "";
  const parcels = item.parcelLine ? `<p class="meta">${esc(item.parcelLine)}</p>` : "";
  const pdf = item.announcementUrl
    ? `<p><a href="${esc(item.announcementUrl)}" target="_blank" rel="noopener noreferrer">${esc(tx(copy, "outages_announcement"))}</a></p>`
    : "";
  return `<article class="card yard">
    ${showArea ? `<p class="kicker">${esc(item.areaName)}</p>` : ""}
    <p class="outage-state is-${esc(item.phase)}">${esc(item.state)}</p>
    <p class="outage-when">${esc(item.when)}</p>
    ${places ? `<ul class="outage-places">${places}</ul>` : ""}
    ${more}
    ${parcels}
    ${pdf}
  </article>`;
}

function outageEmpty(board, copy) {
  if (!board.areas.length) return tx(copy, "outages_none_watched");
  if (!board.fetchedAt) return tx(copy, "outages_waiting");
  return tx(copy, "outages_empty");
}

export function outagesPage(data, ctx) {
  const board = data.outages ?? { items: [], areas: [], fetchedAt: null, status: "", note: "", checked: "" };
  const showArea = board.areas.length > 1;
  const current = board.items.filter((item) => item.phase === "now");
  const planned = board.items.filter((item) => item.phase !== "now");
  const section = (heading, items) =>
    items.length
      ? `<section class="block"><h2>${esc(heading)}</h2><div class="stack">${items
          .map((item) => outageCard(item, { showArea, copy: ctx.copy }))
          .join("")}</div></section>`
      : "";
  const list = board.items.length
    ? `${section(tx(ctx.copy, "outages_current"), current)}${section(tx(ctx.copy, "outages_planned"), planned)}`
    : `<p class="card dashed muted">${esc(outageEmpty(board, ctx.copy))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "outages_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "outages_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "outages_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "outages_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "outages_lede"))}</p>
      ${board.note ? `<p class="banner">${esc(board.note)}</p>` : ""}
      ${board.checked ? `<p class="meta">${esc(board.checked)}</p>` : ""}
      ${list}
      <p class="fine">${esc(tx(ctx.copy, "outages_disclaimer"))} <a href="https://www.bezstavy.cz/" target="_blank" rel="noopener noreferrer">${esc(tx(ctx.copy, "outages_source"))}</a></p>`,
  });
}

function doctorChangeAdmin(doctor, cancelId) {
  const items = doctor.changes.length
    ? doctor.changes
        .map((change) => {
          const hours = periodClosed(change) ? "Zavřeno" : spanSummary(change);
          const confirm =
            cancelId === change.id
              ? `<form method="post" action="/redakce/lekari/zmena/smazat">
                  <input type="hidden" name="id" value="${change.id}">
                  <input type="hidden" name="confirm" value="1">
                  <button class="btn btn-primary" type="submit">Opravdu zrušit</button>
                </form>
                <a class="btn btn-ghost" href="/redakce/lekari">Nechat</a>`
              : `<a class="btn btn-ghost" href="/redakce/lekari?zrusit=${change.id}">Zrušit změnu</a>`;
          return `<div class="date-tile">
            <strong>${esc(closureLabel(change))}</strong>
            <span>${esc(change.note)}</span>
            <span>${esc(hours)}</span>
            <div class="row">${confirm}</div>
          </div>`;
        })
        .join("")
    : `<p class="muted">Žádná zapsaná dočasná změna.</p>`;
  return `<p class="meta">Dočasná změna</p>
    <div class="dates compact">${items}</div>
    <form class="form" method="post" action="/redakce/lekari/zmena">
      <input type="hidden" name="doctorId" value="${doctor.id}">
      <div class="pair">
        ${field("Od", `<input class="${input}" type="date" name="startsOn" required>`)}
        ${field("Do", `<input class="${input}" type="date" name="endsOn">`)}
      </div>
      <span class="hint">Když jde o jeden den, pole Do nechte prázdné. Na titulce se změna ukáže ${HOME_LEAD_DAYS} dní předem a po dobu, kdy platí. Na stránce Lékaři je vidět hned.</span>
      ${field("Poznámka", `<textarea class="${input}" name="changeNote" required maxlength="400" rows="2" placeholder="Třeba: sestra přítomna, zastupuje MUDr. Novák. Nebo: akutní případy ošetří ordinace v Jičíně."></textarea>`)}
      ${doctorHoursFields(blankWeek())}
      <span class="hint">Bez zaškrtnutého času je ordinace v tom období zavřená a na webu zůstane poznámka.</span>
      <button class="btn btn-line" type="submit">Zapsat změnu</button>
    </form>`;
}

function doctorHoursAdmin(doctor) {
  return `<form class="form" method="post" action="/redakce/lekari/hodiny">
    <input type="hidden" name="doctorId" value="${doctor.id}">
    ${doctorHoursFields(doctor.week)}
    <button class="btn btn-line" type="submit">Uložit hodiny</button>
  </form>`;
}

export function adminDoctors(ctx, data, message, editingId, confirmId, cancelId) {
  const chief = data.user?.role === "hlavni";
  const editing = chief ? (data.doctors.find((item) => item.id === editingId) ?? null) : null;
  const list = data.doctors.length
    ? data.doctors
        .map((item) => {
          const confirm =
            chief && confirmId === item.id
              ? `<form method="post" action="/redakce/lekari/smazat">
                  <input type="hidden" name="id" value="${item.id}">
                  <input type="hidden" name="confirm" value="1">
                  <button class="btn btn-primary" type="submit">Opravdu smazat</button>
                </form>
                <a class="btn btn-ghost" href="/redakce/lekari">Nechat</a>`
              : chief
                ? `<a class="btn btn-line" href="/redakce/lekari?id=${item.id}">Upravit</a>
                   <a class="btn btn-ghost" href="/redakce/lekari?smazat=${item.id}">Smazat</a>`
                : "";
          return `<li class="card">
            <p class="kicker">${esc(item.specialty)}${item.published ? "" : " · skrytá"}</p>
            <h3>${esc(item.name)}</h3>
            <p class="meta">${esc(item.place)}${item.phone ? ` · ${esc(item.phone)}` : ""}</p>
            <p class="muted">${esc(doctorHoursSummary(item))}</p>
            ${confirm ? `<div class="row">${confirm}</div>` : ""}
            ${chief ? "" : doctorHoursAdmin(item)}
            ${doctorChangeAdmin(item, cancelId)}
          </li>`;
        })
        .join("")
    : `<li class="card dashed muted">Zatím žádná ordinace.</li>`;
  const form = chief
    ? `<form class="card form" method="post" action="/redakce/lekari/ulozit">
        <h2>${editing ? "Upravit ordinaci" : "Nová ordinace"}</h2>
        <p class="muted">Jméno se na webu vypisuje přesně tak, jak ho zadáte. Věty jsou postavené tak, aby se jméno neskloňovalo. Hodiny a dočasnou změnu může měnit i člověk s oprávněním Lékaři.</p>
        ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
        ${field("Jméno", `<input class="${input}" name="name" required maxlength="120" value="${esc(editing?.name ?? "")}" placeholder="MUDr. Jana Nováková">`)}
        ${field("Obor", `<input class="${input}" name="specialty" required maxlength="120" value="${esc(editing?.specialty ?? "")}" placeholder="Praktický lékař">`)}
        ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}">`)}
        ${field("Telefon", `<input class="${input}" name="phone" maxlength="40" value="${esc(editing?.phone ?? "")}" inputmode="tel">`)}
        ${doctorHoursFields(editing?.week ?? blankWeek())}
        ${field("Pořadí", `<input class="${input}" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? 0}">`)}
        <span class="hint">Menší číslo je na stránce výš. Na titulce se ordinace ukáže jen při dočasné změně, ${HOME_LEAD_DAYS} dní předem.</span>
        <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
        <div class="row">
          <button class="btn btn-primary" type="submit">Uložit</button>
          ${editing ? `<a class="btn btn-ghost" href="/redakce/lekari">Nová</a>` : ""}
        </div>
      </form>`
    : `<section class="card">
        <h2>Ordinační hodiny</h2>
        <p class="muted">Jméno, obor a místo nastavuje hlavní redaktor. Tady se mění běžné hodiny i dočasná změna, obojí jedním oprávněním.</p>
      </section>`;
  return adminShell(
    ctx,
    data,
    "lekari",
    message,
    `<div class="${chief ? "split" : "stack"}">${form}<ul class="stack plain">${list}</ul></div>`,
  );
}

export function adminOutages(ctx, data, message, confirmId) {
  const areas = data.outageAreas ?? [];
  const board = data.outages ?? { items: [], areas: [], checked: "", note: "" };
  const confirming = areas.find((area) => area.id === confirmId) ?? null;
  const rows = areas
    .map((area) => {
      const remove =
        confirming?.id === area.id
          ? ""
          : `<a class="btn btn-ghost" href="/redakce/odstavky?smazat=${area.id}">Smazat</a>`;
      return `<li class="card">
        <input type="hidden" name="areaId" value="${area.id}">
        ${field("Název", `<input class="${input}" name="areaName" required maxlength="80" value="${esc(area.name)}">`)}
        ${field("Kód obce", `<input class="${input}" name="areaCode" required inputmode="numeric" maxlength="6" pattern="[0-9]{6}" value="${esc(area.code)}" autocomplete="off">`)}
        ${field("Pořadí", `<input class="${input}" type="number" name="areaSort" min="0" max="999" required value="${esc(area.sortOrder)}">`)}
        <label class="check"><input type="checkbox" name="areaOn" value="${area.id}"${area.enabled ? " checked" : ""}> Hledat v téhle obci</label>
        ${remove ? `<div class="row">${remove}</div>` : ""}
      </li>`;
    })
    .join("");
  const confirmForm = confirming
    ? `<form class="card" method="post" action="/redakce/odstavky/smazat">
        <p>Smazat obec ${esc(confirming.name)} (${esc(confirming.code)})?</p>
        <input type="hidden" name="id" value="${confirming.id}">
        <input type="hidden" name="confirm" value="1">
        <div class="row">
          <button class="btn btn-primary" type="submit">Opravdu smazat</button>
          <a class="btn btn-ghost" href="/redakce/odstavky">Nechat</a>
        </div>
      </form>`
    : "";
  const saveForm = areas.length
    ? `<form class="stack" method="post" action="/redakce/odstavky/ulozit">
        <ul class="stack plain">${rows}</ul>
        <button class="btn btn-primary" type="submit">Uložit oblasti</button>
      </form>`
    : `<p class="card dashed muted">Zatím se nehlídá žádná obec.</p>`;
  const watched = board.areas.map((area) => area.name).join(", ");
  const preview = board.items.length
    ? `<section class="block"><h2>Jak to vypadá na webu</h2><div class="stack">${board.items
        .map((item) => outageCard(item, { showArea: board.areas.length > 1, copy: ctx.copy }))
        .join("")}</div></section>`
    : board.fetchedAt
      ? `<p class="card dashed muted">${esc(outageEmpty(board, ctx.copy))}</p>`
      : "";
  const body = `<div class="stack">
    <section class="card">
      <h2>Hlídané obce</h2>
      <p class="muted">Drbna se ptá veřejného widgetu ČEZ Distribuce na odstávky v zaškrtnutých obcích. Načítá to worker, párkrát denně, a web pak čte uložený přehled. Na titulce se odstávka ukáže, když právě probíhá nebo začíná do ${OUTAGE_LEAD_DAYS} dní. Části Kopidlna, tedy Drahoraz, Mlýnec, Pševes a Ledkov, patří pod kód 573060. Další obec přidejte jejím šestimístným kódem.</p>
      <p class="meta">${esc(board.checked || "Ještě se nenačítalo.")}</p>
      ${watched ? `<p class="meta">Na webu se hledá v: ${esc(watched)}.</p>` : ""}
      ${board.note ? `<p class="banner">${esc(board.note)}</p>` : ""}
      <form method="post" action="/redakce/odstavky/nacist"><button class="btn btn-line" type="submit">Načíst teď</button></form>
    </section>
    ${confirmForm}
    ${saveForm}
    <form class="card form" method="post" action="/redakce/odstavky/pridat">
      <h2>Další obec</h2>
      ${field("Název", `<input class="${input}" name="name" required maxlength="80" placeholder="Třeba Jičíněves">`)}
      ${field("Kód obce", `<input class="${input}" name="code" required inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="573060" autocomplete="off">`)}
      ${field("Pořadí", `<input class="${input}" type="number" name="sortOrder" min="0" max="999" value="100">`)}
      <span class="hint">Menší číslo je na stránce výš. Kód je šest číslic z registru obcí.</span>
      <label class="check"><input type="checkbox" name="enabled" value="1" checked> Hledat v téhle obci</label>
      <button class="btn btn-primary" type="submit">Přidat obec</button>
    </form>
    ${preview}
  </div>`;
  return adminShell(ctx, data, "odstavky", message, body);
}

function adDraft(source, user, sample) {
  return {
    title: source?.title ?? "",
    body: source?.body ?? "",
    place: source?.place ?? "",
    link: source?.link ?? "",
    imageKey: source?.imageKey ?? null,
    sample: Boolean(sample && source?.sample),
    slug: "",
    createdOn: source?.createdOn ?? "",
    authorName: source?.authorName ?? user?.name ?? "",
    authorAlias: source?.authorAlias ?? user?.alias ?? "",
    enabled: source ? Boolean(source.enabled) : true,
  };
}

function adEditorForm(ctx, { action, heading, help, banner = "", hidden = "", draft, submit, aside = "" }) {
  return `<form class="ad-editor" data-ad-form method="post" action="${action}" enctype="multipart/form-data">
      <div class="card form">
        <h2>${heading}</h2>
        <p class="muted">${help}</p>
        ${banner}
        ${hidden}
        ${field("Název", `<input class="${input}" name="title" required maxlength="80" value="${esc(draft.title)}">`)}
        ${field("Text", `<textarea class="${input}" name="body" required maxlength="320" rows="4">${esc(draft.body)}</textarea>`)}
        ${field("Místo", `<input class="${input}" name="place" maxlength="80" value="${esc(draft.place)}" placeholder="třeba Mlýnec">`)}
        ${field("Odkaz", `<input class="${input}" name="link" maxlength="240" value="${esc(draft.link)}" placeholder="https://… nebo /cesta" inputmode="url">`)}
        <span class="hint">Volitelný. Na panelu se ukáže jako Víc. Adresa začíná na https://, http://, mailto: nebo /.</span>
        ${field(
          "Fotka",
          `<input class="${input}" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" data-edge="${PANEL_EDGE}" data-bytes="${PANEL_BYTES}">
           <span class="hint">Volitelná. Před odesláním se v prohlížeči zmenší a uloží jako WEBP. Delší strana nejvýš ${PANEL_EDGE} px.${draft.imageKey ? " Nová fotka nahradí tu současnou." : ""}</span>`,
        )}
        <label class="check"><input type="checkbox" name="enabled" value="1"${draft.enabled ? " checked" : ""}> Zobrazovat na webu</label>
        <div class="row">
          <button class="btn btn-primary" type="submit">${submit}</button>
          ${aside}
        </div>
      </div>
      <div class="ad-stage">
        <p class="hint">Tak bude panel vypadat na webu.</p>
        ${adPanel(draft, ctx.copy, { preview: true })}
        <p class="hint" data-ad="link-note"${draft.link ? "" : " hidden"}>${esc(draft.link)}</p>
        <p class="hint" data-ad="off"${draft.enabled ? " hidden" : ""}>Tahle nabídka je vypnutá a na webu se neukáže.</p>
      </div>
    </form>`;
}

function adProposalKind(item) {
  return item.adId ? "Úprava nabídky" : "Nová nabídka";
}

function liveAdList(ads, data, query, { chief }) {
  const manageable = (ad) => chief || ad.authorId === data.user?.id;
  if (!ads.length) return `<li class="card dashed muted">Zatím žádná nabídka.</li>`;
  return ads
    .map((item) => {
      const own = manageable(item);
      const waiting = (data.adProposals ?? []).some((proposal) => proposal.adId === item.id && proposal.status === "pending");
      const confirm =
        own && query.confirmId === item.id
          ? `<form method="post" action="/redakce/reklamy/smazat">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Smazat</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/reklamy">Nechat</a>`
          : "";
      const toggle = own
        ? `<form method="post" action="/redakce/reklamy/stav">
            <input type="hidden" name="id" value="${item.id}">
            <input type="hidden" name="enabled" value="${item.enabled ? "0" : "1"}">
            <button class="btn btn-line" type="submit">${item.enabled ? "Vypnout" : "Zapnout"}</button>
          </form>`
        : "";
      const edit = own && query.confirmId !== item.id
        ? `<a class="btn btn-line" href="/redakce/reklamy?id=${item.id}">Upravit</a>
           <a class="btn btn-ghost" href="/redakce/reklamy?smazat=${item.id}">Smazat</a>`
        : "";
      const marks = [
        item.place,
        item.enabled ? "zapnutá" : "vypnutá",
        item.sample ? "ukázka" : "",
        waiting ? "úprava čeká" : "",
        credit(item),
      ].filter(Boolean);
      return `<li class="card">
        <p class="kicker">${esc(marks.join(" · "))}</p>
        <h3>${esc(item.title)}</h3>
        <p class="muted">${esc(item.body)}</p>
        ${confirm || toggle || edit ? `<div class="row">${confirm}${query.confirmId === item.id ? "" : toggle}${edit}</div>` : ""}
      </li>`;
    })
    .join("");
}

export function adminAds(ctx, data, message, query = {}) {
  const chief = data.user?.role === "hlavni";
  const ads = data.ads ?? [];
  const proposals = data.adProposals ?? [];
  if (chief) {
    const proposal = proposals.find((item) => item.id === query.proposalId) ?? null;
    const editing = proposal ? null : (ads.find((item) => item.id === query.editingId) ?? null);
    const draft = adDraft(proposal ?? editing, proposal ? proposal : data.user, !proposal);
    if (editing) {
      draft.authorName = editing.authorName;
      draft.authorAlias = editing.authorAlias;
      draft.createdOn = editing.createdOn;
    }
    const queue = proposals
      .map(
        (item) => `<li class="card">
          <p class="kicker">${adProposalKind(item)} · ${esc(credit(item))}</p>
          <h3>${esc(item.title)}</h3>
          <p class="muted">${esc(item.body)}</p>
          ${item.adTitle ? `<p class="meta">K nabídce: ${esc(item.adTitle)}</p>` : ""}
          <div class="row"><a class="btn btn-line" href="/redakce/reklamy?navrh=${item.id}">Otevřít</a></div>
        </li>`,
      )
      .join("");
    const form = proposal
      ? `<div class="stack">${adEditorForm(ctx, {
          action: "/redakce/reklamy/schvalit",
          heading: proposal.adId ? "Schválit úpravu" : "Schválit nabídku",
          help: proposal.adId
            ? `Autor na webu: ${esc(credit(proposal))}. Text můžete před schválením upravit. Veřejné znění se změní, až úpravu schválíte.`
            : `Autor na webu: ${esc(credit(proposal))}. Text můžete před schválením upravit. Na web přijde, až ji schválíte.`,
          hidden: `<input type="hidden" name="id" value="${proposal.id}">`,
          draft,
          submit: "Schválit a zveřejnit",
          aside: `<a class="btn btn-ghost" href="/redakce/reklamy">Zpět</a>`,
        })}
        <form class="card form" method="post" action="/redakce/reklamy/vratit">
          <input type="hidden" name="id" value="${proposal.id}">
          ${field("Poznámka pro autora", `<textarea class="${input}" name="note" maxlength="400" rows="3" placeholder="Co má dopracovat. Může zůstat prázdné."></textarea>`)}
          <button class="btn btn-line" type="submit">Vrátit</button>
        </form></div>`
      : adEditorForm(ctx, {
          action: "/redakce/reklamy/ulozit",
          heading: editing ? "Upravit nabídku" : "Nová nabídka",
          help: editing
            ? "Úprava jde na web hned. Vypnout jde v seznamu zvlášť, text se tím nemění."
            : `Jde na web hned a podepíše se jako ${esc(byline(data.user) || "Redakce")}. Návrh přispěvatele schvalujete vy.`,
          hidden: editing ? `<input type="hidden" name="id" value="${editing.id}">` : "",
          draft,
          submit: "Uložit",
          aside: editing ? `<a class="btn btn-ghost" href="/redakce/reklamy">Nová</a>` : "",
        });
    const queueHtml = queue
      ? `<section class="block"><h2>Ke schválení</h2><ul class="stack plain">${queue}</ul></section>`
      : "";
    return adminShell(
      ctx,
      data,
      "reklamy",
      message,
      `<div class="stack">${queueHtml}${form}<p class="muted">Každou zveřejněnou nabídku jde vypnout zvlášť, text se tím nemění. Návrh přispěvatele se na web dostane, až ho schválíte.</p><ul class="stack plain">${liveAdList(ads, data, query, { chief: true })}</ul></div>`,
    );
  }

  const opened = proposals.find((item) => item.id === query.proposalId) ?? null;
  const target = ads.find((item) => item.id === query.editingId && item.authorId === data.user?.id) ?? null;
  const existingForTarget = target
    ? (proposals.find((item) => item.adId === target.id) ?? null)
    : null;
  const proposal = opened ?? existingForTarget;
  const source = proposal ?? target;
  const draft = adDraft(source, data.user, false);
  if (!proposal && target?.imageKey) draft.imageKey = target.imageKey;
  const returned = proposal?.status === "rejected" && proposal.note
    ? `<p class="banner">${esc(proposal.note)}</p>`
    : proposal?.status === "rejected"
      ? `<p class="banner">Hlavní redaktor návrh vrátil. Upravte ho a pošlete znovu.</p>`
      : "";
  const form = adEditorForm(ctx, {
    action: "/redakce/reklamy/navrh",
    heading: proposal?.adId || target ? "Úprava vaší nabídky" : proposal ? "Váš návrh" : "Nová nabídka",
    help: proposal?.adId || target
      ? "Veřejné znění se nezmění, dokud úpravu neschválí hlavní redaktor. Vypnout už zveřejněnou nabídku jde v seznamu hned."
      : `Na web to přijde, až to schválí hlavní redaktor. Do té doby to tu můžete měnit. Podepíše se jako ${esc(byline(data.user) || "Redakce")}.`,
    banner: returned,
    hidden: `${proposal ? `<input type="hidden" name="id" value="${proposal.id}">` : ""}${target && !proposal ? `<input type="hidden" name="nabidka" value="${target.id}">` : ""}`,
    draft,
    submit: proposal ? "Uložit návrh" : target ? "Poslat návrh" : "Poslat ke schválení",
    aside: proposal || target ? `<a class="btn btn-ghost" href="/redakce/reklamy">Nová</a>` : "",
  });
  const own = proposals
    .map((item) => {
      const confirm =
        query.withdrawId === item.id
          ? `<form method="post" action="/redakce/reklamy/stahnout">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Opravdu stáhnout</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/reklamy">Nechat</a>`
          : `<a class="btn btn-ghost" href="/redakce/reklamy?stahnout=${item.id}">Stáhnout</a>`;
      const state = item.status === "rejected" ? "Vráceno" : "Čeká na schválení";
      return `<li class="card">
        <p class="kicker">${adProposalKind(item)} · ${state}</p>
        <h3>${esc(item.title)}</h3>
        ${item.note ? `<p class="muted">${esc(item.note)}</p>` : ""}
        <div class="row">
          <a class="btn btn-line" href="/redakce/reklamy?navrh=${item.id}">Upravit</a>
          ${confirm}
        </div>
      </li>`;
    })
    .join("");
  return adminShell(
    ctx,
    data,
    "reklamy",
    message,
    `<div class="stack">${form}
      <section class="block"><h2>Vaše návrhy</h2>${own ? `<ul class="stack plain">${own}</ul>` : `<p class="card dashed muted">Zatím tu nic nečeká.</p>`}</section>
      <section class="block"><h2>Nabídky na webu</h2><ul class="stack plain">${liveAdList(ads, data, query, { chief: false })}</ul></section>
    </div>`,
  );
}

export function brokenPage(message) {
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Kopidlenská drbna</title>
  <body style="font-family:sans-serif;padding:2rem"><h1>Stránka se teď nenačte</h1><p>${esc(message)}</p></body></html>`;
}
