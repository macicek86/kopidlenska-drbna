// Článek od kozy Drběny z importu: rovnou na web, nebo jako návrh ke schválení.
// `source` je zdroj pod čarou (src/article-source.js: „název odkaz“, víc zdrojů čárkou).
// `publishOn` (RRRR-MM-DD) je datum ze zdroje při ručním zpracování. Prázdné znamená dnešek, u návrhu den schválení.
// `image` je { key, focus, caption } (fotka ze zdroje nebo z knihovny obrázků), nebo null.
// `article.keywords` jsou klíčová slova (src/keywords.js), `followsId` zpráva, na kterou článek navazuje.
// `attachments` jsou přílohy pod článek ([{ key, caption }], src/attachments.js).
// `publishTime` („HH:MM“) u zveřejnění rovnou: na web až v tu hodinu (src/publish-time.js), výsledek nese `publishedAt`.
// `spread` (automatika importů) zařadí zprávu do fronty zveřejnění (src/publish-queue.js): vyjde s rozestupem od ostatních
// a jen přes den, i s jiným datem. Neplatí s `publishOn` ani `publishTime` a dá se vypnout na stránce Koza Drběna.
// Spěchající zprávu (`article.urgent`) fronta pustí hned, i v noci.
// `followsProposal` je návrh, na který článek navazuje (ještě čeká); schválením se z něj stane `follows_id` (src/proposals-db.js).
// `article.recall` je akce, na kterou Drběna v článku vzpomněla; podruhé už na ni nevzpomene (src/drbena-memory.js).
import { slugify, uniqueSlug } from "./db-core.js";
import { scheduledMoment } from "./publish-time.js";
import { queuedMoment } from "./publish-queue.js";
import { loadDrbena } from "./drbena-db.js";
import { pragueNow } from "./waste.js";
import { ensureBot } from "./munipolis/store.js";
import { prepareArticleBody } from "./rich.js";
import { readSource } from "./article-source.js";
import { attachmentsJson } from "./attachments.js";
import { markRecalled } from "./drbena-memory.js";
import { auditBot } from "./audit.js";
import { notifyEditors } from "./notify.js";

const scheduledDay = (day, time) => ({ day, publishedAt: scheduledMoment(day, time) });

export async function saveBotArticle(env, { article, image, attachments = [], source = "", autoPublish, rubric, publishOn = "", publishTime = "", followsId = null, followsProposal = null, spread = false }) {
  const bot = await ensureBot(env);
  const body = prepareArticleBody(article.body).html;
  const from = readSource(source);
  const imageKey = image?.key ?? null;
  const focus = image?.focus ?? "";
  const caption = image?.caption ?? article.imageCaption ?? "";
  const keywords = article.keywords ?? "";
  const attached = attachmentsJson(attachments);
  if (article.recall) await markRecalled(env, article.recall);
  if (autoPublish) {
    const slug = await uniqueSlug(env, slugify(article.title));
    const queue = spread && !article.urgent && !publishOn && !publishTime ? (await loadDrbena(env)).spread : null;
    const { day, publishedAt } = queue?.on ? await queuedMoment(env, queue) : scheduledDay(publishOn || pragueNow().date, publishTime);
    const result = await env.DB.prepare(
      `insert into articles (slug, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, attachments, source, published, created_at, author_id, author_name, redacted,
         keywords, follows_id, follows_proposal, published_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
      .bind(slug, article.title, article.excerpt, body, rubric.name, rubric.id, imageKey, focus, caption, attached, from, day, bot.id, bot.name, keywords, followsId, followsProposal, publishedAt)
      .run();
    await auditBot(env, bot, { title: article.title, published: true }).catch(() => {});
    return { articleId: Number(result.meta.last_row_id), publishedAt };
  }
  const result = await env.DB.prepare(
    `insert into proposals (
       article_id, author_id, author_name, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, attachments, source,
       submitted_title, submitted_excerpt, submitted_body, submitted_category, status, publish_on, keywords, follows_id, follows_proposal
     ) values (null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      bot.id, bot.name, article.title, article.excerpt, body, rubric.name, rubric.id, imageKey, focus, caption, attached, from,
      article.title, article.excerpt, body, rubric.name, publishOn, keywords, followsId, followsProposal,
    )
    .run();
  await auditBot(env, bot, { title: article.title, published: false }).catch(() => {});
  const proposalId = Number(result.meta.last_row_id);
  await notifyEditors(env, "drbena", {
    subject: `Návrh od Drběny: ${article.title}`,
    intro: "Drběna napsala návrh zprávy, čeká na schválení.",
    fields: [
      ["Nadpis", article.title],
      ["Rubrika", rubric.name],
    ],
    body: article.excerpt,
    path: `/redakce/zpravy?navrh=${proposalId}`,
  });
  return { proposalId };
}
