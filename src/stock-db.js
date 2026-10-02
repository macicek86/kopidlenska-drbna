// Knihovna obrázků v D1: témata, fotky a téma, ze kterého se bere, když vybrané téma nemá žádnou fotku.
// Fotku vybírá podle toho, kdy byla naposledy použitá, aby se stejná neopakovala hned po sobě.
import { clip, requireUser, slugify, userCan } from "./db-core.js";
import { releaseImage, storeImage } from "./images.js";
import { readCaption, readFocus } from "./photo.js";
import { STOCK_SEEDS, stockCaption } from "./stock.js";

export const STOCK_PERMISSION = "obrazky";
const MAX_UPLOAD = 20;

const TABLES = [
  `create table if not exists stock_topics (
    id integer primary key autoincrement,
    name text not null,
    slug text not null unique,
    hint text not null default '',
    sort_order integer not null default 0
  )`,
  `create table if not exists stock_images (
    id integer primary key autoincrement,
    topic_id integer not null,
    image_key text not null,
    image_focus text not null default '',
    caption text not null default '',
    used_at text,
    created_at text not null default (datetime('now'))
  )`,
  "create index if not exists stock_images_topic on stock_images(topic_id)",
  "create index if not exists stock_images_key on stock_images(image_key)",
  `create table if not exists stock_settings (
    id integer primary key,
    fallback_topic_id integer
  )`,
];

// Při prvním založení dá do knihovny výchozí témata a jako náhradní nastaví „Kopidlno obecně“.
export async function ensureStockTables(env) {
  const exists = await env.DB.prepare("select 1 as ok from sqlite_master where type = 'table' and name = 'stock_topics'").first();
  for (const sql of TABLES) await env.DB.prepare(sql).run();
  if (exists) return;
  for (const [index, seed] of STOCK_SEEDS.entries()) {
    await env.DB.prepare("insert into stock_topics (name, slug, hint, sort_order) values (?, ?, ?, ?)")
      .bind(seed.name, seed.slug, seed.hint, index * 10)
      .run();
  }
  await env.DB.prepare(
    "insert into stock_settings (id, fallback_topic_id) select 1, (select id from stock_topics where slug = 'obecne') where not exists (select 1 from stock_settings)",
  ).run();
}

