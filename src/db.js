import { COPY } from "./copy.js";
import { hashPassword, verifyPassword } from "./password.js";
import { prepareArticleBody } from "./rich.js";
import { buildWasteView } from "./waste.js";

export const CATEGORIES = ["Zprávy", "Komunita", "Kultura", "Praktické", "Sport"];
export const POPELNICE_URL = "https://popelnice.kopidlenskadrbna.org/";
const COOKIE = "drbna_editor";
const ARTICLE_COLUMNS =
  "id, slug, title, excerpt, body, category, image_key, published, created_at, author_id, author_name, redacted";

let schemaPromise = null;

function clip(value, max) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function asBool(value) {
  return value === 1 || value === true || value === "1";
}

function normalizeLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

function slugify(input) {
  const map = {
    á: "a",
    č: "c",
    ď: "d",
    é: "e",
    ě: "e",
    í: "i",
    ň: "n",
    ó: "o",
    ř: "r",
    š: "s",
    ť: "t",
    ú: "u",
    ů: "u",
    ý: "y",
    ž: "z",
  };
  let out = "";
  for (const ch of input.toLowerCase()) out += map[ch] ?? ch;
  const slug = out
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug || "prispevek";
}

export function textWasEdited(before, after) {
  return (
    before.title !== after.title ||
    before.excerpt !== after.excerpt ||
    prepareArticleBody(before.body).html !== prepareArticleBody(after.body).html ||
    before.category !== after.category
  );
}

export function redactedFlag(already, submitted, finalText) {
  return Boolean(already) || textWasEdited(submitted, finalText);
}

function mapArticle(row) {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    excerpt: String(row.excerpt),
    body: String(row.body),
    category: String(row.category),
    imageKey: row.image_key ? String(row.image_key) : null,
    published: asBool(row.published),
    createdOn: String(row.created_at ?? "").slice(0, 10),
    authorId: row.author_id == null || row.author_id === "" ? null : Number(row.author_id),
    authorName: String(row.author_name ?? ""),
    redacted: asBool(row.redacted),
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    title: String(row.title),
    place: String(row.place),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    startsTime: String(row.starts_time ?? ""),
    description: String(row.description ?? ""),
    published: asBool(row.published),
  };
}

function mapAccount(row) {
  return {
    id: Number(row.id),
    login: String(row.login),
    name: String(row.name),
    role: String(row.role),
    active: asBool(row.active),
  };
}

function mapProposal(row) {
  return {
    id: Number(row.id),
    articleId: row.article_id == null || row.article_id === "" ? null : Number(row.article_id),
    articleSlug: row.article_slug ? String(row.article_slug) : "",
    articleTitle: row.article_title ? String(row.article_title) : "",
    authorId: Number(row.author_id),
    authorName: String(row.author_name),
    title: String(row.title),
    excerpt: String(row.excerpt),
    body: String(row.body),
    category: String(row.category),
    imageKey: row.image_key ? String(row.image_key) : null,
    submittedTitle: String(row.submitted_title),
    submittedExcerpt: String(row.submitted_excerpt),
    submittedBody: String(row.submitted_body),
    submittedCategory: String(row.submitted_category),
    status: String(row.status),
    note: String(row.note ?? ""),
    createdOn: String(row.created_at ?? "").slice(0, 10),
  };
}

async function settings(env) {
  const row = await env.DB.prepare(
    `select password_hash, session_token, password_is_default, contact_note, waste_note, holiday_note, weekday, week_parity, step_days
     from settings where id = 1`,
  ).first();
  if (!row) throw new Error("Databáze ještě nemá redakci. Na účtu spusťte schema.sql proti D1.");
  return row;
}

function wasteFrom(row) {
  return {
    weekday: Number(row.weekday),
    weekParity: Number(row.week_parity),
    stepDays: Number(row.step_days),
    note: String(row.waste_note),
    holidayNote: String(row.holiday_note),
  };
}

