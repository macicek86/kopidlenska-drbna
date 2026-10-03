// Pro vyhledávače: robots.txt, sitemap.xml a strukturovaná data (JSON-LD).
import { byline } from "./db.js";
import { text as tx } from "./copy.js";
import { esc, mediaUrl } from "./html.js";
import { rubricHref } from "./rubric-nav.js";

const LOGO = "/kozel-maskot.webp";

// Stránky webu, které mají být ve vyhledávači. Popelnicová subdoména má jen titulku.
const PAGES = ["/", "/zpravy", "/akce", "/reklamy", "/popelnice", "/sberne-dvory", "/lekari", "/oteviraci-doba", "/odstavky", "/o-nas"];

export function robotsTxt(origin) {
  return `User-agent: *
Allow: /
Disallow: /redakce
Disallow: /cdn-cgi/

Sitemap: ${origin}/sitemap.xml
`;
}

function urlEntry(loc, lastmod) {
  return `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ""}</url>`;
}

export function sitemapXml(origin, data, { minimal = false } = {}) {
  const newest = data.articles[0]?.createdOn ?? "";
  const entries = minimal
    ? [urlEntry(`${origin}/`)]
    : [
        ...PAGES.map((path) => urlEntry(`${origin}${path}`, path === "/" || path === "/zpravy" ? newest : "")),
        ...data.rubrics.map((rubric) => urlEntry(`${origin}${rubricHref(rubric.slug)}`)),
        ...data.articles.map((article) => urlEntry(`${origin}/zpravy/${encodeURIComponent(article.slug)}`, article.createdOn)),
        ...data.ads.map((ad) => urlEntry(`${origin}/reklamy/${encodeURIComponent(ad.slug)}`, ad.createdOn)),
      ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
}

// JSON-LD je jen data, ne skript, takže ho CSP nehlídá. „<“ se escapuje, ať text nemůže uzavřít značku.
export function jsonLdTag(items) {
  const list = (Array.isArray(items) ? items : [items]).filter(Boolean);
  if (!list.length) return "";
  const data = list.length === 1 ? list[0] : { "@context": "https://schema.org", "@graph": list.map(stripContext) };
  const text = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${text}</script>`;
}

function stripContext(item) {
  const { "@context": _context, ...rest } = item;
  return rest;
}

function absolute(base, path) {
  return base ? `${base}${path}` : path;
}

function publisher(base, copy) {
  return {
    "@type": "NewsMediaOrganization",
    "@id": absolute(base, "/#drbna"),
    name: tx(copy, "site_name"),
    url: absolute(base, "/"),
    logo: { "@type": "ImageObject", url: absolute(base, LOGO) },
    areaServed: { "@type": "City", name: "Kopidlno" },
  };
}

export function siteLd(base, copy) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": absolute(base, "/#web"),
      name: tx(copy, "site_name"),
      url: absolute(base, "/"),
      inLanguage: "cs",
      description: tx(copy, "home_description"),
      publisher: { "@id": absolute(base, "/#drbna") },
    },
    { "@context": "https://schema.org", ...publisher(base, copy) },
  ];
}

export function articleImage(base, article) {
  return article.imageKey ? absolute(base, mediaUrl(article.imageKey)) : "";
}

export function articleLd(base, article, copy) {
  const url = absolute(base, `/zpravy/${encodeURIComponent(article.slug)}`);
  const name = byline(article);
  const image = articleImage(base, article);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title.slice(0, 110),
    description: article.excerpt,
    url,
    mainEntityOfPage: url,
    inLanguage: "cs",
    datePublished: article.createdOn,
    dateModified: article.createdOn,
    ...(article.category ? { articleSection: article.category } : {}),
    ...(image ? { image: [image] } : {}),
    author: name ? { "@type": "Person", name } : { "@id": absolute(base, "/#drbna") },
    publisher: publisher(base, copy),
  };
}

// Drobečková navigace: [název, cesta] od nejvyšší úrovně, poslední položka je stránka sama.
export function breadcrumbLd(base, items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, path], index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: absolute(base, path),
    })),
  };
}

export function articleCrumbsLd(base, article, copy) {
  const items = [[tx(copy, "news_heading"), "/zpravy"]];
  if (article.parentName && article.parentSlug) items.push([article.parentName, rubricHref(article.parentSlug)]);
  if (article.category && article.rubricSlug) items.push([article.category, rubricHref(article.rubricSlug)]);
  items.push([article.title, `/zpravy/${encodeURIComponent(article.slug)}`]);
  return breadcrumbLd(base, items);
}

// Posun Prahy proti UTC v daný den („+02:00“ v létě, „+01:00“ v zimě).
export function pragueOffset(isoDate) {
  try {
    const date = new Date(`${isoDate}T12:00:00Z`);
    const part = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Prague", timeZoneName: "longOffset" })
      .formatToParts(date)
      .find((item) => item.type === "timeZoneName")?.value;
    const match = /GMT([+-]\d{2}:\d{2})/.exec(part ?? "");
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function eventStart(event) {
  const time = /^\d{1,2}:\d{2}$/.test(event.startsTime) ? event.startsTime.padStart(5, "0") : "";
  if (!time) return event.startsOn;
  return `${event.startsOn}T${time}${pragueOffset(event.startsOn)}`;
}

export function eventLd(base, event) {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    startDate: eventStart(event),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(event.description ? { description: event.description } : {}),
    location: {
      "@type": "Place",
      name: event.place || "Kopidlno",
      address: { "@type": "PostalAddress", addressLocality: "Kopidlno", addressRegion: "Královéhradecký kraj", addressCountry: "CZ" },
    },
    url: absolute(base, event.articleSlug ? `/zpravy/${event.articleSlug}` : "/akce"),
  };
}