function mapTopic(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    hint: String(row.hint ?? ""),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapImage(row) {
  return {
    id: Number(row.id),
    topicId: Number(row.topic_id),
    imageKey: String(row.image_key),
    imageFocus: String(row.image_focus ?? ""),
    caption: String(row.caption ?? ""),
    usedAt: row.used_at ? String(row.used_at) : "",
  };
}

export async function loadStockTopics(env) {
  const rows = (await env.DB.prepare("select id, name, slug, hint, sort_order from stock_topics order by sort_order asc, name asc").all()).results ?? [];
  return rows.map(mapTopic);
}

// Celá knihovna: témata s fotkami a nastavení. Redakce ji potřebuje u zpráv (výběr fotky) i na stránce knihovny.
export async function loadStock(env) {
  const [topics, images, settings] = await Promise.all([
    loadStockTopics(env),
    env.DB.prepare("select id, topic_id, image_key, image_focus, caption, used_at from stock_images order by id desc").all(),
    env.DB.prepare("select fallback_topic_id from stock_settings where id = 1").first(),
  ]);
  const byTopic = new Map(topics.map((topic) => [topic.id, { ...topic, images: [] }]));
  for (const image of (images.results ?? []).map(mapImage)) byTopic.get(image.topicId)?.images.push(image);
  const fallback = Number(settings?.fallback_topic_id);
  return { topics: [...byTopic.values()], fallbackTopicId: byTopic.has(fallback) ? fallback : null };
}

async function leastUsed(env, topicId) {
  return env.DB.prepare(
    `select id, image_key, image_focus, caption from stock_images where topic_id = ?
     order by used_at is not null, used_at asc, random() limit 1`,
  )
    .bind(topicId)
    .first();
}

async function useImage(env, row) {
  await env.DB.prepare("update stock_images set used_at = datetime('now') where id = ?").bind(row.id).run();
  return { key: String(row.image_key), focus: readFocus(row.image_focus), caption: stockCaption(row.caption) };
}

// Fotka k článku od Drběny: z tématu, které vybrala, jinak z náhradního tématu (když ho redakce nevypnula).
export async function pickStockImage(env, topicSlug) {
  const topic = topicSlug ? await env.DB.prepare("select id from stock_topics where slug = ?").bind(topicSlug).first() : null;
  let row = topic ? await leastUsed(env, Number(topic.id)) : null;
  if (!row) {
    const settings = await env.DB.prepare("select fallback_topic_id from stock_settings where id = 1").first();
    const fallback = Number(settings?.fallback_topic_id);
    if (fallback && fallback !== Number(topic?.id)) row = await leastUsed(env, fallback);
  }
  return row ? useImage(env, row) : null;
}

// Fotka z formuláře zprávy nebo návrhu: nahraná má přednost, jinak vybraná z knihovny (pole stock_id).
// `photo` přepíše výřez a popisek, které formulář poslal ke staré fotce.
export async function formImage(env, input) {
  const stored = await storeImage(env, input.image);
  if (stored.error || stored.key || !input.stockId) return { ...stored, photo: {} };
  const row = await env.DB.prepare("select id, image_key, image_focus, caption from stock_images where id = ?").bind(input.stockId).first();
  if (!row) return { error: "Ta fotka z knihovny už tu není." };
  const image = await useImage(env, row);
  return { key: image.key, photo: { imageFocus: image.focus, imageCaption: image.caption } };
}

async function requireStock(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (!userCan(gate.user, STOCK_PERMISSION)) return { ok: false, error: "Na knihovnu obrázků potřebuješ oprávnění." };
  return gate;
}

async function topicExists(env, id) {
  if (!id) return false;
  return Boolean(await env.DB.prepare("select 1 as ok from stock_topics where id = ?").bind(id).first());
}

async function uniqueTopicSlug(env, base, id) {
  let slug = base;
  for (let n = 2; ; n += 1) {
    const row = await env.DB.prepare("select id from stock_topics where slug = ?").bind(slug).first();
    if (!row || Number(row.id) === id) return slug;
    slug = `${base}-${n}`;
  }
}

// Značka tématu (pro Claude) se dává jen při založení, přejmenování ji nemění.
export async function saveStockTopic(env, request, input) {
  const gate = await requireStock(env, request);
  if (!gate.ok) return gate;
  const name = clip(input.name, 80).replace(/\s+/g, " ");
  const hint = clip(input.hint, 200).replace(/\s+/g, " ");
  const sortOrder = Math.min(999, Math.max(0, Math.round(Number(input.sortOrder) || 0)));
  if (name.length < 2) return { ok: false, error: "Napište název tématu." };
  if (input.id) {
    if (!(await topicExists(env, input.id))) return { ok: false, error: "Tohle téma už tu není." };
    await env.DB.prepare("update stock_topics set name = ?, hint = ?, sort_order = ? where id = ?").bind(name, hint, sortOrder, input.id).run();
    return { ok: true, updated: true };
  }
  const slug = await uniqueTopicSlug(env, slugify(name).slice(0, 40), 0);
  await env.DB.prepare("insert into stock_topics (name, slug, hint, sort_order) values (?, ?, ?, ?)").bind(name, slug, hint, sortOrder).run();
  return { ok: true, updated: false };
}

// Smaže téma i s jeho fotkami. Fotky, které už jsou u zpráv, zůstanou u nich.
export async function removeStockTopic(env, request, id) {
  const gate = await requireStock(env, request);
  if (!gate.ok) return gate;
  const keys = ((await env.DB.prepare("select image_key from stock_images where topic_id = ?").bind(id).all()).results ?? []).map((row) => String(row.image_key));
  await env.DB.prepare("delete from stock_images where topic_id = ?").bind(id).run();
  await env.DB.prepare("delete from stock_topics where id = ?").bind(id).run();
  await env.DB.prepare("update stock_settings set fallback_topic_id = null where fallback_topic_id = ?").bind(id).run();
  for (const key of keys) await releaseImage(env, key);
  return { ok: true };
}

export async function uploadStockImages(env, request, input) {
  const gate = await requireStock(env, request);
  if (!gate.ok) return gate;
  if (!(await topicExists(env, input.topicId))) return { ok: false, error: "Vyberte téma." };
  const files = (input.images ?? []).filter((file) => file instanceof File && file.size > 0);
  if (!files.length) return { ok: false, error: "Vyberte aspoň jednu fotku." };
  if (files.length > MAX_UPLOAD) return { ok: false, error: `Najednou jde nahrát nejvýš ${MAX_UPLOAD} fotek.` };
  const caption = readCaption(input.imageCaption).slice(0, 160);
  let added = 0;
  for (const file of files) {
    const stored = await storeImage(env, file, "knihovna");
    if (stored.error) return { ok: false, error: added ? `Nahráno ${added}, další fotka neprošla: ${stored.error}` : stored.error };
    await env.DB.prepare("insert into stock_images (topic_id, image_key, caption) values (?, ?, ?)").bind(input.topicId, stored.key, caption).run();
    added += 1;
  }
  return { ok: true, added };
}

export async function saveStockImage(env, request, input) {
  const gate = await requireStock(env, request);
  if (!gate.ok) return gate;
  const row = await env.DB.prepare("select id, image_key from stock_images where id = ?").bind(input.id).first();
  if (!row) return { ok: false, error: "Tahle fotka už v knihovně není." };
  if (!(await topicExists(env, input.topicId))) return { ok: false, error: "Vyberte téma." };
  const stored = await storeImage(env, input.image, "knihovna");
  if (stored.error) return { ok: false, error: stored.error };
  const previous = String(row.image_key);
  await env.DB.prepare("update stock_images set topic_id = ?, image_key = ?, image_focus = ?, caption = ? where id = ?")
    .bind(input.topicId, stored.key ?? previous, readFocus(input.imageFocus), readCaption(input.imageCaption).slice(0, 160), input.id)
    .run();
  if (stored.key) await releaseImage(env, previous);
  return { ok: true };
}

export async function removeStockImage(env, request, id) {
  const gate = await requireStock(env, request);
  if (!gate.ok) return gate;
  const row = await env.DB.prepare("select image_key from stock_images where id = ?").bind(id).first();
  if (!row) return { ok: true };
  await env.DB.prepare("delete from stock_images where id = ?").bind(id).run();
  await releaseImage(env, String(row.image_key));
  return { ok: true };
}

// Prázdné pole vypne náhradní téma: Drběna pak dá zprávu bez obrázku, když ve vybraném tématu nic není.
export async function saveStockSettings(env, request, input) {
  const gate = await requireStock(env, request);
  if (!gate.ok) return gate;
  const fallback = Number(input.fallbackTopicId);
  const topicId = (await topicExists(env, fallback)) ? fallback : null;
  await env.DB.prepare(
    "insert into stock_settings (id, fallback_topic_id) values (1, ?) on conflict(id) do update set fallback_topic_id = excluded.fallback_topic_id",
  )
    .bind(topicId)
    .run();
  return { ok: true, fallback: Boolean(topicId) };
}
