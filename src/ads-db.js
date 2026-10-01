// Reklamy v D1: načtení, uložení a návrhy reklam od přispěvatelů ke schválení.
import { readAdFields } from "./ads.js";
import { asBool, clip, requireChief, requireUser, slugify } from "./db-core.js";
import { releaseImage, storeImage } from "./images.js";

const AD_FIELDS =
  "a.id, a.slug, a.title, a.body, a.place, a.link, a.image_key, a.enabled, a.sample, a.author_id, a.author_name, a.created_at, u.alias as author_alias";
const AD_FROM = "ads a left join users u on u.id = a.author_id";

function mapAd(row) {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    body: String(row.body),
    place: String(row.place ?? ""),
    link: String(row.link ?? ""),
    imageKey: row.image_key ? String(row.image_key) : null,
    enabled: asBool(row.enabled),
    sample: asBool(row.sample),
    authorId: row.author_id == null || row.author_id === "" ? null : Number(row.author_id),
    authorName: String(row.author_name ?? ""),
    authorAlias: String(row.author_alias ?? "").trim(),
    createdOn: String(row.created_at ?? "").slice(0, 10),
  };
}

export async function loadAds(env, { enabledOnly = false } = {}) {
  const where = enabledOnly ? "where a.enabled = 1" : "";
  const rows = await env.DB.prepare(
    `select ${AD_FIELDS} from ${AD_FROM} ${where} order by a.created_at desc, a.id desc`,
  ).all();
  return (rows.results ?? []).map(mapAd);
}

export async function loadAd(env, slug) {
  const row = await env.DB.prepare(`select ${AD_FIELDS} from ${AD_FROM} where a.slug = ? and a.enabled = 1`)
    .bind(slug)
    .first();
  return row ? mapAd(row) : null;
}

function canManageAd(user, row) {
  return user.role === "hlavni" || Number(row.author_id) === user.id;
}

async function uniqueAdSlug(env, base) {
  let slug = base;
  let n = 2;
  for (;;) {
    const row = await env.DB.prepare("select id from ads where slug = ?").bind(slug).first();
    if (!row) return slug;
    slug = `${base}-${n}`.slice(0, 80);
    n += 1;
  }
}

export async function saveAd(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const parsed = readAdFields(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const stored = await storeImage(env, input.image, "reklamy");
  if (stored.error) return { ok: false, error: stored.error };
  const { title, body, place, link, enabled } = parsed;

  if (input.id) {
    const current = await env.DB.prepare("select id, author_id, image_key from ads where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tahle nabídka už tu není." };
    if (!canManageAd(gate.user, current)) {
      return { ok: false, error: "Cizí nabídku mění hlavní redaktor, nebo její autor." };
    }
    let imageKey = current.image_key ? String(current.image_key) : null;
    const previous = imageKey;
    if (stored.key) imageKey = stored.key;
    await env.DB.prepare(
      "update ads set title = ?, body = ?, place = ?, link = ?, image_key = ?, enabled = ?, sample = 0 where id = ?",
    )
      .bind(title, body, place, link, imageKey, enabled ? 1 : 0, input.id)
      .run();
    if (stored.key && previous && previous !== stored.key) await releaseImage(env, previous);
    return { ok: true };
  }

  const slug = await uniqueAdSlug(env, slugify(title));
  await env.DB.prepare(
    `insert into ads (slug, title, body, place, link, image_key, enabled, sample, author_id, author_name, created_at)
     values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, date('now'))`,
  )
    .bind(slug, title, body, place, link, stored.key, enabled ? 1 : 0, gate.user.id, gate.user.name)
    .run();
  return { ok: true };
}

export async function setAdEnabled(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (!input.id) return { ok: false, error: "Tahle nabídka už tu není." };
  const row = await env.DB.prepare("select id, author_id from ads where id = ?").bind(input.id).first();
  if (!row) return { ok: false, error: "Tahle nabídka už tu není." };
  if (!canManageAd(gate.user, row)) {
    return { ok: false, error: "Cizí nabídku vypíná hlavní redaktor, nebo její autor." };
  }
  const enabled = input.enabled ? 1 : 0;
  await env.DB.prepare("update ads set enabled = ? where id = ?").bind(enabled, input.id).run();
  return { ok: true, enabled: Boolean(enabled) };
}

export async function removeAd(env, request, id) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  const current = await env.DB.prepare("select author_id, image_key from ads where id = ?").bind(id).first();
  if (!current) return { ok: false, error: "Tahle nabídka už tu není." };
  if (!canManageAd(gate.user, current)) {
    return { ok: false, error: "Cizí nabídku maže hlavní redaktor, nebo její autor." };
  }
  const proposals = (await env.DB.prepare("select image_key from ad_proposals where ad_id = ?").bind(id).all()).results ?? [];
  const keys = new Set();
  if (current.image_key) keys.add(String(current.image_key));
  for (const row of proposals) if (row.image_key) keys.add(String(row.image_key));
  await env.DB.prepare("delete from ad_proposals where ad_id = ?").bind(id).run();
  await env.DB.prepare("delete from ads where id = ?").bind(id).run();
  for (const key of keys) await releaseImage(env, key);
  return { ok: true };
}

