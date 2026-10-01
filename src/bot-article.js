// Článek od kozy Drběny z importu: rovnou na web, nebo jako návrh ke schválení. Na konec přidá odstavec se zdrojem.
import { slugify, uniqueSlug } from "./db-core.js";
import { ensureBot } from "./munipolis/store.js";
import { prepareArticleBody } from "./rich.js";

export async function saveBotArticle(env, { article, imageKey, sourceHtml, autoPublish, rubric }) {
  const bot = await ensureBot(env);
  const body = prepareArticleBody(`${article.body}${sourceHtml}`).html;
  const caption = article.imageCaption ?? "";
  if (autoPublish) {
    const slug = await uniqueSlug(env, slugify(article.title));
    const result = await env.DB.prepare(
      `insert into articles (slug, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, published, created_at, author_id, author_name, redacted)
       values (?, ?, ?, ?, ?, ?, ?, '', ?, 1, date('now'), ?, ?, 0)`,
    )
      .bind(slug, article.title, article.excerpt, body, rubric.name, rubric.id, imageKey, caption, bot.id, bot.name)
      .run();
    return { articleId: Number(result.meta.last_row_id) };
  }
  const result = await env.DB.prepare(
    `insert into proposals (
       article_id, author_id, author_name, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption,
       submitted_title, submitted_excerpt, submitted_body, submitted_category, status
     ) values (null, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(bot.id, bot.name, article.title, article.excerpt, body, rubric.name, rubric.id, imageKey, caption, article.title, article.excerpt, body, rubric.name)
    .run();
  return { proposalId: Number(result.meta.last_row_id) };
}