export function readCookie(request) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token, secure) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=2592000"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure) {
  const parts = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function createDeskTables(env) {
  await env.DB.prepare(
    `create table if not exists users (
      id integer primary key autoincrement,
      login text not null unique,
      name text not null,
      password_hash text not null,
      role text not null,
      session_token text,
      active integer not null default 1,
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists proposals (
      id integer primary key autoincrement,
      article_id integer,
      author_id integer not null,
      author_name text not null,
      title text not null,
      excerpt text not null,
      body text not null,
      category text not null,
      image_key text,
      submitted_title text not null,
      submitted_excerpt text not null,
      submitted_body text not null,
      submitted_category text not null,
      status text not null default 'pending',
      note text not null default '',
      created_at text not null default (date('now'))
    )`,
  ).run();
}

async function addColumn(env, present, name, sql) {
  if (present.has(name)) return;
  try {
    await env.DB.prepare(sql).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column/i.test(message)) throw error;
  }
}

async function ensureArticleColumns(env) {
  const info = await env.DB.prepare("pragma table_info(articles)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "author_id", "alter table articles add column author_id integer");
  await addColumn(env, names, "author_name", "alter table articles add column author_name text not null default ''");
  await addColumn(env, names, "redacted", "alter table articles add column redacted integer not null default 0");
}

async function migrateSession(env) {
  const row = await env.DB.prepare("select session_token from settings where id = 1").first();
  if (!row?.session_token) return;
  const chief = await env.DB.prepare(
    "select id, session_token from users where role = 'hlavni' order by id asc limit 1",
  ).first();
  if (chief && !chief.session_token) {
    await env.DB.prepare("update users set session_token = ? where id = ?").bind(row.session_token, chief.id).run();
  }
  await env.DB.prepare("update settings set session_token = null where id = 1").run();
}

async function migrateSchema(env) {
  await createDeskTables(env);
  const settingsTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'settings'",
  ).first();
  if (!settingsTable) return false;
  const articlesTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'articles'",
  ).first();
  if (articlesTable) await ensureArticleColumns(env);
  await env.DB.prepare(
    `insert into users (login, name, password_hash, role)
     select 'redakce', 'Redakce', password_hash, 'hlavni' from settings
     where id = 1 and not exists (select 1 from users)`,
  ).run();
  await migrateSession(env);
  return true;
}

export function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = migrateSchema(env).then(
      (done) => {
        if (!done) schemaPromise = null;
      },
      (error) => {
        schemaPromise = null;
        throw error;
      },
    );
  }
  return schemaPromise;
}

async function currentUser(env, request) {
  const token = readCookie(request);
  if (!token || token.length < 20) return null;
  const row = await env.DB.prepare(
    "select id, login, name, role, active from users where session_token = ? and active = 1",
  )
    .bind(token)
    .first();
  return row ? mapAccount(row) : null;
}

async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { ok: false, error: "Přihlaste se do redakce." };
  return { ok: true, user };
}

async function requireChief(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (gate.user.role !== "hlavni") return { ok: false, error: "Tohle mění jen hlavní redaktor." };
  return gate;
}

function readArticleFields(input) {
  const title = clip(input.title, 160);
  const excerpt = clip(input.excerpt, 320);
  const prepared = prepareArticleBody(clip(input.body, 20000));
  const category = CATEGORIES.includes(input.category) ? input.category : "Zprávy";
  if (title.length < 3) return { error: "Doplňte nadpis." };
  if (excerpt.length < 3) return { error: "Doplňte krátký perex." };
  if (prepared.text.length < 3) return { error: "Doplňte text." };
  return { title, excerpt, body: prepared.html, category };
}

async function loadProposals(env, whereSql, ...binds) {
  const query = env.DB.prepare(
    `select p.id, p.article_id, p.author_id, p.author_name, p.title, p.excerpt, p.body, p.category, p.image_key,
            p.submitted_title, p.submitted_excerpt, p.submitted_body, p.submitted_category, p.status, p.note, p.created_at,
            a.slug as article_slug, a.title as article_title
     from proposals p
     left join articles a on a.id = p.article_id
     ${whereSql}`,
  );
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  return (rows.results ?? []).map(mapProposal);
}

