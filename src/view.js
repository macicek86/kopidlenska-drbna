import { pickAd, safeAdLink } from "./ads.js";
import { byline } from "./db.js";
import { esc, mediaUrl } from "./html.js";
import { facebookUrl, text as tx } from "./copy.js";
import { formatLong } from "./format.js";
import { focusClass } from "./photo.js";
import { WEEK_DAYS } from "./yards.js";
import { jsonLdTag } from "./seo.js";
import { welcomeTemplate } from "./welcome.js";
import { anyFeedOn, feedOn } from "./feeds/settings.js";

// Ikony webu (koza Drběna na minci): ICO pro staré prohlížeče a Windows, PNG pro ostatní, Apple zvlášť.
export const FAVICON_TAGS = `<link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">`;

export { outageCard, outageEmpty, outagesPage } from "./outages-view.js";
export { homePage } from "./home.js";
export { eventsPage } from "./events-view.js";
export { doctorsPage, placesPage } from "./hours-view.js";
export { yardsPage } from "./yards-view.js";

// Služby jsou v menu pod jednou rozbalovací položkou, ať se menu na počítači vejde vedle loga.
const PRACTICAL = [
  ["/popelnice", "nav_bins"],
  ["/sberne-dvory", "nav_yards"],
  ["/lekari", "nav_doctors"],
  ["/oteviraci-doba", "nav_places"],
  ["/odstavky", "nav_outages"],
];
const NAV = [["/zpravy", "nav_news"], ["/akce", "nav_events"], PRACTICAL, ["/reklamy", "nav_ads"], ["/o-nas", "nav_about"]];

const OG_IMAGE = "/og.webp";
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export function siteOrigin(origin, mainOrigin) {
  const value = String(origin || mainOrigin || "").trim().replace(/\/$/, "");
  return /^https?:\/\//i.test(value) ? value : "";
}

export { esc, mediaUrl } from "./html.js";

// Feed zpráv je v hlavičce každé stránky, ať ho čtečka najde odkudkoli. Stránka může přidat svůj ([cesta, název]).
const SITE_FEED = ["/feed.xml", "Zprávy"];

function feedLinks(feeds, siteName, base, withSite) {
  const list = [...feeds, ...(withSite ? [SITE_FEED] : [])].filter(([href], index, all) => all.findIndex(([other]) => other === href) === index);
  return list
    .map(([href, label]) => `<link rel="alternate" type="application/atom+xml" title="${esc(`${siteName}: ${label}`)}" href="${esc(`${base}${href}`)}">`)
    .join("\n  ");
}

function active(path, href) {
  return path === href || path.startsWith(`${href}/`) ? " is-on" : "";
}

