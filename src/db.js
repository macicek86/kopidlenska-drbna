import { AD_SEEDS } from "./ads.js";
import { loadAdProposals, loadAds } from "./ads-db.js";
import { COPY } from "./copy.js";
import { hashPassword, verifyPassword } from "./password.js";
import { releaseImage, storeImage } from "./images.js";
import { readCaption, readFocus } from "./photo.js";
import { prepareArticleBody } from "./rich.js";
import { buildWasteView, pragueNow } from "./waste.js";
import { DOCTOR_SEEDS, changeSpan, normalizeWeek as normalizeDoctorWeek, parseHours as parseDoctorHours } from "./doctors.js";
import { closureSpan, normalizeWeek, parseHours } from "./yards.js";
import { KOPIDLNO } from "./outages.js";
import { emptyOutageBoard, loadOutageAreas, loadOutageBoard } from "./outages-db.js";
import {
  addColumn,
  asBool,
  clip,
  currentUser,
  mapAccount,
  normalizeLogin,
  readCookie,
  requireChief,
  requireUser,
  slugify,
  uniqueSlug,
  userCan,
} from "./db-core.js";
import { ensureNoticeTables, loadNoticeBoard, loadNotices } from "./notices-db.js";
import { ensureImportTables, loadImportItems, loadImportSettings } from "./munipolis/store.js";
import { ensureFootballTables, loadFootballItems, loadFootballSettings } from "./fotbal/store.js";
import { ensureDrbenaTable, loadDrbena } from "./drbena-db.js";
import { SEED_RUBRICS, deleteRubricError, parseRubricInput } from "./rubrics.js";

export const CATEGORIES = SEED_RUBRICS.map((item) => item.name);
export const PERMISSIONS = [
  {
    code: "sberny_dvur",
    label: "Sběrný dvůr",
    detail: "Může zapsat mimořádné uzavření a důvod. Dvůr samotný pořád mění hlavní redaktor.",
  },
  {
    code: "doktori",
    label: "Lékaři",
    detail: "Může měnit ordinační hodiny a dočasnou změnu. Ordinaci samotnou pořád zakládá hlavní redaktor.",
  },
];
export { clearCookie, readCookie, sessionCookie, userCan } from "./db-core.js";
export {
  addOutageArea,
  loadOutageBoard,
  refreshOutages,
  removeOutageArea,
  saveOutageAreas,
} from "./outages-db.js";
export const POPELNICE_URL = "https://popelnice.kopidlenskadrbna.org/";
const ARTICLE_FIELDS =
  "a.id, a.slug, a.title, a.excerpt, a.body, a.category, a.rubric_id, a.image_key, a.image_focus, a.image_caption, a.published, a.created_at, a.author_id, a.author_name, a.redacted, u.alias as author_alias, r.name as rubric_name, r.slug as rubric_slug, parent.name as parent_name, parent.slug as parent_slug";
const ARTICLE_FROM =
  "articles a left join users u on u.id = a.author_id left join rubrics r on r.id = a.rubric_id left join rubrics parent on parent.id = r.parent_id";

let schemaReady = false;

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

export function byline(person) {
  if (!person) return "";
  const alias = String(person.alias ?? person.authorAlias ?? "").trim();
  if (alias) return alias;
  return String(person.name ?? person.authorName ?? "").trim();
}

export function knownPermissions(values) {
  const allowed = new Set(PERMISSIONS.map((item) => item.code));
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map((item) => String(item)))].filter((code) => allowed.has(code));
}

function mapArticle(row) {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    excerpt: String(row.excerpt),
    body: String(row.body),
    category: row.rubric_name ? String(row.rubric_name) : String(row.category),
    rubricId: row.rubric_id == null || row.rubric_id === "" ? null : Number(row.rubric_id),
    parentName: row.parent_name ? String(row.parent_name) : "",
    rubricSlug: row.rubric_slug ? String(row.rubric_slug) : "",
    parentSlug: row.parent_slug ? String(row.parent_slug) : "",
    imageKey: row.image_key ? String(row.image_key) : null,
    imageFocus: String(row.image_focus ?? ""),
    imageCaption: String(row.image_caption ?? ""),
    published: asBool(row.published),
    createdOn: String(row.created_at ?? "").slice(0, 10),
    authorId: row.author_id == null || row.author_id === "" ? null : Number(row.author_id),
    authorName: String(row.author_name ?? ""),
    authorAlias: String(row.author_alias ?? "").trim(),
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

function mapYard(row) {
  const hours = parseHours(row.hours);
  return {
    id: Number(row.id),
    name: String(row.name),
    place: String(row.place ?? ""),
    accepts: String(row.accepts ?? ""),
    week: hours.week,
    legacy: hours.legacy,
    sortOrder: Number(row.sort_order ?? 0),
    published: asBool(row.published),
    closures: [],
  };
}

function mapClosure(row) {
  return {
    id: Number(row.id),
    yardId: Number(row.yard_id),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    reason: String(row.reason ?? ""),
    createdBy: row.created_by == null || row.created_by === "" ? null : Number(row.created_by),
  };
}

function mapDoctor(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    specialty: String(row.specialty ?? ""),
    place: String(row.place ?? ""),
    phone: String(row.phone ?? ""),
    week: parseDoctorHours(row.hours),
    sortOrder: Number(row.sort_order ?? 0),
    published: asBool(row.published),
    changes: [],
  };
}