export async function loadPublic(env) {
  const row = await settings(env);
  const articles = (
    await env.DB.prepare(
      `select ${ARTICLE_COLUMNS}
       from articles where published = 1 order by created_at desc, id desc`,
    ).all()
  ).results.map(mapArticle);
  const events = (
    await env.DB.prepare(
      `select id, title, place, starts_on, starts_time, description, published
       from events where published = 1 order by starts_on asc, starts_time asc, id asc`,
    ).all()
  ).results.map(mapEvent);
  return {
    articles,
    events,
    waste: buildWasteView(wasteFrom(row)),
    contactNote: String(row.contact_note),
    showDefaultPassword: asBool(row.password_is_default),
  };
}

export async function loadArticle(env, slug) {
  const row = await env.DB.prepare(
    `select ${ARTICLE_COLUMNS}
     from articles where slug = ? and published = 1`,
  )
    .bind(slug)
    .first();
  return row ? mapArticle(row) : null;
}

export async function loadAdmin(env, request) {
  const row = await settings(env);
  const user = await currentUser(env, request);
  const base = {
    signedIn: Boolean(user),
    user,
    showDefaultPassword: asBool(row.password_is_default),
    waste: buildWasteView(wasteFrom(row)),
    contactNote: String(row.contact_note),
    articles: [],
    events: [],
    proposals: [],
    users: [],
  };
  if (!user) return base;
  const articleSql =
    user.role === "hlavni"
      ? `select ${ARTICLE_COLUMNS} from articles order by created_at desc, id desc`
      : `select ${ARTICLE_COLUMNS} from articles where published = 1 order by created_at desc, id desc`;
  base.articles = (await env.DB.prepare(articleSql).all()).results.map(mapArticle);
  if (user.role === "hlavni") {
    base.events = (
      await env.DB.prepare(
        `select id, title, place, starts_on, starts_time, description, published
         from events order by starts_on asc, starts_time asc, id asc`,
      ).all()
    ).results.map(mapEvent);
    base.users = (
      await env.DB.prepare(
        "select id, login, name, role, active from users order by case role when 'hlavni' then 0 else 1 end, name",
      ).all()
    ).results.map(mapAccount);
    base.proposals = await loadProposals(env, "where p.status = 'pending' order by p.id asc");
  } else {
    base.proposals = await loadProposals(
      env,
      "where p.author_id = ? and p.status in ('pending', 'rejected') order by p.id desc",
      user.id,
    );
  }
  return base;
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function login(env, loginName, password) {
  const name = normalizeLogin(loginName);
  if (!name || !String(password ?? "")) return { ok: false, error: "Doplňte jméno a heslo." };
  const row = await env.DB.prepare("select id, password_hash, active from users where login = ?").bind(name).first();
  if (!row || !asBool(row.active) || !(await verifyPassword(password, row.password_hash))) {
    return { ok: false, error: "Jméno nebo heslo nesedí." };
  }
  const next = token();
  await env.DB.prepare("update users set session_token = ? where id = ?").bind(next, row.id).run();
  return { ok: true, token: next };
}

export async function logout(env, request) {
  const session = readCookie(request);
  if (!session) return;
  await env.DB.prepare("update users set session_token = null where session_token = ?").bind(session).run();
}

export async function changePassword(env, request, current, next) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (next.trim().length < 8) return { ok: false, error: "Nové heslo musí mít aspoň 8 znaků." };
  const row = await env.DB.prepare("select password_hash, role from users where id = ?").bind(gate.user.id).first();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return { ok: false, error: "Současné heslo nesedí." };
  }
  const hash = await hashPassword(next.trim());
  const session = token();
  await env.DB.prepare("update users set password_hash = ?, session_token = ? where id = ?")
    .bind(hash, session, gate.user.id)
    .run();
  if (row.role === "hlavni") {
    await env.DB.prepare(
      "update settings set password_hash = ?, password_is_default = 0, session_token = null where id = 1",
    )
      .bind(hash)
      .run();
  }
  return { ok: true, token: session };
}

export async function saveDisplayName(env, request, name) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const next = clip(name, 60);
  if (next.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  await env.DB.prepare("update users set name = ? where id = ?").bind(next, gate.user.id).run();
  return { ok: true };
}