// canonical: cesta i s dotazem, když se liší od path (rubrika). image: absolutní adresa fotky (nebo cesta na webu) místo výchozí,
// imageSize: obrázek má rozměr výchozího. shareUrl: og:url jiná než canonical (sdílení jednoho místa, src/hours-share.js).
export function layout({
  title,
  description,
  path,
  mainOrigin,
  origin,
  body,
  script = "",
  head = "",
  copy = {},
  canonical,
  noindex = false,
  ogType = "website",
  image = "",
  imageSize = false,
  shareUrl = "",
  published = "",
  jsonLd = [],
  feeds = [],
  feedOn: switches = null,
  chat = null,
}) {
  const base = siteOrigin(origin, mainOrigin);
  const pagePath = typeof canonical === "string" && canonical.startsWith("/")
    ? canonical
    : typeof path === "string" && path.startsWith("/") ? path : "/";
  const pageUrl = base ? `${base}${pagePath}` : "";
  const ogUrl = shareUrl && base ? `${base}${shareUrl}` : pageUrl;
  const ogImage = image.startsWith("/") ? `${base}${image}` : image || `${base}${OG_IMAGE}`;
  const defaultImage = !image;
  const siteName = tx(copy, "site_name");
  const facebook = facebookUrl(copy);
  const link = ([href, key]) => `<a class="nav-link${active(path, href)}" href="${href}">${esc(tx(copy, key))}</a>`;
  const practical = esc(tx(copy, "nav_practical"));
  const practicalOn = PRACTICAL.some(([href]) => active(path, href)) ? " is-on" : "";
  const desktopLinks = NAV.map((entry) =>
    entry === PRACTICAL
      ? `<details class="nav-more" data-nav-more><summary class="nav-link${practicalOn}">${practical}</summary><div class="nav-drop">${PRACTICAL.map(link).join("")}</div></details>`
      : link(entry),
  ).join("");
  // Na mobilu jsou služby na konci pod nadpisem, ať k nim nepatří Reklamy a O nás.
  const mobileLinks = `${NAV.filter((entry) => entry !== PRACTICAL).map(link).join("")}<p class="nav-head">${practical}</p>${PRACTICAL.map(link).join("")}`;
  const welcome = welcomeTemplate(copy, Boolean(chat));
  const headerNav = `<nav class="nav" aria-label="Hlavní">${desktopLinks}</nav>
       <details class="mobile-nav">
         <summary>${esc(tx(copy, "menu_label"))}</summary>
         <nav aria-label="Mobilní">${mobileLinks}</nav>
       </details>`;
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="seznam-wmt" content="pJGT9IZUMjhOPot4mtesZ4d4GAY6J35X">
  ${noindex ? `<meta name="robots" content="noindex">` : ""}
  ${pageUrl && !noindex ? `<link rel="canonical" href="${esc(pageUrl)}">` : ""}
  <meta property="og:type" content="${esc(ogType)}">
  <meta property="og:locale" content="cs_CZ">
  <meta property="og:site_name" content="${esc(siteName)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${ogUrl ? `<meta property="og:url" content="${esc(ogUrl)}">` : ""}
  <meta property="og:image" content="${esc(ogImage)}">
  ${
    defaultImage || imageSize
      ? `<meta property="og:image:type" content="image/webp">
  <meta property="og:image:width" content="${OG_WIDTH}">
  <meta property="og:image:height" content="${OG_HEIGHT}">
  <meta property="og:image:alt" content="${esc(defaultImage ? siteName : title)}">`
      : ""
  }
  ${published ? `<meta property="article:published_time" content="${esc(published)}">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(ogImage)}">
  ${jsonLdTag(jsonLd)}
  ${feedLinks(feeds.filter(([href]) => feedOn(switches, href)), siteName, base, feedOn(switches, SITE_FEED[0]))}
  ${FAVICON_TAGS}
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#fffaf5">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
  ${chat ? `<link rel="stylesheet" href="/chat.css">` : ""}
  ${head}
</head>
<body>
  <div class="wrap">
    <a class="skip" href="#obsah">${esc(tx(copy, "skip"))}</a>
    <header class="top">
      <a class="brand" href="/">
        <img src="/kozel-maskot.webp" alt="">
        <span>${esc(tx(copy, "brand_line"))}<span>${esc(tx(copy, "brand_accent"))}</span></span>
      </a>
      ${headerNav}
    </header>
    <main id="obsah">${body}</main>
    <footer>
      <p>${esc(tx(copy, "footer_copy"))}</p>
      ${facebook ? `<p><a href="${esc(facebook)}" rel="noopener">${esc(tx(copy, "footer_facebook"))}</a></p>` : ""}
      ${anyFeedOn(switches) ? `<p><a href="/odber">${esc(tx(copy, "footer_feeds"))}</a></p>` : ""}
      <p class="fine">${esc(tx(copy, "footer_fine"))}</p>
      <a href="/redakce">${esc(tx(copy, "footer_admin"))}</a>
    </footer>
  </div>
  ${script}
  <script src="/nav.js" defer></script>
  ${welcome ? `${welcome}<script src="/welcome.js" defer></script>` : ""}
  ${chat ? `<div class="chat" data-chat data-sitekey="${esc(chat.siteKey)}" data-ideas="${esc(JSON.stringify(chat.ideas ?? []))}"${facebook ? ` data-facebook="${esc(facebook)}"` : ""}></div><script src="/chat.js" defer></script>` : ""}
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

export function contentAd(data, ctx) {
  const ad = Object.hasOwn(data, "ad") ? data.ad : pickAd(data.ads);
  return ad ? adPanel(ad, ctx.copy) : "";
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
  const more = adLinkHtml(link, tx(copy, "ads_more"), preview);
  // Na panelu se fotka ořízne podle bodu výřezu, na stránce jedné nabídky je vidět celá.
  const photoClass = ["ad-photo", heading === "h1" ? "" : focusClass(ad.imageFocus)].filter(Boolean).join(" ");
  const photo = ad.imageKey
    ? `<img class="${photoClass}"${preview ? ` data-ad="photo" data-photo-crop` : ""} src="${mediaUrl(ad.imageKey)}" alt="">`
    : preview
      ? `<img class="ad-photo" data-ad="photo" data-photo-crop alt="" hidden>`
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
      ${askLine(ctx, "ads", "Chci tu mít reklamu: ")}
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
    noindex: true,
    title: `${tx(ctx.copy, "ads_missing")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "ads_missing"),
    body: `<h1>${esc(tx(ctx.copy, "ads_missing"))}</h1><a class="back" href="/reklamy">${esc(tx(ctx.copy, "ads_back"))}</a>`,
  });
}

export function clockOf(data) {
  return data.now ?? { date: data.waste.today, time: "12:00" };
}

export function dayLabel(day) {
  return WEEK_DAYS.find((item) => item.day === day)?.label ?? "";
}

// Řádek pod úvodem: s chatem otevře Drběnu s předvyplněnou větou, bez něj vede na kontakt.
export function askLine(ctx, prefix, prefill) {
  return `<p class="place-ask">${esc(tx(ctx.copy, `${prefix}_ask`))} ${
    ctx.chat
      ? `<a href="/o-nas" data-chat-open="${esc(prefill)}">${esc(tx(ctx.copy, `${prefix}_ask_chat`))}</a>`
      : `<a href="/o-nas">${esc(tx(ctx.copy, `${prefix}_ask_mail`))}</a>`
  }</p>`;
}

export function brokenPage(message) {
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Kopidlenská drbna</title>
  <body style="font-family:sans-serif;padding:2rem"><h1>Stránka se teď nenačte</h1><p>${esc(message)}</p></body></html>`;
}
