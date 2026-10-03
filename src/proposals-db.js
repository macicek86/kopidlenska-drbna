// Návrhy zpráv: příspěvky přispěvatelů a kozy Drběny, které čekají na hlavního redaktora.
// Návrhy od Drběny smí schválit i přispěvatel s oprávněním `drbena_navrhy`.
import { asBool, clip, IMPORT_ITEM_TABLES, reopenImports, requireChief, requireUser, slugify, uniqueSlug, userCan } from "./db-core.js";
import { readArticle, redactedFlag, textWasEdited } from "./db.js";
import { forgetProposal, linkEventsToArticle } from "./events-db.js";
import { releaseImage } from "./images.js";
import { BOT_LOGIN } from "./munipolis/store.js";
import { formImage } from "./stock-db.js";

export async function saveProposal(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.user.role !== "prispevovatel") return { ok: false, error: "Hlavní redaktor ukládá zprávy přímo." };
  const parsed = await readArticle(env, input);
  if (parsed.error) return { ok: false, error: parsed.error };

  let existing = null;
  if (input.id) {
    existing = await env.DB.prepare(
      "select id, author_id, article_id, image_key, status from proposals where id = ?",
    )
      .bind(input.id)
      .first();
    if (!existing || Number(existing.author_id) !== gate.user.id) return { ok: false, error: "Cizí návrh nejde měnit." };
    if (existing.status === "approved") {
      return { ok: false, error: "Schválený návrh už je zpráva. Novou úpravu navrhnete z ní." };
    }
  }

  let articleId = existing?.article_id ? Number(existing.article_id) : null;
  if (!existing && input.articleId) {
    const article = await env.DB.prepare("select id, published from articles where id = ?").bind(input.articleId).first();
    if (!article || !asBool(article.published)) return { ok: false, error: "Tahle zpráva se nedá navrhnout k úpravě." };
    articleId = Number(article.id);
    existing = await env.DB.prepare(
      `select id, author_id, article_id, image_key, status from proposals
       where article_id = ? and author_id = ? and status in ('pending', 'rejected')
       order by id desc`,
    )
      .bind(articleId, gate.user.id)
      .first();
  }

  const stored = await formImage(env, input);
  if (stored.error) return { ok: false, error: stored.error };
  Object.assign(parsed, stored.photo);

  if (existing) {
    let imageKey = existing.image_key ? String(existing.image_key) : null;
    const previous = imageKey;
    if (stored.key) imageKey = stored.key;
    await env.DB.prepare(
      `update proposals
       set title = ?, excerpt = ?, body = ?, category = ?, rubric_id = ?, image_key = ?, image_focus = ?, image_caption = ?,
           submitted_title = ?, submitted_excerpt = ?, submitted_body = ?, submitted_category = ?,
           author_name = ?, status = 'pending', note = ''
       where id = ?`,
    )
      .bind(
        parsed.title,
        parsed.excerpt,
        parsed.body,
        parsed.category,
        parsed.rubricId,
        imageKey,
        parsed.imageFocus,
        parsed.imageCaption,
        parsed.title,
        parsed.excerpt,
        parsed.body,
        parsed.category,
        gate.user.name,
        existing.id,
      )
      .run();
    if (stored.key && previous && previous !== stored.key) await releaseImage(env, previous);
    return { ok: true, updated: true };
  }

  await env.DB.prepare(
    `insert into proposals (
       article_id, author_id, author_name, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption,
       submitted_title, submitted_excerpt, submitted_body, submitted_category, status
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(
      articleId,
      gate.user.id,
      gate.user.name,
      parsed.title,
      parsed.excerpt,
      parsed.body,
      parsed.category,
      parsed.rubricId,
      stored.key,
      parsed.imageFocus,
      parsed.imageCaption,
      parsed.title,
      parsed.excerpt,
      parsed.body,
      parsed.category,
    )
    .run();
  return { ok: true, updated: false };
}

export async function withdrawProposal(env, request, id) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await env.DB.prepare("select id, author_id, image_key, status from proposals where id = ?")
    .bind(id)
    .first();
  if (!row || Number(row.author_id) !== gate.user.id) return { ok: false, error: "Cizí návrh nejde stáhnout." };
  if (row.status === "approved") return { ok: false, error: "Schválený návrh už je zpráva." };
  await env.DB.prepare("delete from proposals where id = ?").bind(id).run();
  await forgetProposal(env, id);
  await releaseImage(env, row.image_key ? String(row.image_key) : null);
  return { ok: true };
}

// Import, ze kterého návrh vznikl, si zapamatuje i hotovou zprávu (chat pak u ní najde původní text).
async function linkImports(env, proposalId, articleId) {
  if (!articleId) return;
  for (const table of IMPORT_ITEM_TABLES) {
    await env.DB.prepare(`update ${table} set article_id = ? where proposal_id = ? and article_id is null`).bind(articleId, proposalId).run();
  }
}

function canApprove(user, proposal) {
  if (user.role === "hlavni") return true;
  return String(proposal.author_login ?? "") === BOT_LOGIN && userCan(user, "drbena_navrhy");
}

export async function approveProposal(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.id) return { ok: false, error: "Ten návrh už tu není." };
  const proposal = await env.DB.prepare(
    `select p.id, p.article_id, p.author_id, p.author_name, p.image_key, p.submitted_title, p.submitted_excerpt,
            p.submitted_body, p.submitted_category, p.status, p.publish_on, u.login as author_login
     from proposals p left join users u on u.id = p.author_id where p.id = ?`,
  )
    .bind(input.id)
    .first();
  if (!proposal || proposal.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  if (!canApprove(gate.user, proposal)) return { ok: false, error: "Tohle schvaluje jen hlavní redaktor." };
  const parsed = await readArticle(env, input);
  if (parsed.error) return { ok: false, error: parsed.error };

  let article = null;
  if (proposal.article_id) {
    article = await env.DB.prepare("select id, image_key, redacted from articles where id = ?")
      .bind(proposal.article_id)
      .first();
    if (!article) return { ok: false, error: "Tahle zpráva už tu není." };
  }

  const stored = await formImage(env, input);
  if (stored.error) return { ok: false, error: stored.error };
  Object.assign(parsed, stored.photo);

  const submitted = {
    title: String(proposal.submitted_title),
    excerpt: String(proposal.submitted_excerpt),
    body: String(proposal.submitted_body),
    category: String(proposal.submitted_category),
  };
  const finalText = {
    title: parsed.title,
    excerpt: parsed.excerpt,
    body: parsed.body,
    category: parsed.category,
  };
  let imageKey = proposal.image_key ? String(proposal.image_key) : null;
  const previousProposalImage = imageKey;
  if (stored.key) imageKey = stored.key;

  if (article) {
    let nextImage = article.image_key ? String(article.image_key) : null;
    const previousArticleImage = nextImage;
    if (imageKey) nextImage = imageKey;
    const redacted = redactedFlag(article.redacted, submitted, finalText) ? 1 : 0;
    await env.DB.prepare(
      `update articles set title = ?, excerpt = ?, body = ?, category = ?, rubric_id = ?, image_key = ?,
         image_focus = ?, image_caption = ?, published = 1, redacted = ? where id = ?`,
    )
      .bind(
        parsed.title,
        parsed.excerpt,
        parsed.body,
        parsed.category,
        parsed.rubricId,
        nextImage,
        parsed.imageFocus,
        parsed.imageCaption,
        redacted,
        article.id,
      )
      .run();
    if (previousArticleImage && previousArticleImage !== nextImage) await releaseImage(env, previousArticleImage);
  } else {
    const slug = await uniqueSlug(env, slugify(parsed.title));
    const inserted = await env.DB.prepare(
      `insert into articles (slug, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, published, created_at, author_id, author_name, redacted)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, coalesce(nullif(?, ''), date('now')), ?, ?, ?)`,
    )
      .bind(
        slug,
        parsed.title,
        parsed.excerpt,
        parsed.body,
        parsed.category,
        parsed.rubricId,
        imageKey,
        parsed.imageFocus,
        parsed.imageCaption,
        String(proposal.publish_on ?? ""),
        proposal.author_id,
        proposal.author_name,
        textWasEdited(submitted, finalText) ? 1 : 0,
      )
      .run();
    await linkImports(env, proposal.id, Number(inserted.meta?.last_row_id));
    await linkEventsToArticle(env, proposal.id, Number(inserted.meta?.last_row_id));
  }

  await env.DB.prepare(
    `update proposals set title = ?, excerpt = ?, body = ?, category = ?, rubric_id = ?, image_key = ?,
       image_focus = ?, image_caption = ?, status = 'approved', note = '' where id = ?`,
  )
    .bind(
      parsed.title,
      parsed.excerpt,
      parsed.body,
      parsed.category,
      parsed.rubricId,
      imageKey,
      parsed.imageFocus,
      parsed.imageCaption,
      proposal.id,
    )
    .run();
  if (stored.key && previousProposalImage && previousProposalImage !== stored.key) {
    await releaseImage(env, previousProposalImage);
  }
  return { ok: true };
}

export async function rejectProposal(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await env.DB.prepare("select id, status from proposals where id = ?").bind(input.id).first();
  if (!row || row.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  await env.DB.prepare("update proposals set status = 'rejected', note = ? where id = ?")
    .bind(clip(input.note, 400), input.id)
    .run();
  return { ok: true };
}

// Hlavní redaktor návrh zahodí úplně: autor ho už neuvidí ani jako vrácený.
export async function discardProposal(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await env.DB.prepare("select id, image_key, status from proposals where id = ?").bind(id).first();
  if (!row || row.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  await env.DB.prepare("delete from proposals where id = ?").bind(id).run();
  await forgetProposal(env, id);
  await reopenImports(env, { proposalIds: [id] });
  await releaseImage(env, row.image_key ? String(row.image_key) : null);
  return { ok: true };
}