function mapAdProposal(row) {
  return {
    id: Number(row.id),
    adId: row.ad_id == null || row.ad_id === "" ? null : Number(row.ad_id),
    adTitle: String(row.ad_title ?? ""),
    title: String(row.title),
    body: String(row.body),
    place: String(row.place ?? ""),
    link: String(row.link ?? ""),
    imageKey: row.image_key ? String(row.image_key) : null,
    enabled: asBool(row.enabled),
    status: String(row.status),
    note: String(row.note ?? ""),
    authorId: Number(row.author_id),
    authorName: String(row.author_name ?? ""),
    authorAlias: String(row.author_alias ?? "").trim(),
    createdOn: String(row.created_at ?? "").slice(0, 10),
  };
}

export async function loadAdProposals(env, whereSql, ...binds) {
  const query = env.DB.prepare(
    `select p.id, p.ad_id, p.author_id, p.author_name, p.title, p.body, p.place, p.link, p.image_key,
            p.enabled, p.status, p.note, p.created_at, a.title as ad_title, u.alias as author_alias
     from ad_proposals p
     left join ads a on a.id = p.ad_id
     left join users u on u.id = p.author_id
     ${whereSql}`,
  );
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  return (rows.results ?? []).map(mapAdProposal);
}

export async function saveAdProposal(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (gate.user.role !== "prispevovatel") return { ok: false, error: "Hlavní redaktor ukládá nabídky přímo." };
  const parsed = readAdFields(input);
  if (parsed.error) return { ok: false, error: parsed.error };

  let existing = null;
  if (input.id) {
    existing = await env.DB.prepare(
      "select id, author_id, ad_id, image_key, status from ad_proposals where id = ?",
    )
      .bind(input.id)
      .first();
    if (!existing || Number(existing.author_id) !== gate.user.id) return { ok: false, error: "Cizí návrh nejde měnit." };
    if (existing.status === "approved") {
      return { ok: false, error: "Schválený návrh už je nabídka. Novou úpravu navrhnete z ní." };
    }
  }

  let adId = existing?.ad_id ? Number(existing.ad_id) : null;
  if (!existing && input.adId) {
    const ad = await env.DB.prepare("select id, author_id, image_key from ads where id = ?").bind(input.adId).first();
    if (!ad) return { ok: false, error: "Tahle nabídka už tu není." };
    if (Number(ad.author_id) !== gate.user.id) {
      return { ok: false, error: "Cizí nabídku mění hlavní redaktor, nebo její autor." };
    }
    adId = Number(ad.id);
    existing = await env.DB.prepare(
      `select id, author_id, ad_id, image_key, status from ad_proposals
       where ad_id = ? and author_id = ? and status in ('pending', 'rejected')
       order by id desc`,
    )
      .bind(adId, gate.user.id)
      .first();
  }

  const stored = await storeImage(env, input.image, "reklamy");
  if (stored.error) return { ok: false, error: stored.error };

  if (existing) {
    let imageKey = existing.image_key ? String(existing.image_key) : null;
    const previous = imageKey;
    if (stored.key) imageKey = stored.key;
    await env.DB.prepare(
      `update ad_proposals
       set title = ?, body = ?, place = ?, link = ?, image_key = ?, enabled = ?,
           author_name = ?, status = 'pending', note = ''
       where id = ?`,
    )
      .bind(parsed.title, parsed.body, parsed.place, parsed.link, imageKey, parsed.enabled ? 1 : 0, gate.user.name, existing.id)
      .run();
    if (stored.key && previous && previous !== stored.key) await releaseImage(env, previous);
    return { ok: true, updated: true };
  }

  let imageKey = stored.key;
  if (!imageKey && adId) {
    const ad = await env.DB.prepare("select image_key from ads where id = ?").bind(adId).first();
    imageKey = ad?.image_key ? String(ad.image_key) : null;
  }
  await env.DB.prepare(
    `insert into ad_proposals (
       ad_id, author_id, author_name, title, body, place, link, image_key, enabled, status
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(adId, gate.user.id, gate.user.name, parsed.title, parsed.body, parsed.place, parsed.link, imageKey, parsed.enabled ? 1 : 0)
    .run();
  return { ok: true, updated: false };
}

export async function withdrawAdProposal(env, request, id) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  const row = await env.DB.prepare("select id, author_id, image_key, status from ad_proposals where id = ?")
    .bind(id)
    .first();
  if (!row || Number(row.author_id) !== gate.user.id) return { ok: false, error: "Cizí návrh nejde stáhnout." };
  if (row.status === "approved") return { ok: false, error: "Schválený návrh už je nabídka." };
  await env.DB.prepare("delete from ad_proposals where id = ?").bind(id).run();
  await releaseImage(env, row.image_key ? String(row.image_key) : null);
  return { ok: true };
}

export async function approveAdProposal(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  if (!input.id) return { ok: false, error: "Ten návrh už tu není." };
  const proposal = await env.DB.prepare(
    "select id, ad_id, author_id, author_name, image_key, status from ad_proposals where id = ?",
  )
    .bind(input.id)
    .first();
  if (!proposal || proposal.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  const parsed = readAdFields(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const stored = await storeImage(env, input.image, "reklamy");
  if (stored.error) return { ok: false, error: stored.error };

  let imageKey = proposal.image_key ? String(proposal.image_key) : null;
  const previousProposalImage = imageKey;
  if (stored.key) imageKey = stored.key;
  const oldKeys = new Set();

  let linkedId = proposal.ad_id ? Number(proposal.ad_id) : null;
  if (linkedId) {
    const ad = await env.DB.prepare("select id, image_key from ads where id = ?").bind(linkedId).first();
    if (!ad) {
      if (stored.key) await releaseImage(env, stored.key);
      return { ok: false, error: "Tahle nabídka už tu není." };
    }
    const previousAdImage = ad.image_key ? String(ad.image_key) : null;
    const nextImage = imageKey || previousAdImage;
    await env.DB.prepare(
      "update ads set title = ?, body = ?, place = ?, link = ?, image_key = ?, enabled = ?, sample = 0 where id = ?",
    )
      .bind(parsed.title, parsed.body, parsed.place, parsed.link, nextImage, parsed.enabled ? 1 : 0, linkedId)
      .run();
    imageKey = nextImage;
    if (previousAdImage && previousAdImage !== nextImage) oldKeys.add(previousAdImage);
  } else {
    const slug = await uniqueAdSlug(env, slugify(parsed.title));
    const created = await env.DB.prepare(
      `insert into ads (slug, title, body, place, link, image_key, enabled, sample, author_id, author_name, created_at)
       values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, date('now'))`,
    )
      .bind(slug, parsed.title, parsed.body, parsed.place, parsed.link, imageKey, parsed.enabled ? 1 : 0, proposal.author_id, proposal.author_name)
      .run();
    linkedId = Number(created.meta?.last_row_id ?? 0) || null;
    if (!linkedId) {
      const row = await env.DB.prepare("select id from ads where slug = ?").bind(slug).first();
      linkedId = row ? Number(row.id) : null;
    }
  }

  await env.DB.prepare(
    `update ad_proposals
     set ad_id = ?, title = ?, body = ?, place = ?, link = ?, image_key = ?, enabled = ?, status = 'approved', note = ''
     where id = ?`,
  )
    .bind(linkedId, parsed.title, parsed.body, parsed.place, parsed.link, imageKey, parsed.enabled ? 1 : 0, proposal.id)
    .run();
  if (previousProposalImage && previousProposalImage !== imageKey) oldKeys.add(previousProposalImage);
  for (const key of oldKeys) await releaseImage(env, key);
  return { ok: true };
}

export async function rejectAdProposal(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const row = await env.DB.prepare("select id, status from ad_proposals where id = ?").bind(input.id).first();
  if (!row || row.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  await env.DB.prepare("update ad_proposals set status = 'rejected', note = ? where id = ?")
    .bind(clip(input.note, 400), input.id)
    .run();
  return { ok: true };
}
