// Feed zpráv (/feed.xml, rubrika /feed.xml?rubrika=slug): celý text jako na webu, fotka, přílohy a rubrika.
// Text je přesně ten, který je na drbně, takže platí stejné podmínky zdrojů (Deník, NDIC) jako na webu.
import { text as tx } from "../copy.js";
import { byline } from "../db.js";
import { esc, mediaUrl } from "../html.js";
import { captionHtml, readCaption } from "../photo.js";
import { renderArticleHtml } from "../rich.js";
import { footLines } from "../article-source.js";
import { rubricHref } from "../rubric-nav.js";
import { rubricLabel, rubricScope } from "../rubrics.js";
import { TAG, absoluteHtml, atomFeed } from "./atom.js";

export const NEWS_LIMIT = 30;

function articleUrl(base, article) {
  return `${base}/zpravy/${encodeURIComponent(article.slug)}`;
}

function articleContent(base, article) {
  const caption = readCaption(article.imageCaption);
  const photo = article.imageKey
    ? `<figure><img src="${base}${mediaUrl(article.imageKey)}" alt="${esc(caption)}">${caption ? `<figcaption>${captionHtml(caption)}</figcaption>` : ""}</figure>`
    : "";
  const attachments = (article.attachments ?? []).length
    ? `<h2>Přílohy</h2>${article.attachments
        .map(
          (item) =>
            `<p><a href="${base}${mediaUrl(item.key)}"><img src="${base}${mediaUrl(item.key)}" alt="${esc(item.caption)}"></a>${item.caption ? `<br>${esc(item.caption)}` : ""}</p>`,
        )
        .join("")}`
    : "";
  // Navazující zpráva a zdroj jsou na webu pod čarou, ve feedu na konci textu.
  const foot = footLines(article).map((line) => `<p><em>${line}</em></p>`).join("");
  return `${photo}${absoluteHtml(`${renderArticleHtml(article.body)}${foot}`, base)}${attachments}`;
}

export function articleEntry(base, article) {
  const categories = [];
  if (article.parentName && article.parentSlug) categories.push({ term: article.parentSlug, label: article.parentName });
  if (article.category) categories.push({ term: article.rubricSlug || article.category, label: article.category });
  return {
    id: `${TAG}zprava-${article.id}`,
    seq: article.id,
    title: article.title,
    url: articleUrl(base, article),
    // Starší zprávy znají jen den (atomFeed je v rámci dne rozliší po sekundách).
    updated: article.publishedAt || article.createdOn,
    published: article.publishedAt || article.createdOn,
    authors: [byline(article)],
    categories,
    image: article.imageKey ? `${base}${mediaUrl(article.imageKey)}` : "",
    summary: article.excerpt,
    content: articleContent(base, article),
  };
}

// rubric: vybraná rubrika (nebo null), rubrics: všechny (kvůli nadřazené v názvu feedu).
export function newsFeed(base, articles, copy, { rubric = null, rubrics = [] } = {}) {
  const site = tx(copy, "site_name");
  const scope = rubricScope(rubrics, rubric);
  const label = rubric ? rubricLabel({ category: rubric.name, parentName: rubric.parentId ? scope?.name : "" }) : "";
  const query = rubric ? `?rubrika=${encodeURIComponent(rubric.slug)}` : "";
  return atomFeed({
    id: `${TAG}zpravy${rubric ? `:${rubric.slug}` : ""}`,
    title: rubric ? `${site}: ${label}` : site,
    subtitle: tx(copy, "news_description"),
    self: `${base}/feed.xml${query}`,
    alternate: `${base}${rubric ? rubricHref(rubric.slug) : "/zpravy"}`,
    author: site,
    icon: `${base}/icon-192.png`,
    logo: `${base}/og.webp`,
    entries: articles.map((article) => articleEntry(base, article)),
  });
}