function mapDoctorChange(row) {
  return {
    id: Number(row.id),
    doctorId: Number(row.doctor_id),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    note: String(row.note ?? ""),
    week: parseDoctorHours(row.hours),
    createdBy: row.created_by == null || row.created_by === "" ? null : Number(row.created_by),
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
    authorAlias: String(row.author_alias ?? "").trim(),
    title: String(row.title),
    excerpt: String(row.excerpt),
    body: String(row.body),
    category: row.rubric_name ? String(row.rubric_name) : String(row.category),
    rubricId: row.rubric_id == null || row.rubric_id === "" ? null : Number(row.rubric_id),
    parentName: row.parent_name ? String(row.parent_name) : "",
    imageKey: row.image_key ? String(row.image_key) : null,
    imageFocus: String(row.image_focus ?? ""),
    imageCaption: String(row.image_caption ?? ""),
    submittedTitle: String(row.submitted_title),
    submittedExcerpt: String(row.submitted_excerpt),
    submittedBody: String(row.submitted_body),
    submittedCategory: String(row.submitted_category),
    status: String(row.status),
    note: String(row.note ?? ""),
    createdOn: String(row.created_at ?? "").slice(0, 10),
    publishOn: String(row.publish_on ?? ""),
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

async function createDeskTables(env) {
  await env.DB.prepare(
    `create table if not exists users (
      id integer primary key autoincrement,
      login text not null unique,
      name text not null,
      alias text not null default '',
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
  await env.DB.prepare(
    `create table if not exists user_permissions (
      user_id integer not null,
      code text not null,
      primary key (user_id, code)
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists yards (
      id integer primary key autoincrement,
      name text not null,
      place text not null,
      accepts text not null,
      hours text not null,
      sort_order integer not null default 0,
      published integer not null default 1
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists yard_closures (
      id integer primary key autoincrement,
      yard_id integer not null,
      starts_on text not null,
      ends_on text not null,
      reason text not null,
      created_by integer,
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists doctors (
      id integer primary key autoincrement,
      name text not null,
      specialty text not null,
      place text not null,
      phone text not null default '',
      hours text not null,
      sort_order integer not null default 0,
      published integer not null default 1
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists doctor_changes (
      id integer primary key autoincrement,
      doctor_id integer not null,
      starts_on text not null,
      ends_on text not null,
      note text not null,
      hours text not null,
      created_by integer,
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists ads (
      id integer primary key autoincrement,
      slug text not null unique,
      title text not null,
      body text not null,
      place text not null default '',
      link text not null default '',
      image_key text,
      enabled integer not null default 1,
      sample integer not null default 0,
      author_id integer,
      author_name text not null default '',
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists ad_proposals (
      id integer primary key autoincrement,
      ad_id integer,
      author_id integer not null,
      author_name text not null,
      title text not null,
      body text not null,
      place text not null default '',
      link text not null default '',
      image_key text,
      enabled integer not null default 1,
      status text not null default 'pending',
      note text not null default '',
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists outage_areas (
      id integer primary key autoincrement,
      code text not null unique,
      name text not null,
      enabled integer not null default 1,
      sort_order integer not null default 100
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists outage_feed (
      id integer primary key,
      fetched_at text,
      status text not null default '',
      note text not null default '',
      payload text not null default '[]',
      fetching_at text
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists rubrics (
      id integer primary key autoincrement,
      parent_id integer,
      name text not null,
      slug text not null unique,
      sort_order integer not null default 0
    )`,
  ).run();
}

async function ensureUserColumns(env) {
  const info = await env.DB.prepare("pragma table_info(users)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "alias", "alter table users add column alias text not null default ''");
}

async function ensureArticleColumns(env) {
  const info = await env.DB.prepare("pragma table_info(articles)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "author_id", "alter table articles add column author_id integer");
  await addColumn(env, names, "author_name", "alter table articles add column author_name text not null default ''");
  await addColumn(env, names, "redacted", "alter table articles add column redacted integer not null default 0");
  await addColumn(env, names, "rubric_id", "alter table articles add column rubric_id integer");
  await addColumn(env, names, "image_focus", "alter table articles add column image_focus text not null default ''");
  await addColumn(env, names, "image_caption", "alter table articles add column image_caption text not null default ''");
}

async function ensureProposalColumns(env) {
  const info = await env.DB.prepare("pragma table_info(proposals)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "rubric_id", "alter table proposals add column rubric_id integer");
  await addColumn(env, names, "image_focus", "alter table proposals add column image_focus text not null default ''");
  await addColumn(env, names, "image_caption", "alter table proposals add column image_caption text not null default ''");
  // Datum, se kterým má zpráva po schválení vyjít (import podle data ve zdroji). Prázdné = den schválení.
  await addColumn(env, names, "publish_on", "alter table proposals add column publish_on text not null default ''");
}

async function seedRubrics(env) {
  for (const item of SEED_RUBRICS) {
    await env.DB.prepare(
      `insert into rubrics (parent_id, name, slug, sort_order)
       select null, ?, ?, ?
       where not exists (select 1 from rubrics where slug = ?)`,
    )
      .bind(item.name, item.slug, item.sortOrder, item.slug)
      .run();
  }
  for (const item of SEED_RUBRICS) {
    await env.DB.prepare(
      "update articles set rubric_id = (select id from rubrics where slug = ?) where rubric_id is null and category = ?",
    )
      .bind(item.slug, item.name)
      .run();
    await env.DB.prepare(
      "update proposals set rubric_id = (select id from rubrics where slug = ?) where rubric_id is null and category = ?",
    )
      .bind(item.slug, item.name)
      .run();
  }
  await env.DB.prepare(
    `update articles set rubric_id = (select id from rubrics where rubrics.name = articles.category)
     where rubric_id is null and exists (select 1 from rubrics where rubrics.name = articles.category)`,
  ).run();
  await env.DB.prepare(
    `update proposals set rubric_id = (select id from rubrics where rubrics.name = proposals.category)
     where rubric_id is null and exists (select 1 from rubrics where rubrics.name = proposals.category)`,
  ).run();
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

async function seedDoctors(env) {
  const info = await env.DB.prepare("pragma table_info(settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "doctors_seeded", "alter table settings add column doctors_seeded integer not null default 0");
  const flag = await env.DB.prepare("select doctors_seeded as done from settings where id = 1").first();
  if (Number(flag?.done) === 1) return;
  const count = await env.DB.prepare("select count(*) as n from doctors").first();
  if (Number(count?.n) === 0) {
    for (const doctor of DOCTOR_SEEDS) {
      await env.DB.prepare(
        "insert into doctors (name, specialty, place, phone, hours, sort_order, published) values (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          doctor.name,
          doctor.specialty,
          doctor.place,
          doctor.phone,
          JSON.stringify(doctor.week),
          doctor.sortOrder,
          doctor.published,
        )
        .run();
    }
  }
  await env.DB.prepare("update settings set doctors_seeded = 1 where id = 1").run();
}

async function seedOutages(env) {
  const info = await env.DB.prepare("pragma table_info(settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "outages_seeded", "alter table settings add column outages_seeded integer not null default 0");
  await env.DB.prepare(
    "insert into outage_feed (id, payload) select 1, '[]' where not exists (select 1 from outage_feed where id = 1)",
  ).run();
  const flag = await env.DB.prepare("select outages_seeded as done from settings where id = 1").first();
  if (Number(flag?.done) === 1) return;
  const count = await env.DB.prepare("select count(*) as n from outage_areas").first();
  if (Number(count?.n) === 0) {
    await env.DB.prepare("insert into outage_areas (code, name, enabled, sort_order) values (?, ?, 1, 0)")
      .bind(KOPIDLNO.code, KOPIDLNO.name)
      .run();
  }
  await env.DB.prepare("update settings set outages_seeded = 1 where id = 1").run();
}

async function demoImage(env, file) {
  if (!env.ASSETS?.fetch) return null;
  try {
    const response = await env.ASSETS.fetch(new Request(`https://local.invalid/demo-reklamy/${file}`));
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("image/")) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

async function seedAds(env) {
  const info = await env.DB.prepare("pragma table_info(settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "ads_seeded", "alter table settings add column ads_seeded integer not null default 0");
  const flag = await env.DB.prepare("select ads_seeded as done from settings where id = 1").first();
  if (Number(flag?.done) === 1) return;
  const count = await env.DB.prepare("select count(*) as n from ads").first();
  if (Number(count?.n) === 0) {
    const chief = await env.DB.prepare(
      "select id, name from users where role = 'hlavni' order by id asc limit 1",
    ).first();
    const authorId = chief?.id ?? null;
    const authorName = chief?.name ? String(chief.name) : "Redakce";
    for (const ad of AD_SEEDS) {
      const bytes = await demoImage(env, ad.image);
      let imageKey = null;
      if (bytes) {
        imageKey = `reklamy/demo-${ad.slug}.webp`;
        await env.BUCKET.put(imageKey, bytes, { httpMetadata: { contentType: "image/webp" } });
      }
      await env.DB.prepare(
        `insert into ads (slug, title, body, place, link, image_key, enabled, sample, author_id, author_name)
         values (?, ?, ?, ?, '', ?, 1, 1, ?, ?)`,
      )
        .bind(ad.slug, ad.title, ad.body, ad.place, imageKey, authorId, authorName)
        .run();
    }
  }
  await env.DB.prepare("update settings set ads_seeded = 1 where id = 1").run();
}

async function migrateSchema(env) {
  await createDeskTables(env);
  await ensureNoticeTables(env);
  await ensureImportTables(env);
  await ensureFootballTables(env);
  await ensureDrbenaTable(env);
  const settingsReady = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'settings'",
  ).first();
  if (settingsReady) {
    await seedDoctors(env);
    await seedOutages(env);
  }
  const usersTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'users'",
  ).first();
  if (usersTable) await ensureUserColumns(env);
  const settingsTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'settings'",
  ).first();
  if (!settingsTable) return false;
  const articlesTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'articles'",
  ).first();
  if (articlesTable) {
    await ensureArticleColumns(env);
    const proposalsTable = await env.DB.prepare(
      "select 1 as ok from sqlite_master where type = 'table' and name = 'proposals'",
    ).first();
    if (proposalsTable) await ensureProposalColumns(env);
    await seedRubrics(env);
  }
  await env.DB.prepare(
    `insert into users (login, name, password_hash, role)
     select 'redakce', 'Redakce', password_hash, 'hlavni' from settings
     where id = 1 and not exists (select 1 from users)`,
  ).run();
  await migrateSession(env);
  await seedAds(env);
  return true;
}

// Kontrola schématu jednou za instanci Workeru. Každý požadavek ji dělá sám, dokud jednou celá neproběhne.
// Nesdílet rozběhnutý slib mezi požadavky: když se požadavek, který ho spustil, zruší (zavřená stránka,
// obnovení), Cloudflare zruší i jeho dotazy, slib se nikdy nedokončí a všechny další požadavky by visely.
export async function ensureSchema(env) {
  if (schemaReady) return;
  if (await migrateSchema(env)) schemaReady = true;
}

async function attachPermissions(env, accounts) {
  if (!accounts.length) return accounts;
  const rows = (await env.DB.prepare("select user_id, code from user_permissions").all()).results ?? [];
  const byUser = new Map();
  for (const row of rows) {
    const id = Number(row.user_id);
    const list = byUser.get(id) ?? [];
    list.push(String(row.code));
    byUser.set(id, list);
  }
  return accounts.map((account) => ({ ...account, permissions: byUser.get(account.id) ?? [] }));
}

function readArticleFields(input) {
  const title = clip(input.title, 160);
  const excerpt = clip(input.excerpt, 320);
  const prepared = prepareArticleBody(clip(input.body, 20000));
  if (title.length < 3) return { error: "Doplňte nadpis." };
  if (excerpt.length < 3) return { error: "Doplňte krátký perex." };
  if (prepared.text.length < 3) return { error: "Doplňte text." };
  return {
    title,
    excerpt,
    body: prepared.html,
    imageFocus: readFocus(input.imageFocus),
    imageCaption: readCaption(input.imageCaption),
  };
}

async function resolveRubric(env, input) {
  const raw = Number(input.rubricId ?? input.rubric_id);
  if (Number.isInteger(raw) && raw > 0) {
    const row = await env.DB.prepare("select id, name from rubrics where id = ?").bind(raw).first();
    if (!row) return { error: "Vyberte rubriku." };
    return { rubricId: Number(row.id), category: String(row.name) };
  }
  const name = clip(input.category, 40);
  if (name) {
    const row = await env.DB.prepare("select id, name from rubrics where name = ?").bind(name).first();
    if (row) return { rubricId: Number(row.id), category: String(row.name) };
  }
  return { error: "Vyberte rubriku." };
}

async function readArticle(env, input) {
  const fields = readArticleFields(input);
  if (fields.error) return fields;
  const rubric = await resolveRubric(env, input);
  if (rubric.error) return rubric;
  return { ...fields, category: rubric.category, rubricId: rubric.rubricId };
}

async function loadProposals(env, whereSql, ...binds) {
  const query = env.DB.prepare(
    `select p.id, p.article_id, p.author_id, p.author_name, p.title, p.excerpt, p.body, p.category, p.rubric_id, p.image_key, p.image_focus, p.image_caption,
            p.submitted_title, p.submitted_excerpt, p.submitted_body, p.submitted_category, p.status, p.note, p.created_at, p.publish_on,
            a.slug as article_slug, a.title as article_title, u.alias as author_alias,
            r.name as rubric_name, parent.name as parent_name
     from proposals p
     left join articles a on a.id = p.article_id
     left join users u on u.id = p.author_id
     left join rubrics r on r.id = p.rubric_id
     left join rubrics parent on parent.id = r.parent_id
     ${whereSql}`,
  );
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  return (rows.results ?? []).map(mapProposal);
}

export async function loadYards(env, { publicOnly = false, today = null } = {}) {
  const yardSql = publicOnly
    ? `select id, name, place, accepts, hours, sort_order, published
       from yards where published = 1 order by sort_order asc, id asc`
    : `select id, name, place, accepts, hours, sort_order, published
       from yards order by sort_order asc, id asc`;
  const yards = ((await env.DB.prepare(yardSql).all()).results ?? []).map(mapYard);
  if (!yards.length) return [];
  let closureSql = "select id, yard_id, starts_on, ends_on, reason, created_by from yard_closures";
  const binds = [];
  if (today) {
    closureSql += " where ends_on >= ?";
    binds.push(today);
  }
  closureSql += " order by starts_on asc, id asc";
  const query = env.DB.prepare(closureSql);
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  const byYard = new Map(yards.map((yard) => [yard.id, yard]));
  for (const row of rows.results ?? []) {
    const closure = mapClosure(row);
    const yard = byYard.get(closure.yardId);
    if (yard) yard.closures.push(closure);
  }
  return yards;
}

export async function loadDoctors(env, { publicOnly = false, today = null } = {}) {
  const doctorSql = publicOnly
    ? `select id, name, specialty, place, phone, hours, sort_order, published
       from doctors where published = 1 order by sort_order asc, id asc`
    : `select id, name, specialty, place, phone, hours, sort_order, published
       from doctors order by sort_order asc, id asc`;
  const doctors = ((await env.DB.prepare(doctorSql).all()).results ?? []).map(mapDoctor);
  if (!doctors.length) return [];
  let changeSql = "select id, doctor_id, starts_on, ends_on, note, hours, created_by from doctor_changes";
  const binds = [];
  if (today) {
    changeSql += " where ends_on >= ?";
    binds.push(today);
  }
  changeSql += " order by starts_on asc, id asc";
  const query = env.DB.prepare(changeSql);
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  const byDoctor = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  for (const row of rows.results ?? []) {
    const change = mapDoctorChange(row);
    const doctor = byDoctor.get(change.doctorId);
    if (doctor) doctor.changes.push(change);
  }
  return doctors;
}

function mapRubric(row, articleCount = 0) {
  return {
    id: Number(row.id),
    parentId: row.parent_id == null || row.parent_id === "" ? null : Number(row.parent_id),
    name: String(row.name),
    slug: String(row.slug),
    sortOrder: Number(row.sort_order ?? 0),
    articleCount,
  };
}

export async function loadRubrics(env) {
  const rows =
    (await env.DB.prepare("select id, parent_id, name, slug, sort_order from rubrics order by sort_order asc, id asc").all())
      .results ?? [];
  const counts =
    (
      await env.DB.prepare(
        "select rubric_id as id, count(*) as n from articles where rubric_id is not null group by rubric_id",
      ).all()
    ).results ?? [];
  const byId = new Map(counts.map((row) => [Number(row.id), Number(row.n)]));
  return rows.map((row) => mapRubric(row, byId.get(Number(row.id)) ?? 0));
}

export async function loadPublic(env) {
  const row = await settings(env);
  const now = pragueNow();
  const today = now.date;
  const articles = (
    await env.DB.prepare(
      `select ${ARTICLE_FIELDS}
       from ${ARTICLE_FROM} where a.published = 1 order by a.created_at desc, a.id desc`,
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
    yards: await loadYards(env, { publicOnly: true, today }),
    doctors: await loadDoctors(env, { publicOnly: true, today }),
    ads: await loadAds(env, { enabledOnly: true }),
    outages: await loadOutageBoard(env),
    water: await loadNoticeBoard(env),
    waste: buildWasteView(wasteFrom(row), today),
    now,
    contactNote: String(row.contact_note),
    showDefaultPassword: asBool(row.password_is_default),
    rubrics: await loadRubrics(env),
  };
}

export async function loadArticle(env, slug) {
  const row = await env.DB.prepare(
    `select ${ARTICLE_FIELDS}
     from ${ARTICLE_FROM} where a.slug = ? and a.published = 1`,
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
    yards: [],
    doctors: [],
    ads: [],
    adProposals: [],
    outageAreas: [],
    outages: emptyOutageBoard(),
    notices: [],
    importSettings: null,
    importItems: [],
    footballSettings: null,
    footballItems: [],
    drbena: null,
    rubrics: [],
  };
  if (!user) return base;
  base.rubrics = await loadRubrics(env);
  base.ads = await loadAds(env);
  base.adProposals =
    user.role === "hlavni"
      ? await loadAdProposals(env, "where p.status = 'pending' order by p.id asc")
      : await loadAdProposals(
          env,
          "where p.author_id = ? and p.status in ('pending', 'rejected') order by p.id desc",
          user.id,
        );
  const articleSql =
    user.role === "hlavni"
      ? `select ${ARTICLE_FIELDS} from ${ARTICLE_FROM} order by a.created_at desc, a.id desc`
      : `select ${ARTICLE_FIELDS} from ${ARTICLE_FROM} where a.published = 1 order by a.created_at desc, a.id desc`;
  base.articles = (await env.DB.prepare(articleSql).all()).results.map(mapArticle);
  if (user.role === "hlavni" || userCan(user, "sberny_dvur")) {
    base.yards = await loadYards(env, { publicOnly: user.role !== "hlavni" });
  }
  if (user.role === "hlavni" || userCan(user, "doktori")) {
    const now = pragueNow();
    base.doctors = await loadDoctors(env, { publicOnly: user.role !== "hlavni", today: now.date });
  }
  if (user.role === "hlavni") {
    base.outageAreas = await loadOutageAreas(env);
    base.outages = await loadOutageBoard(env);
    base.notices = await loadNotices(env);
    base.importSettings = await loadImportSettings(env);
    base.importItems = await loadImportItems(env);
    base.footballSettings = await loadFootballSettings(env);
    base.footballItems = await loadFootballItems(env);
    base.drbena = await loadDrbena(env);
    base.hasApiKey = Boolean(env.ANTHROPIC_API_KEY);
    base.events = (
      await env.DB.prepare(
        `select id, title, place, starts_on, starts_time, description, published
         from events order by starts_on asc, starts_time asc, id asc`,
      ).all()
    ).results.map(mapEvent);
    base.users = await attachPermissions(
      env,
      (
        await env.DB.prepare(
          "select id, login, name, alias, role, active from users order by case role when 'hlavni' then 0 else 1 end, name",
        ).all()
      ).results.map((row) => mapAccount(row)),
    );
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

function readAlias(value) {
  const alias = clip(value, 60);
  if (alias && alias.length < 2) {
    return { error: "Alias musí mít aspoň 2 znaky. Když ho nechcete, nechte pole prázdné." };
  }
  return { alias };
}

export async function saveProfile(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const next = clip(input.name, 60);
  if (next.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  const alias = readAlias(input.alias);
  if (alias.error) return { ok: false, error: alias.error };
  await env.DB.prepare("update users set name = ?, alias = ? where id = ?")
    .bind(next, alias.alias, gate.user.id)
    .run();
  return { ok: true };
}

async function writePermissions(env, userId, codes) {
  await env.DB.prepare("delete from user_permissions where user_id = ?").bind(userId).run();
  for (const code of codes) {
    await env.DB.prepare("insert into user_permissions (user_id, code) values (?, ?)").bind(userId, code).run();
  }
}

export async function saveArticle(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = await readArticle(env, input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const stored = await storeImage(env, input.image);
  if (stored.error) return { ok: false, error: stored.error };
  const { title, excerpt, body, category, rubricId, imageFocus, imageCaption } = parsed;

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
      `update articles set title = ?, excerpt = ?, body = ?, category = ?, rubric_id = ?, published = ?, image_key = ?,
         image_focus = ?, image_caption = ?, redacted = ? where id = ?`,
    )
      .bind(title, excerpt, body, category, rubricId, input.published ? 1 : 0, imageKey, imageFocus, imageCaption, redacted, input.id)
      .run();
    if (stored.key && previous && previous !== stored.key) await releaseImage(env, previous);
    return { ok: true };
  }

  const slug = await uniqueSlug(env, slugify(title));
  await env.DB.prepare(
    `insert into articles (slug, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, published, created_at, author_id, author_name, redacted)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?, ?, 0)`,
  )
    .bind(slug, title, excerpt, body, category, rubricId, stored.key, imageFocus, imageCaption, input.published ? 1 : 0, gate.user.id, gate.user.name)
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

  const stored = await storeImage(env, input.image);
  if (stored.error) return { ok: false, error: stored.error };

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
  await releaseImage(env, row.image_key ? String(row.image_key) : null);
  return { ok: true };
}

export async function approveProposal(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!input.id) return { ok: false, error: "Ten návrh už tu není." };
  const proposal = await env.DB.prepare(
    `select id, article_id, author_id, author_name, image_key, submitted_title, submitted_excerpt,
            submitted_body, submitted_category, status, publish_on
     from proposals where id = ?`,
  )
    .bind(input.id)
    .first();
  if (!proposal || proposal.status !== "pending") return { ok: false, error: "Ten návrh už tu není." };
  const parsed = await readArticle(env, input);
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
    await env.DB.prepare(
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

export async function createContributor(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const name = clip(input.name, 60);
  const loginName = normalizeLogin(input.login);
  const password = String(input.password ?? "").trim();
  const alias = readAlias(input.alias);
  if (name.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  if (alias.error) return { ok: false, error: alias.error };
  if (!/^[a-z0-9]{3,32}$/.test(loginName)) {
    return { ok: false, error: "Přihlašovací jméno může mít 3 až 32 znaků: malá písmena a číslice." };
  }
  if (password.length < 8) return { ok: false, error: "Heslo musí mít aspoň 8 znaků." };
  const existing = await env.DB.prepare("select id from users where login = ?").bind(loginName).first();
  if (existing) return { ok: false, error: "Tohle přihlašovací jméno už někdo má." };
  await env.DB.prepare(
    "insert into users (login, name, alias, password_hash, role) values (?, ?, ?, ?, 'prispevovatel')",
  )
    .bind(loginName, name, alias.alias, await hashPassword(password))
    .run();
  const created = await env.DB.prepare("select id from users where login = ?").bind(loginName).first();
  if (created) await writePermissions(env, created.id, knownPermissions(input.permissions));
  return { ok: true };
}

export async function saveContributorAccess(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const row = await env.DB.prepare("select id, role from users where id = ?").bind(input.id).first();
  if (!row) return { ok: false, error: "Ten účet už tu není." };
  if (row.role === "hlavni") return { ok: false, error: "Hlavní redaktor má všechna oprávnění." };
  const alias = readAlias(input.alias);
  if (alias.error) return { ok: false, error: alias.error };
  await env.DB.prepare("update users set alias = ? where id = ?").bind(alias.alias, row.id).run();
  await writePermissions(env, row.id, knownPermissions(input.permissions));
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
  if (row.role !== "prispevovatel") return { ok: false, error: "Heslo hlavního redaktora se mění v sekci Můj účet." };
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

function readYard(input) {
  const name = clip(input.name, 120);
  const place = clip(input.place, 160);
  const accepts = clip(input.accepts, 1200);
  const normalized = normalizeWeek(input.week);
  if (normalized.error) return normalized;
  const hours = JSON.stringify(normalized.week);
  const sortOrder = Number(input.sortOrder);
  if (name.length < 2) return { error: "Doplňte název sběrného dvora." };
  if (place.length < 2) return { error: "Doplňte místo." };
  if (accepts.length < 3) return { error: "Napište, co se tam vozí." };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { error: "Pořadí musí být číslo od 0 do 999." };
  }
  return { name, place, accepts, hours, sortOrder, published: input.published ? 1 : 0 };
}

export async function saveYard(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = readYard(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  if (input.id) {
    const current = await env.DB.prepare("select id from yards where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tenhle sběrný dvůr už tu není." };
    await env.DB.prepare(
      "update yards set name = ?, place = ?, accepts = ?, hours = ?, sort_order = ?, published = ? where id = ?",
    )
      .bind(parsed.name, parsed.place, parsed.accepts, parsed.hours, parsed.sortOrder, parsed.published, input.id)
      .run();
    return { ok: true, updated: true };
  }
  await env.DB.prepare(
    "insert into yards (name, place, accepts, hours, sort_order, published) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(parsed.name, parsed.place, parsed.accepts, parsed.hours, parsed.sortOrder, parsed.published)
    .run();
  return { ok: true, updated: false };
}

export async function removeYard(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from yard_closures where yard_id = ?").bind(id).run();
  await env.DB.prepare("delete from yards where id = ?").bind(id).run();
  return { ok: true };
}

async function requireClosure(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (!userCan(gate.user, "sberny_dvur")) {
    return { ok: false, error: "Mimořádné uzavření zapíše hlavní redaktor, nebo člověk s oprávněním na sběrný dvůr." };
  }
  return gate;
}

export async function saveClosure(env, request, input) {
  const gate = await requireClosure(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const yard = await env.DB.prepare("select id from yards where id = ?").bind(input.yardId).first();
  if (!yard) return { ok: false, error: "Tenhle sběrný dvůr už tu není." };
  const span = closureSpan(input.startsOn, input.endsOn);
  if (span.error) return { ok: false, error: span.error };
  const reason = clip(input.reason, 400);
  if (reason.length < 3) return { ok: false, error: "Napište důvod uzavření." };
  await env.DB.prepare(
    "insert into yard_closures (yard_id, starts_on, ends_on, reason, created_by) values (?, ?, ?, ?, ?)",
  )
    .bind(yard.id, span.startsOn, span.endsOn, reason, gate.user.id)
    .run();
  return { ok: true };
}

export async function removeClosure(env, request, id) {
  const gate = await requireClosure(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from yard_closures where id = ?").bind(id).run();
  return { ok: true };
}

function readDoctor(input) {
  const name = clip(input.name, 120);
  const specialty = clip(input.specialty, 120);
  const place = clip(input.place, 160);
  const phone = clip(input.phone, 40);
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return normalized;
  const sortOrder = Number(input.sortOrder);
  if (name.length < 2) return { error: "Doplňte jméno lékaře nebo ordinace." };
  if (specialty.length < 2) return { error: "Doplňte obor." };
  if (place.length < 2) return { error: "Doplňte místo." };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { error: "Pořadí musí být číslo od 0 do 999." };
  }
  return {
    name,
    specialty,
    place,
    phone,
    hours: JSON.stringify(normalized.week),
    sortOrder,
    published: input.published ? 1 : 0,
  };
}

export async function saveDoctor(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = readDoctor(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  if (input.id) {
    const current = await env.DB.prepare("select id from doctors where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tahle ordinace už tu není." };
    await env.DB.prepare(
      "update doctors set name = ?, specialty = ?, place = ?, phone = ?, hours = ?, sort_order = ?, published = ? where id = ?",
    )
      .bind(parsed.name, parsed.specialty, parsed.place, parsed.phone, parsed.hours, parsed.sortOrder, parsed.published, input.id)
      .run();
    return { ok: true, updated: true };
  }
  await env.DB.prepare(
    "insert into doctors (name, specialty, place, phone, hours, sort_order, published) values (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(parsed.name, parsed.specialty, parsed.place, parsed.phone, parsed.hours, parsed.sortOrder, parsed.published)
    .run();
  return { ok: true, updated: false };
}

export async function removeDoctor(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from doctor_changes where doctor_id = ?").bind(id).run();
  await env.DB.prepare("delete from doctors where id = ?").bind(id).run();
  return { ok: true };
}

async function requireDoctorHours(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (!userCan(gate.user, "doktori")) {
    return { ok: false, error: "Ordinační hodiny mění hlavní redaktor, nebo člověk s oprávněním Lékaři." };
  }
  return gate;
}

export async function saveDoctorHours(env, request, input) {
  const gate = await requireDoctorHours(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const doctor = await env.DB.prepare("select id from doctors where id = ?").bind(input.doctorId).first();
  if (!doctor) return { ok: false, error: "Tahle ordinace už tu není." };
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return { ok: false, error: normalized.error };
  await env.DB.prepare("update doctors set hours = ? where id = ?").bind(JSON.stringify(normalized.week), doctor.id).run();
  return { ok: true };
}

export async function saveDoctorChange(env, request, input) {
  const gate = await requireDoctorHours(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const doctor = await env.DB.prepare("select id from doctors where id = ?").bind(input.doctorId).first();
  if (!doctor) return { ok: false, error: "Tahle ordinace už tu není." };
  const span = changeSpan(input.startsOn, input.endsOn);
  if (span.error) return { ok: false, error: span.error };
  const note = clip(input.changeNote, 400);
  if (note.length < 3) return { ok: false, error: "Napište poznámku k dočasné změně." };
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return { ok: false, error: normalized.error };
  await env.DB.prepare(
    "insert into doctor_changes (doctor_id, starts_on, ends_on, note, hours, created_by) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(doctor.id, span.startsOn, span.endsOn, note, JSON.stringify(normalized.week), gate.user.id)
    .run();
  return { ok: true };
}

export async function removeDoctorChange(env, request, id) {
  const gate = await requireDoctorHours(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from doctor_changes where id = ?").bind(id).run();
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
  const wasteNote = clip(input.wasteNote, 800);
  const holidayNote = clip(input.holidayNote, 160);
  if (wasteNote.length < 3) return { ok: false, error: "Doplňte vysvětlení svozu." };
  await env.DB.prepare(
    `update settings set waste_note = ?, holiday_note = ?, weekday = ?, week_parity = ?, step_days = ? where id = 1`,
  )
    .bind(wasteNote, holidayNote, weekday, weekParity, stepDays)
    .run();
  return { ok: true };
}

async function uniqueRubricSlug(env, base) {
  let slug = base;
  let n = 2;
  for (;;) {
    const row = await env.DB.prepare("select id from rubrics where slug = ?").bind(slug).first();
    if (!row) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

function rubricSlugBase(name) {
  const slug = slugify(name);
  return slug === "prispevek" ? "rubrika" : slug;
}

async function renameRubricLabels(env, id, previous, name) {
  await env.DB.batch([
    env.DB.prepare("update articles set category = ? where rubric_id = ? or (rubric_id is null and category = ?)").bind(
      name,
      id,
      previous,
    ),
    env.DB.prepare("update proposals set category = ? where rubric_id = ? or (rubric_id is null and category = ?)").bind(
      name,
      id,
      previous,
    ),
    env.DB.prepare(
      "update proposals set submitted_category = ? where rubric_id = ? or (rubric_id is null and submitted_category = ?)",
    ).bind(name, id, previous),
  ]);
}

export async function saveRubric(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const rubrics = await loadRubrics(env);
  const parsed = parseRubricInput(input, rubrics);
  if (parsed.error) return { ok: false, error: parsed.error };
  if (input.id) {
    const current = rubrics.find((item) => item.id === Number(input.id));
    if (!current) return { ok: false, error: "Tahle rubrika už tu není." };
    await env.DB.prepare("update rubrics set name = ?, parent_id = ?, sort_order = ? where id = ?")
      .bind(parsed.name, parsed.parentId, parsed.sortOrder, current.id)
      .run();
    if (current.name !== parsed.name) await renameRubricLabels(env, current.id, current.name, parsed.name);
    return { ok: true, updated: true };
  }
  const slug = await uniqueRubricSlug(env, rubricSlugBase(parsed.name));
  try {
    await env.DB.prepare("insert into rubrics (parent_id, name, slug, sort_order) values (?, ?, ?, ?)").bind(
      parsed.parentId,
      parsed.name,
      slug,
      parsed.sortOrder,
    ).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) return { ok: false, error: "Rubrika s tímhle názvem už je." };
    throw error;
  }
  return { ok: true, updated: false };
}

export async function removeRubric(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const row = await env.DB.prepare("select id, parent_id, name from rubrics where id = ?").bind(id).first();
  if (!row) return { ok: false, error: "Tahle rubrika už tu není." };
  const rubric = {
    id: Number(row.id),
    parentId: row.parent_id == null || row.parent_id === "" ? null : Number(row.parent_id),
    name: String(row.name),
  };
  const children = await env.DB.prepare("select count(*) as n from rubrics where parent_id = ?").bind(id).first();
  const articles = await env.DB.prepare(
    "select count(*) as n from articles where rubric_id = ? or (rubric_id is null and category = ?)",
  )
    .bind(id, rubric.name)
    .first();
  const proposals = await env.DB.prepare(
    `select count(*) as n from proposals
     where status in ('pending', 'rejected') and (rubric_id = ? or category = ? or submitted_category = ?)`,
  )
    .bind(id, rubric.name, rubric.name)
    .first();
  const tops = await env.DB.prepare("select count(*) as n from rubrics where parent_id is null").first();
  const error = deleteRubricError(rubric, {
    children: Number(children?.n ?? 0),
    articles: Number(articles?.n ?? 0),
    proposals: Number(proposals?.n ?? 0),
    topLevel: Number(tops?.n ?? 0),
  });
  if (error) return { ok: false, error };
  await env.DB.prepare("delete from rubrics where id = ?").bind(id).run();
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
  const contactNote = clip(form.get("contactNote"), 600);
  if (contactNote.length < 3) return { ok: false, error: "Doplňte kontakt na stránce O nás." };
  const statements = [env.DB.prepare("update settings set contact_note = ? where id = 1").bind(contactNote)];
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
