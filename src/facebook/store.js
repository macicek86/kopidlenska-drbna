import { pageIdentifier } from "./api.js";

export const KEEP_DAYS = 30;
export const FACEBOOK_TABLES = [
  `create table if not exists facebook_pages (
    id integer primary key autoincrement,
    identifier text not null unique collate nocase,
    name text not null default '',
    checked_at text,
    error text not null default ''
  )`,
  `create table if not exists facebook_posts (
    id integer primary key autoincrement,
    page_id integer not null,
    post_id text not null unique,
    text text not null,
    link text not null,
    published_at text not null,
    fetched_at text not null default (datetime('now')),
    proposal_id integer,
    processing_token text not null default '',
    processing_at text
  )`,
  "create index if not exists facebook_posts_page on facebook_posts (page_id, published_at)",
];

export async function ensureFacebookTables(env) {
  const existed = await env.DB.prepare("select 1 as ok from sqlite_master where type = 'table' and name = 'facebook_pages'").first();
  for (const sql of FACEBOOK_TABLES) await env.DB.prepare(sql).run();
  if (existed) return;
  for (const identifier of ["kopidlenskelisty", "JicinevesCZ"]) {
    await env.DB.prepare("insert or ignore into facebook_pages (identifier, name) values (?, ?)").bind(identifier, identifier === "kopidlenskelisty" ? "Kopidlenské listy" : "Jičíněves").run();
  }
}

export async function addPage(env, value) {
  const identifier = pageIdentifier(value);
  if (!identifier) return { ok: false, error: "Zadejte ID Page nebo její přímý odkaz na Facebooku." };
  const count = await env.DB.prepare("select count(*) as n from facebook_pages").first();
  if (Number(count?.n) >= 20) return { ok: false, error: "Nejvýš 20 zdrojových Pages. Další přidejte po odebrání některé stávající." };
  await env.DB.prepare("insert or ignore into facebook_pages (identifier) values (?)").bind(identifier).run();
  return { ok: true };
}

export async function loadFacebook(env) {
  const [pages, posts] = await Promise.all([
    env.DB.prepare("select * from facebook_pages order by name, id").all(),
    env.DB.prepare(`select p.*, s.name as page_name, r.id as draft_id, r.article_id as article_id
      from facebook_posts p join facebook_pages s on s.id = p.page_id
      left join proposals r on r.id = coalesce(p.proposal_id, (select id from proposals
        where substr(source, -length(' ' || p.link)) = ' ' || p.link order by id desc limit 1))
      where p.fetched_at >= datetime('now', '-30 days')
      order by p.published_at desc, p.id desc limit 200`).all(),
  ]);
  return { pages: pages.results ?? [], posts: posts.results ?? [], ready: Boolean(env.FACEBOOK_ACCESS_TOKEN), aiReady: Boolean(env.ANTHROPIC_API_KEY) };
}

export async function getPage(env, id) {
  return env.DB.prepare("select * from facebook_pages where id = ?").bind(Number(id) || 0).first();
}

export async function rememberPosts(env, page, result) {
  const statements = result.items.map((item) => env.DB.prepare(`insert into facebook_posts (page_id, post_id, text, link, published_at)
    select ?, ?, ?, ?, ? where exists (select 1 from facebook_pages where id = ?) on conflict(post_id) do update set
    text = excluded.text, link = excluded.link, published_at = excluded.published_at, fetched_at = datetime('now')`)
    .bind(page.id, item.postId, item.text, item.link, item.publishedAt, page.id));
  statements.push(env.DB.prepare("update facebook_pages set name = ?, checked_at = datetime('now'), error = '' where id = ?").bind(result.name, page.id));
  await env.DB.batch(statements);
}

export async function claimPost(env, id, token) {
  const result = await env.DB.prepare(`update facebook_posts set processing_token = ?, processing_at = datetime('now')
    where id = ? and fetched_at >= datetime('now', '-30 days')
    and (proposal_id is null or not exists (select 1 from proposals where id = facebook_posts.proposal_id))
    and not exists (select 1 from proposals where substr(source, -length(' ' || facebook_posts.link)) = ' ' || facebook_posts.link)
    and (processing_token = '' or processing_at < datetime('now', '-30 minutes'))`)
    .bind(token, Number(id) || 0).run();
  if (!result.meta?.changes) return null;
  return env.DB.prepare(`select p.*, s.name as page_name from facebook_posts p
    join facebook_pages s on s.id = p.page_id where p.id = ? and p.processing_token = ?`).bind(Number(id), token).first();
}

export async function releasePost(env, id, token, proposalId = null) {
  await env.DB.prepare(`update facebook_posts set proposal_id = coalesce(?, proposal_id), processing_token = '', processing_at = null
    where id = ? and processing_token = ?`).bind(proposalId, Number(id), token).run();
}

export async function refreshClaim(env, id, token) {
  const result = await env.DB.prepare("update facebook_posts set processing_at = datetime('now') where id = ? and processing_token = ?")
    .bind(Number(id), token).run();
  return Boolean(result.meta?.changes);
}

export async function removePage(env, id) {
  const key = Number(id) || 0;
  const active = "select 1 from facebook_posts where page_id = ? and processing_token <> '' and processing_at >= datetime('now', '-30 minutes')";
  const results = await env.DB.batch([
    env.DB.prepare(`delete from facebook_posts where page_id = ? and not exists (${active})`).bind(key, key),
    env.DB.prepare(`delete from facebook_pages where id = ? and not exists (${active})`).bind(key, key),
    env.DB.prepare("delete from health where key = ? and not exists (select 1 from facebook_pages where id = ?)").bind(`facebook:${key}`, key),
  ]);
  return Boolean(results[1].meta?.changes);
}

export async function removePost(env, id) {
  const result = await env.DB.prepare(`delete from facebook_posts where id = ?
    and (processing_token = '' or processing_at < datetime('now', '-30 minutes'))`).bind(Number(id) || 0).run();
  return Boolean(result.meta?.changes);
}

export async function pruneFacebookPosts(env) {
  await env.DB.prepare("delete from facebook_posts where fetched_at < datetime('now', '-30 days') and processing_token = ''").run();
  // Nedokončená práce může být po pádu Workeru zamčená; starý záznam nesmí obejít úklid.
  await env.DB.prepare("delete from facebook_posts where fetched_at < datetime('now', '-30 days') and processing_at < datetime('now', '-30 minutes')").run();
}
