// Stránky zpráv: seznam s rubrikami a jedna zpráva.
import { pageAds, weaveAds } from "./ad-weave.js";
import { pickAd } from "./ads.js";
import { facebookUrl, text as tx } from "./copy.js";
import { formatDayMonth, formatLong } from "./format.js";
import { esc } from "./html.js";
import { articleFigure, storyPhoto } from "./photo.js";
import { renderArticleHtml } from "./rich.js";
import { articleCrumbs, newsCount, rubricHref, newsCrumbs, rubricCounts, rubricKicker, rubricNav } from "./rubric-nav.js";
import { articleInRubric, findRubric, rubricLabel, rubricScope, rubricsFrom } from "./rubrics.js";
import { articleCrumbsLd, articleImage, articleLd } from "./seo.js";
import { adPanel, layout, signedWhen, siteOrigin } from "./view.js";
import { readCount } from "./visits.js";

const SCRIPT = `<script src="/site.js" defer></script>`;

function storyCard(article) {
  return `<a class="card story${article.imageKey ? " has-photo" : ""}" href="/zpravy/${esc(article.slug)}">
            ${storyPhoto(article, "story-photo")}
            <div class="story-text">
              ${rubricKicker(article)}
              <h2>${esc(article.title)}</h2>
              <p class="muted">${esc(article.excerpt)}</p>
              <p class="meta">${esc(signedWhen(article, formatDayMonth(article.createdOn)))}</p>
            </div>
          </a>`;
}

// První reklama po dvou zprávách, další vždy po šesti.
const AD_SPACING = { first: 2, every: 6 };

function newsCards(cards, data, ctx) {
  const queue = pageAds(data);
  const out = weaveAds(cards, queue, ctx.copy, AD_SPACING);
  // Krátký seznam: aspoň jedna reklama na konci.
  if (cards.length && cards.length <= AD_SPACING.first && queue.length) out.push(adPanel(queue.shift(), ctx.copy));
  return out;
}

export function newsPage(data, ctx, rubrika) {
  const rubrics = rubricsFrom(data);
  const selected = findRubric(rubrics, rubrika);
  const visible = data.articles.filter((article) => articleInRubric(article, selected, rubrics));
  const counts = rubricCounts(rubrics, data.articles);
  const scope = rubricScope(rubrics, selected);
  const heading = selected ? selected.name : tx(ctx.copy, "news_heading");
  const title = selected
    ? rubricLabel({ category: selected.name, parentName: selected.parentId ? scope?.name : "" })
    : heading;
  const cards = newsCards(visible.map(storyCard), data, ctx);
  const list = cards.length ? cards.join("") : `<p class="card dashed muted">${esc(tx(ctx.copy, "news_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${title} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "news_description"),
    canonical: selected ? rubricHref(selected.slug) : "/zpravy",
    script: SCRIPT,
    body: `<header class="news-head">
        ${newsCrumbs(rubrics, selected, ctx.copy)}
        <h1>${esc(heading)}</h1>
        <p class="news-count">${esc(newsCount(visible.length))}</p>
      </header>
      ${rubricNav(rubrics, selected, counts, ctx.copy)}
      <div class="stack news-list">${list}</div>`,
  });
}

function articleMeta(article, views) {
  const base = signedWhen(article, formatLong(article.createdOn));
  const mark = article.redacted ? ` · <span class="redigovano">Redigováno</span>` : "";
  const read = readCount(views);
  return `<p class="meta">${esc(base)}${mark}${read ? ` · <span class="precteno">${esc(read)}</span>` : ""}</p>`;
}

// Nenápadná pozvánka do skupiny na Facebooku, drbna sama komentáře nemá.
function facebookInvite(copy) {
  const url = facebookUrl(copy);
  if (!url) return "";
  return `<p class="article-facebook">${esc(tx(copy, "article_facebook"))} <a href="${esc(url)}" rel="noopener">${esc(tx(copy, "article_facebook_link"))}</a></p>`;
}

export function articlePage(article, ctx, extras = {}) {
  const ad = Object.hasOwn(extras, "ad") ? extras.ad : pickAd(extras.ads);
  const base = siteOrigin(ctx.origin, ctx.mainOrigin);
  return layout({
    ...ctx,
    title: `${article.title} | ${tx(ctx.copy, "site_name")}`,
    description: article.excerpt,
    ogType: "article",
    image: articleImage(base, article),
    published: article.createdOn,
    jsonLd: [articleLd(base, article, ctx.copy), articleCrumbsLd(base, article, ctx.copy)],
    body: `
      <a class="back" href="/zpravy">${esc(tx(ctx.copy, "article_back"))}</a>
      ${articleCrumbs(article)}
      <h1 class="article-title">${esc(article.title)}</h1>
      ${articleMeta(article, extras.views)}
      <div class="article-body${article.imageKey ? " has-photo" : ""}">
        ${articleFigure(article)}
        <div class="prose">${renderArticleHtml(article.body)}</div>
      </div>
      ${facebookInvite(ctx.copy)}
      ${ad ? `<div class="ad-slot">${adPanel(ad, ctx.copy)}</div>` : ""}`,
  });
}
