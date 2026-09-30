// Stránky zpráv: seznam s rubrikami a jedna zpráva.
import { pickAd } from "./ads.js";
import { text as tx } from "./copy.js";
import { formatDayMonth, formatLong } from "./format.js";
import { esc, mediaUrl } from "./html.js";
import { renderArticleHtml } from "./rich.js";
import { articleCrumbs, newsCount, newsCrumbs, rubricCounts, rubricKicker, rubricNav } from "./rubric-nav.js";
import { articleInRubric, findRubric, rubricLabel, rubricScope, rubricsFrom } from "./rubrics.js";
import { adPanel, contentAd, layout, signedWhen } from "./view.js";

const SCRIPT = `<script src="/site.js" defer></script>`;

function storyCard(article) {
  return `<a class="card story" href="/zpravy/${esc(article.slug)}">
            ${article.imageKey ? `<img class="cover" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
            ${rubricKicker(article)}
            <h2>${esc(article.title)}</h2>
            <p class="muted">${esc(article.excerpt)}</p>
            <p class="meta">${esc(signedWhen(article, formatDayMonth(article.createdOn)))}</p>
          </a>`;
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
  const cards = visible.map(storyCard);
  const woven = contentAd(data, ctx);
  if (woven && cards.length) cards.splice(Math.min(2, cards.length), 0, woven);
  const list = cards.length ? cards.join("") : `<p class="card dashed muted">${esc(tx(ctx.copy, "news_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${title} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "news_description"),
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

function articleMeta(article) {
  const base = signedWhen(article, formatLong(article.createdOn));
  const mark = article.redacted ? ` · <span class="redigovano">Redigováno</span>` : "";
  return `<p class="meta">${esc(base)}${mark}</p>`;
}

export function articlePage(article, ctx, extras = {}) {
  const ad = Object.hasOwn(extras, "ad") ? extras.ad : pickAd(extras.ads);
  return layout({
    ...ctx,
    title: `${article.title} | ${tx(ctx.copy, "site_name")}`,
    description: article.excerpt,
    body: `
      <a class="back" href="/zpravy">${esc(tx(ctx.copy, "article_back"))}</a>
      ${articleCrumbs(article)}
      <h1 class="article-title">${esc(article.title)}</h1>
      ${articleMeta(article)}
      ${article.imageKey ? `<img class="article-photo" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
      <div class="prose">${renderArticleHtml(article.body)}</div>
      ${ad ? `<div class="ad-slot">${adPanel(ad, ctx.copy)}</div>` : ""}`,
  });
}
