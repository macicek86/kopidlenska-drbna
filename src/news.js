// Stránky zpráv: seznam s rubrikami a jedna zpráva.
import { pageAds, weaveAds } from "./ad-weave.js";
import { pickAd } from "./ads.js";
import { facebookUrl, text as tx } from "./copy.js";
import { formatDayMonth, formatLong } from "./format.js";
import { esc } from "./html.js";
import { attachmentsSection } from "./attachments.js";
import { articleFoot } from "./article-source.js";
import { articleFigure, storyPhoto } from "./photo.js";
import { renderArticleHtml } from "./rich.js";
import { articleCrumbs, newsCount, rubricHref, newsCrumbs, rubricCounts, rubricKicker, rubricNav } from "./rubric-nav.js";
import { articleInRubric, findRubric, rubricLabel, rubricScope, rubricsFrom } from "./rubrics.js";
import { articleCrumbsLd, articleImage, articleLd, articlePublished } from "./seo.js";
import { escTie, tieHtml } from "./typo.js";
import { adPanel, layout, signedWhen, siteOrigin } from "./view.js";
import { readCount } from "./visits.js";

const SCRIPT = `<script src="/site.js" defer></script>`;

// Odkud čtenář na zprávu přišel (první část adresy) a text odkazu zpět. Ostatní stránky drbny
// (i jiná zpráva) dostanou „Zpět“ (klíč ""). Vybírá public/nav.js podle document.referrer.
const BACK_FROM = [
  ["/", "article_back_home"],
  ["/akce", "article_back_events"],
  ["/oteviraci-doba", "article_back_places"],
  ["/lekari", "article_back_doctors"],
  ["/sberne-dvory", "article_back_yards"],
  ["/popelnice", "article_back_bins"],
  ["/odstavky", "article_back_outages"],
  ["/reklamy", "article_back_ads"],
  ["/o-nas", "article_back_about"],
  ["", "article_back_here"],
];

// Bez JS a zvenku vede odkaz na výpis zpráv; „Všechny zprávy“ ukáže skript, když odkaz vede jinam.
function articleBack(copy) {
  const labels = JSON.stringify(Object.fromEntries(BACK_FROM.map(([path, key]) => [path, tx(copy, key)])));
  return `<div class="article-back">
            <a class="back" href="/zpravy" data-back="${esc(labels)}">${esc(tx(copy, "article_back"))}</a>
            <a class="back-all" href="/zpravy" data-back-all hidden>${esc(tx(copy, "article_back_all"))}</a>
          </div>`;
}

function storyCard(article) {
  return `<a class="card story${article.imageKey ? " has-photo" : ""}" href="/zpravy/${esc(article.slug)}">
            ${storyPhoto(article, "story-photo")}
            <div class="story-text">
              ${rubricKicker(article)}
              <h2>${escTie(article.title)}</h2>
              <p class="muted">${escTie(article.excerpt)}</p>
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
    feeds: selected ? [[`/feed.xml?rubrika=${encodeURIComponent(selected.slug)}`, title]] : [],
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

// Nenápadná pozvánka do skupiny na Facebooku, drbna sama komentáře nemá. Poslední řádek patičky pod čarou.
function facebookInvite(copy) {
  const url = facebookUrl(copy);
  if (!url) return "";
  return `${esc(tx(copy, "article_facebook"))} <a class="article-facebook" href="${esc(url)}" rel="noopener">${esc(tx(copy, "article_facebook_link"))}</a>`;
}

// Další zprávy v bočním sloupci: rubrika, nadpis a den, bez fotek.
function moreNews(articles, copy) {
  if (!articles?.length) return "";
  const items = articles
    .map(
      (item) => `<li><a href="/zpravy/${esc(item.slug)}">
              ${rubricKicker(item)}
              <span class="more-title">${escTie(item.title)}</span>
              <span class="more-date">${esc(formatDayMonth(item.createdOn))}</span>
            </a></li>`,
    )
    .join("");
  return `<section class="more-news">
          <h2>${esc(tx(copy, "article_more"))}</h2>
          <ul class="plain">${items}</ul>
        </section>`;
}

export function articlePage(article, ctx, extras = {}) {
  const ad = Object.hasOwn(extras, "ad") ? extras.ad : pickAd(extras.ads);
  const base = siteOrigin(ctx.origin, ctx.mainOrigin);
  const side = [ad ? `<div class="ad-slot">${adPanel(ad, ctx.copy)}</div>` : "", moreNews(extras.more, ctx.copy)].join("");
  return layout({
    ...ctx,
    title: `${article.title} | ${tx(ctx.copy, "site_name")}`,
    description: article.excerpt,
    ogType: "article",
    image: articleImage(base, article),
    published: articlePublished(article),
    jsonLd: [articleLd(base, article, ctx.copy), articleCrumbsLd(base, article, ctx.copy)],
    script: [
      article.imageKey ? `<script src="/article.js" defer></script>` : "",
      article.attachments?.length ? `<script src="/attachments.js" defer></script>` : "",
    ].join(""),
    body: `
      <div class="article-page">
        <div class="article-main">
          ${articleBack(ctx.copy)}
          ${articleCrumbs(article)}
          <h1 class="article-title">${escTie(article.title)}</h1>
          ${articleMeta(article, extras.views)}
          <div class="article-body${article.imageKey ? " has-photo" : ""}">
            ${articleFigure(article)}
            <div class="prose">${tieHtml(renderArticleHtml(article.body))}</div>
          </div>
          ${attachmentsSection(article)}
          ${articleFoot(article, [facebookInvite(ctx.copy)])}
        </div>
        ${side ? `<aside class="article-side">${side}</aside>` : ""}
      </div>`,
  });
}
