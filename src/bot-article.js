// Článek od kozy Drběny z importu: rovnou na web, nebo jako návrh ke schválení. Na konec přidá odstavec se zdrojem.
// `publishOn` (RRRR-MM-DD) je datum ze zdroje při ručním zpracování. Prázdné znamená dnešek, u návrhu den schválení.
// `image` je { key, focus, caption } (fotka ze zdroje nebo z knihovny obrázků), nebo null.
// `article.keywords` jsou klíčová slova (src/keywords.js), `followsId` zpráva, na kterou článek navazuje.
// `attachments` jsou přílohy pod článek ([{ key, caption }], src/attachments.js).
// `article.recall` je akce, na kterou Drběna v článku vzpomněla; podruhé už na ni nevzpomene (src/drbena-memory.js).
import { slugify, uniqueSlug } from "./db-core.js";
import { ensureBot } from "./munipolis/store.js";
import { prepareArticleBody } from "./rich.js";
import { attachmentsJson } from "./attachments.js";
import { markRecalled } from "./drbena-memory.js";

export async function saveBotArticle(env, { article, image, attachments = [], sourceHtml, autoPublish, rubric, publishOn = "", followsId = null }) {
  const bot = await ensureBot(env);
  const body = prepareArticleBody(`${article.body}${sourceHtml}`).html;
  const imageKey = image?.key ?? null;
  const focus = image?.focus ?? "";
  const caption = image?.caption ?? article.imageCaption ?? "";
  const keywords = article.keywords ?? "";
  const attached = attachmentsJson(attachments);
  if (article.recall) await markRecalled(env, article.recall);
  if (autoPublish) {
    const slug = await uniqueSlug(env, slugify(article.title));
    const result = await env.DB.prepare(
      `insert into articles (slug, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, attachments, published, created_at, author_id, author_name, redacted,
         keywords, follows_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, coalesce(nullif(?, ''), date('now')), ?, ?, 0, ?, ?)`,
    )
      .bind(slug, article.title, article.excerpt, body, rubric.name, rubric.id, imageKey, focus, caption, attached, publishOn, bot.id, bot.name, keywords, followsId)
      .run();
    return { articleId: Number(result.meta.last_row_id) };
  }
  const result = await env.DB.prepare(
    `insert into proposals (
       article_id, author_id, author_name, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, attachments,
       submitted_title, submitted_excerpt, submitted_body, submitted_category, status, publish_on, keywords, follows_id
     ) values (null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  )
    .bind(
      bot.id, bot.name, article.title, article.excerpt, body, rubric.name, rubric.id, imageKey, focus, caption, attached,
      article.title, article.excerpt, body, rubric.name, publishOn, keywords, followsId,
    )
    .run();
  return { proposalId: Number(result.meta.last_row_id) };
}