async function uniqueSlug(env, base) {
  let slug = base;
  let n = 2;
  for (;;) {
    const row = await env.DB.prepare("select id from articles where slug = ?").bind(slug).first();
    if (!row) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function storeImage(env, file) {
  if (!(file instanceof File) || file.size === 0) return { key: null };
  if (file.size > 4 * 1024 * 1024) return { error: "Fotka může mít nejvýš 4 MB." };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { error: "Fotka musí být JPG, PNG, WEBP nebo GIF." };
  const key = `clanky/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return { key };
}

async function releaseImage(env, key) {
  if (!key) return;
  const article = await env.DB.prepare("select 1 as ok from articles where image_key = ?").bind(key).first();
  if (article) return;
  const proposal = await env.DB.prepare("select 1 as ok from proposals where image_key = ?").bind(key).first();
  if (proposal) return;
  await env.BUCKET.delete(key);
}

export async function saveArticle(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = readArticleFields(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const stored = await storeImage(env, input.image);
  if (stored.error) return { ok: false, error: stored.error };
  const { title, excerpt, body, category } = parsed;

  if (input.id) {
    const current = await env.DB.prepare(
      "select image_key, author_id, title, excerpt, body, category, redacted from articles where id = ?",
    )
      .bind(input.id)
      .first();
    if (!current) return { ok: false, error: "Tahle zpráva už tu není." };
    let imageKey = current.image_key ? String(current.image_key) : null;
    const previous = imageKey;
    if (stored.key) imageKey = stored.key;
    const authorIsOther = current.author_id && Number(current.author_id) !== gate.user.id;
    const redacted =
      authorIsOther &&
      textWasEdited(
        {
          title: String(current.title),
          excerpt: String(current.excerpt),
          body: String(current.body),
          category: String(current.category),
        },
        { title, excerpt, body, category },
      )
        ? 1
        : asBool(current.redacted)
          ? 1
          : 0;
    await env.DB.prepare(
      "update articles set title = ?, excerpt = ?, body = ?, category = ?, published = ?, image_key = ?, redacted = ? where id = ?",
    )
      .bind(title, excerpt, body, category, input.published ? 1 : 0, imageKey, redacted, input.id)
      .run();
    if (stored.key && previous && previous !== stored.key) await releaseImage(env, previous);
    return { ok: true };
  }

  const slug = await uniqueSlug(env, slugify(title));
  await env.DB.prepare(
    `insert into articles (slug, title, excerpt, body, category, image_key, published, created_at, author_id, author_name, redacted)
     values (?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?, 0)`,
  )
    .bind(slug, title, excerpt, body, category, stored.key, input.published ? 1 : 0, gate.user.id, gate.user.name)
    .run();
  return { ok: true };
}

export async function removeArticle(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const current = await env.DB.prepare("select image_key from articles where id = ?").bind(id).first();
  const proposals = (await env.DB.prepare("select image_key from proposals where article_id = ?").bind(id).all()).results ?? [];
  const keys = new Set();
  if (current?.image_key) keys.add(String(current.image_key));
  for (const row of proposals) if (row.image_key) keys.add(String(row.image_key));
  await env.DB.prepare("delete from proposals where article_id = ?").bind(id).run();
  await env.DB.prepare("delete from articles where id = ?").bind(id).run();
  for (const key of keys) await releaseImage(env, key);
  return { ok: true };
}

export async function saveProposal(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (gate.user.role !== "prispevovatel") return { ok: false, error: "Hlavní redaktor ukládá zprávy přímo." };
  const parsed = readArticleFields(input);
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

  const stored = await storeImage(env, input.image);
  if (stored.error) return { ok: false, error: stored.error };

  if (existing) {
    let imageKey = existing.image_key ? String(existing.image_key) : null;
    const previous = imageKey;
    if (stored.key) imageKey = stored.key;
    await env.DB.prepare(
      `update proposals
       set title = ?, excerpt = ?, body = ?, category = ?, image_key = ?,
           submitted_title = ?, submitted_excerpt = ?, submitted_body = ?, submitted_category = ?,
           author_name = ?, status = 'pending', note = ''
       where id = ?`,
    )
      .bind(
        parsed.title,
        parsed.excerpt,
        parsed.body,
        parsed.category,
        imageKey,
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
       article_id, author_id, author_name, title, excerpt, body, category, image_key,
       submitted_title, submitted_excerpt, submitted_body, submitted_category, status
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(
      articleId,
      gate.user.id,
      gate.user.name,
      parsed.title,
      parsed.excerpt,
      parsed.body,
      parsed.category,
      stored.key,
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
  await releaseImage(env, row.image_key ? String(row.image_key) : null);
  return { ok: true };
}

export async function approveProposal(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.id) return { ok: false, error: "Ten návrh už tu není." };
  const proposal = await env.DB.prepare(
    `select id, article_id, author_id, author_name, image_key, submitted_title, submitted_excerpt,
            submitted_body, submitted_category, status
     from proposals where id = ?`,
  )
    .bind(input.id)
    .first();
  if (!proposal || proposal.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  const parsed = readArticleFields(input);
  if (parsed.error) return { ok: false, error: parsed.error };

  let article = null;
  if (proposal.article_id) {
    article = await env.DB.prepare("select id, image_key, redacted from articles where id = ?")
      .bind(proposal.article_id)
      .first();
    if (!article) return { ok: false, error: "Tahle zpráva už tu není." };
  }

  const stored = await storeImage(env, input.image);
  if (stored.error) return { ok: false, error: stored.error };

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
      "update articles set title = ?, excerpt = ?, body = ?, category = ?, image_key = ?, published = 1, redacted = ? where id = ?",
    )
      .bind(parsed.title, parsed.excerpt, parsed.body, parsed.category, nextImage, redacted, article.id)
      .run();
    if (previousArticleImage && previousArticleImage !== nextImage) await releaseImage(env, previousArticleImage);
  } else {
    const slug = await uniqueSlug(env, slugify(parsed.title));
    await env.DB.prepare(
      `insert into articles (slug, title, excerpt, body, category, image_key, published, created_at, author_id, author_name, redacted)
       values (?, ?, ?, ?, ?, ?, 1, date('now'), ?, ?, ?)`,
    )
      .bind(
        slug,
        parsed.title,
        parsed.excerpt,
        parsed.body,
        parsed.category,
        imageKey,
        proposal.author_id,
        proposal.author_name,
        textWasEdited(submitted, finalText) ? 1 : 0,
      )
      .run();
  }

  await env.DB.prepare(
    "update proposals set title = ?, excerpt = ?, body = ?, category = ?, image_key = ?, status = 'approved', note = '' where id = ?",
  )
    .bind(parsed.title, parsed.excerpt, parsed.body, parsed.category, imageKey, proposal.id)
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

export async function createContributor(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const name = clip(input.name, 60);
  const loginName = normalizeLogin(input.login);
  const password = String(input.password ?? "").trim();
  if (name.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  if (!/^[a-z0-9]{3,32}$/.test(loginName)) {
    return { ok: false, error: "Přihlašovací jméno může mít 3 až 32 znaků: malá písmena a číslice." };
  }
  if (password.length < 8) return { ok: false, error: "Heslo musí mít aspoň 8 znaků." };
  const existing = await env.DB.prepare("select id from users where login = ?").bind(loginName).first();
  if (existing) return { ok: false, error: "Tohle přihlašovací jméno už někdo má." };
  await env.DB.prepare("insert into users (login, name, password_hash, role) values (?, ?, ?, 'prispevovatel')")
    .bind(loginName, name, await hashPassword(password))
    .run();
  return { ok: true };
}

export async function setContributorActive(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await env.DB.prepare("select id, role from users where id = ?").bind(input.id).first();
  if (!row) return { ok: false, error: "Ten účet už tu není." };
  if (row.role === "hlavni") return { ok: false, error: "Účet hlavního redaktora takhle nejde vypnout." };
  const active = input.active === "1" || input.active === 1 || input.active === true;
  await env.DB.prepare(
    "update users set active = ?, session_token = case when ? = 0 then null else session_token end where id = ?",
  )
    .bind(active ? 1 : 0, active ? 1 : 0, row.id)
    .run();
  return { ok: true, active };
}

export async function setContributorPassword(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const password = String(input.next ?? "").trim();
  if (password.length < 8) return { ok: false, error: "Heslo musí mít aspoň 8 znaků." };
  const row = await env.DB.prepare("select id, role from users where id = ?").bind(input.id).first();
  if (!row) return { ok: false, error: "Ten účet už tu není." };
  if (row.role !== "prispevovatel") return { ok: false, error: "Heslo hlavního redaktora se mění v záložce Heslo." };
  await env.DB.prepare("update users set password_hash = ?, session_token = null where id = ?")
    .bind(await hashPassword(password), row.id)
    .run();
  return { ok: true };
}

export async function saveEvent(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const title = clip(input.title, 160);
  const place = clip(input.place, 160);
  const description = clip(input.description, 4000);
  const startsTime = clip(input.startsTime, 8);
  const startsOn = clip(input.startsOn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return { ok: false, error: "Doplňte datum." };
  if (title.length < 3) return { ok: false, error: "Doplňte název akce." };
  if (place.length < 2) return { ok: false, error: "Doplňte místo." };
  if (input.id) {
    await env.DB.prepare(
      "update events set title = ?, place = ?, starts_on = ?, starts_time = ?, description = ?, published = ? where id = ?",
    )
      .bind(title, place, startsOn, startsTime, description, input.published ? 1 : 0, input.id)
      .run();
    return { ok: true };
  }
  await env.DB.prepare(
    "insert into events (title, place, starts_on, starts_time, description, published) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(title, place, startsOn, startsTime, description, input.published ? 1 : 0)
    .run();
  return { ok: true };
}

export async function removeEvent(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from events where id = ?").bind(id).run();
  return { ok: true };
}

export async function saveSite(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const weekday = Number(input.weekday);
  const weekParity = Number(input.weekParity) === 0 ? 0 : 1;
  const stepDays = Number(input.stepDays);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { ok: false, error: "Vyberte den svozu." };
  if (!Number.isInteger(stepDays) || stepDays < 7 || stepDays > 56) {
    return { ok: false, error: "Interval musí být mezi 7 a 56 dny." };
  }
  const contactNote = clip(input.contactNote, 600);
  const wasteNote = clip(input.wasteNote, 800);
  const holidayNote = clip(input.holidayNote, 160);
  if (contactNote.length < 3 || wasteNote.length < 3) return { ok: false, error: "Doplňte texty pro návštěvníky." };
  await env.DB.prepare(
    `update settings set contact_note = ?, waste_note = ?, holiday_note = ?, weekday = ?, week_parity = ?, step_days = ? where id = 1`,
  )
    .bind(contactNote, wasteNote, holidayNote, weekday, weekParity, stepDays)
    .run();
  return { ok: true };
}

export async function loadCopy(env) {
  const copy = Object.fromEntries(COPY.map((item) => [item.key, item.value]));
  try {
    const rows = (await env.DB.prepare("select key, value from copy").all()).results ?? [];
    for (const row of rows) {
      if (row.key in copy && row.value != null && String(row.value).trim()) copy[row.key] = String(row.value);
    }
  } catch {
    // Starší databáze ještě nemá tabulku copy. Stránky pojedou z výchozích textů.
  }
  return copy;
}

export async function saveCopy(env, request) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const form = await request.formData();
  const statements = [];
  for (const item of COPY) {
    const value = clip(form.get(item.key), item.max);
    if (!value) return { ok: false, error: `Doplňte pole: ${item.label}.` };
    if (item.key === "popelnice_url" && !/^https?:\/\//i.test(value)) {
      return { ok: false, error: "Adresa původního svozu musí začínat na https://." };
    }
    statements.push(
      env.DB.prepare(
        "insert into copy (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
      ).bind(item.key, value),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch {
    return { ok: false, error: "Texty se neuložily. Spusťte znovu npm run nasadit, ať se v databázi doplní tabulka textů." };
  }
  return { ok: true };
}

export async function media(env, key) {
  if (!key || key.includes("..") || key.startsWith("/")) return null;
  return env.BUCKET.get(key);
}
