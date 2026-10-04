import { loadAdProposals, loadAds } from "./ads-db.js";
import { COPY, WELCOME_VERSION } from "./copy.js";
import { attachmentKeys, formAttachments, readAttachments } from "./attachments.js";
import { releaseImage } from "./images.js";
import { formImage, loadStock } from "./stock-db.js";
import { readCaption, readFocus } from "./photo.js";
import { prepareArticleBody } from "./rich.js";
import { buildWasteView, pragueNow } from "./waste.js";
import { isoDate } from "./notices.js";
import { loadPlaces } from "./places-db.js";
import { loadDoctors } from "./doctors-db.js";
import { loadYards } from "./yards-db.js";
import { emptyOutageBoard, loadOutageAreas, loadOutageBoard } from "./outages-db.js";
import {
  asBool,
  clip,
  identify,
  liveArticle,
  reopenImports,
  requireChief,
  slugify,
  uniqueSlug,
  userCan,
} from "./db-core.js";
import { loadNoticeBoard, loadNotices } from "./notices-db.js";
import { loadClosures, loadNdicSettings } from "./ndic/store.js";
import { pushConfig } from "./ndic/push.js";
import { BOT_LOGIN, loadImportItems, loadImportSettings } from "./munipolis/store.js";
import { loadFootballItems, loadFootballSettings } from "./fotbal/store.js";
import { loadDenikItems, loadDenikSettings } from "./denik/store.js";
import { SCHOOL_LIST } from "./skola/sources.js";
import { loadSkolaItems, loadSkolaSettings } from "./skola/store.js";
import { loadDrbena } from "./drbena-db.js";
import { attachArticle, forgetArticle, loadEvents } from "./events-db.js";
import { countNewMessages } from "./messages-db.js";
import { loadUsers } from "./users-db.js";
import { accessConfig } from "./access.js";
import { SEED_RUBRICS, deleteRubricError, parseRubricInput } from "./rubrics.js";

export const CATEGORIES = SEED_RUBRICS.map((item) => item.name);
export { clearCookie, readCookie, sessionCookie, userCan } from "./db-core.js";
export {
  PERMISSIONS,
  changePassword,
  createContributor,
  knownPermissions,
  login,
  logout,
  saveContributorAccess,
  saveProfile,
  setContributorActive,
  setContributorPassword,
} from "./users-db.js";
export {
  addOutageArea,
  loadOutageBoard,
  refreshOutages,
  removeOutageArea,
  saveOutageAreas,
} from "./outages-db.js";
export { ensureSchema } from "./schema.js";
export { loadYards, removeClosure, removeYard, saveClosure, saveYard } from "./yards-db.js";
export { loadDoctors, removeDoctor, removeDoctorChange, saveDoctor, saveDoctorChange, saveDoctorHours } from "./doctors-db.js";
const ARTICLE_FIELDS =
  "a.id, a.slug, a.title, a.excerpt, a.body, a.category, a.rubric_id, a.image_key, a.image_focus, a.image_caption, a.attachments, a.published, a.created_at, a.author_id, a.author_name, a.redacted, u.alias as author_alias, r.name as rubric_name, r.slug as rubric_slug, parent.name as parent_name, parent.slug as parent_slug";
// Seznamy zpráv text nepotřebují, ten je jen v detailu a v redakci.
const ARTICLE_LIST_FIELDS = ARTICLE_FIELDS.replace("a.body, ", "").replace("a.attachments, ", "");
const ARTICLE_FROM =
  "articles a left join users u on u.id = a.author_id left join rubrics r on r.id = a.rubric_id left join rubrics parent on parent.id = r.parent_id";

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

function mapArticle(row) {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    excerpt: String(row.excerpt),
    body: String(row.body ?? ""),
    category: row.rubric_name ? String(row.rubric_name) : String(row.category),
    rubricId: row.rubric_id == null || row.rubric_id === "" ? null : Number(row.rubric_id),
    parentName: row.parent_name ? String(row.parent_name) : "",
    rubricSlug: row.rubric_slug ? String(row.rubric_slug) : "",
    parentSlug: row.parent_slug ? String(row.parent_slug) : "",
    imageKey: row.image_key ? String(row.image_key) : null,
    imageFocus: String(row.image_focus ?? ""),
    imageCaption: String(row.image_caption ?? ""),
    attachments: readAttachments(row.attachments),
    published: asBool(row.published),
    createdOn: String(row.created_at ?? "").slice(0, 10),
    authorId: row.author_id == null || row.author_id === "" ? null : Number(row.author_id),
    authorName: String(row.author_name ?? ""),
    authorAlias: String(row.author_alias ?? "").trim(),
    redacted: asBool(row.redacted),
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
    attachments: readAttachments(row.attachments),
    // Návrh úpravy zprávy z doby před přílohami od lidí přílohy nemá, platí ty ze zprávy (src/proposals-db.js).
    ownAttachments: !row.article_id || String(row.attachments ?? "") !== "",
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

export async function readArticle(env, input) {
  const fields = readArticleFields(input);
  if (fields.error) return fields;
  const rubric = await resolveRubric(env, input);
  if (rubric.error) return rubric;
  return { ...fields, category: rubric.category, rubricId: rubric.rubricId };
}

async function loadProposals(env, whereSql, ...binds) {
  const query = env.DB.prepare(
    `select p.id, p.article_id, p.author_id, p.author_name, p.title, p.excerpt, p.body, p.category, p.rubric_id, p.image_key, p.image_focus, p.image_caption, p.attachments,
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
  const [rows, counts] = await Promise.all([
    env.DB.prepare("select id, parent_id, name, slug, sort_order from rubrics order by sort_order asc, id asc").all(),
    env.DB.prepare("select rubric_id as id, count(*) as n from articles where rubric_id is not null group by rubric_id").all(),
  ]);
  const byId = new Map((counts.results ?? []).map((row) => [Number(row.id), Number(row.n)]));
  return (rows.results ?? []).map((row) => mapRubric(row, byId.get(Number(row.id)) ?? 0));
}

// Veřejné stránky: všechno najednou, dotazy na sobě nezávisí.
export async function loadPublic(env) {
  const now = pragueNow();
  const today = now.date;
  const [row, articles, events, yards, doctors, places, ads, outages, notices, rubrics] = await Promise.all([
    settings(env),
    env.DB.prepare(
      `select ${ARTICLE_LIST_FIELDS}
       from ${ARTICLE_FROM} where ${liveArticle()} order by a.created_at desc, a.id desc`,
    ).all(),
    loadEvents(env, { publicOnly: true }),
    loadYards(env, { publicOnly: true, today }),
    loadDoctors(env, { publicOnly: true, today }),
    loadPlaces(env, { publicOnly: true, today }),
    loadAds(env, { enabledOnly: true }),
    loadOutageBoard(env),
    loadNoticeBoard(env),
    loadRubrics(env),
  ]);
  return {
    articles: articles.results.map(mapArticle),
    events,
    yards,
    doctors,
    places,
    ads,
    outages,
    notices,
    waste: buildWasteView(wasteFrom(row), today),
    now,
    contactNote: String(row.contact_note),
    showDefaultPassword: asBool(row.password_is_default),
    rubrics,
  };
}

export async function loadArticle(env, slug) {
  const row = await env.DB.prepare(
    `select ${ARTICLE_FIELDS}
     from ${ARTICLE_FROM} where a.slug = ? and ${liveArticle()}`,
  )
    .bind(slug)
    .first();
  return row ? mapArticle(row) : null;
}

// Další zprávy do bočního sloupce u zprávy: nejnovější kromě té otevřené.
export async function loadMoreArticles(env, slug, limit = 5) {
  const { results } = await env.DB.prepare(
    `select ${ARTICLE_LIST_FIELDS}
     from ${ARTICLE_FROM} where ${liveArticle()} and a.slug != ? order by a.created_at desc, a.id desc limit ?`,
  )
    .bind(slug, limit)
    .all();
  return results.map(mapArticle);
}

// Nastavení a články všech škol podle značky (skola, zahradka).
async function loadSchools(env) {
  const entries = await Promise.all(
    SCHOOL_LIST.map(async (source) => [source.tag, { settings: await loadSkolaSettings(env, source), items: await loadSkolaItems(env, source) }]),
  );
  return Object.fromEntries(entries);
}

// Části redakce jen pro hlavního redaktora.
async function loadChiefDesk(env) {
  const [outageAreas, outages, notices, ndicSettings, closures, importSettings, importItems, footballSettings, footballItems, denikSettings, denikItems, schools, drbena, events, users] =
    await Promise.all([
      loadOutageAreas(env),
      loadOutageBoard(env),
      loadNotices(env),
      loadNdicSettings(env),
      loadClosures(env),
      loadImportSettings(env),
      loadImportItems(env),
      loadFootballSettings(env),
      loadFootballItems(env),
      loadDenikSettings(env),
      loadDenikItems(env),
      loadSchools(env),
      loadDrbena(env),
      loadEvents(env),
      loadUsers(env),
    ]);
  return {
    outageAreas,
    outages,
    notices,
    ndic: { ...ndicSettings, ready: Boolean(pushConfig(env)), closures },
    importSettings,
    importItems,
    footballSettings,
    footballItems,
    denikSettings,
    denikItems,
    schools,
    drbena,
    events,
    users,
  };
}

export async function loadAdmin(env, request) {
  const [row, { user, email }] = await Promise.all([settings(env), identify(env, request)]);
  const access = Boolean(accessConfig(env));
  const base = {
    signedIn: Boolean(user),
    user,
    access,
    accessEmail: email,
    showDefaultPassword: !access && asBool(row.password_is_default),
    waste: buildWasteView(wasteFrom(row)),
    contactNote: String(row.contact_note),
    articles: [],
    events: [],
    proposals: [],
    botProposals: [],
    users: [],
    yards: [],
    doctors: [],
    places: [],
    ads: [],
    adProposals: [],
    outageAreas: [],
    outages: emptyOutageBoard(),
    notices: [],
    importSettings: null,
    importItems: [],
    footballSettings: null,
    footballItems: [],
    denikSettings: null,
    denikItems: [],
    schools: {},
    drbena: null,
    rubrics: [],
    stock: { topics: [], fallbackTopicId: null },
    newMessages: 0,
  };
  if (!user) return base;
  // Všechno najednou; co uživatel nesmí vidět, se nenačítá.
  const chief = user.role === "hlavni";
  const when = (allowed, load, fallback) => (allowed ? load() : fallback);
  const mine = ["where p.author_id = ? and p.status in ('pending', 'rejected') order by p.id desc", user.id];
  const articleSql = chief
    ? `select ${ARTICLE_FIELDS} from ${ARTICLE_FROM} order by a.created_at desc, a.id desc`
    : `select ${ARTICLE_FIELDS} from ${ARTICLE_FROM} where ${liveArticle()} order by a.created_at desc, a.id desc`;
  const [rubrics, ads, adProposals, articles, yards, doctors, places, proposals, botProposals, desk, stock, newMessages] = await Promise.all([
    loadRubrics(env),
    loadAds(env),
    chief ? loadAdProposals(env, "where p.status = 'pending' order by p.id asc") : loadAdProposals(env, ...mine),
    env.DB.prepare(articleSql).all(),
    when(chief || userCan(user, "sberny_dvur"), () => loadYards(env, { publicOnly: !chief }), base.yards),
    when(
      chief || userCan(user, "doktori"),
      () => loadDoctors(env, { publicOnly: !chief, today: pragueNow().date }),
      base.doctors,
    ),
    when(chief || userCan(user, "oteviraci_doba"), () => loadPlaces(env, { publicOnly: !chief }), base.places),
    chief ? loadProposals(env, "where p.status = 'pending' order by p.id asc") : loadProposals(env, ...mine),
    // Hlavní redaktor má návrhy od Drběny mezi ostatními v `proposals`.
    when(!chief && userCan(user, "drbena_navrhy"), () => loadProposals(env, "where p.status = 'pending' and u.login = ? order by p.id asc", BOT_LOGIN), base.botProposals),
    when(chief, () => loadChiefDesk(env), null),
    loadStock(env),
    when(userCan(user, "vzkazy"), () => countNewMessages(env), 0),
  ]);
  Object.assign(base, { rubrics, ads, adProposals, articles: articles.results.map(mapArticle), yards, doctors, places, proposals, botProposals, stock, newMessages });
  if (desk) Object.assign(base, desk, { hasApiKey: Boolean(env.ANTHROPIC_API_KEY) });
  return base;
}

// Datum zprávy z redakce. Prázdné nechá stávající (u nové dnešní). Datum v budoucnu je plánované zveřejnění.
export function readCreatedOn(value) {
  const text = String(value ?? "").trim();
  if (!text) return { date: null };
  const date = isoDate(text);
  if (!date) return { error: "Datum zprávy není platné." };
  return { date };
}

export async function saveArticle(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = await readArticle(env, input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const stored = await formImage(env, input);
  if (stored.error) return { ok: false, error: stored.error };
  Object.assign(parsed, stored.photo);
  const { title, excerpt, body, category, rubricId, imageFocus, imageCaption } = parsed;
  const createdOn = readCreatedOn(input.createdOn);
  if (createdOn.error) return { ok: false, error: createdOn.error };

  if (input.id) {
    const current = await env.DB.prepare(
      "select image_key, attachments, author_id, title, excerpt, body, category, redacted from articles where id = ?",
    )
      .bind(input.id)
      .first();
    if (!current) return { ok: false, error: "Tahle zpráva už tu není." };
    let imageKey = current.image_key ? String(current.image_key) : null;
    const previous = imageKey;
    if (stored.key) imageKey = stored.key;
    const authorIsOther = current.author_id && Number(current.author_id) !== gate.user.id;
    const edited = textWasEdited(
      {
        title: String(current.title),
        excerpt: String(current.excerpt),
        body: String(current.body),
        category: String(current.category),
      },
      { title, excerpt, body, category },
    );
    const redacted = (authorIsOther && edited) || asBool(current.redacted) ? 1 : 0;
    const attachments = await formAttachments(env, current.attachments, input);
    if (attachments.error) {
      await releaseImage(env, stored.key);
      return { ok: false, error: attachments.error };
    }
    // Po úpravě textu se klíčová slova smažou a cron je dopočítá znovu (src/keywords.js).
    await env.DB.prepare(
      `update articles set title = ?, excerpt = ?, body = ?, category = ?, rubric_id = ?, published = ?, image_key = ?,
         image_focus = ?, image_caption = ?, attachments = ?, redacted = ?, keywords = case when ? then '' else keywords end,
         created_at = case when ? is null or substr(created_at, 1, 10) = ? then created_at else ? end where id = ?`,
    )
      .bind(title, excerpt, body, category, rubricId, input.published ? 1 : 0, imageKey, imageFocus, imageCaption, attachments.json, redacted, edited ? 1 : 0, createdOn.date, createdOn.date, createdOn.date, input.id)
      .run();
    if (stored.key && previous && previous !== stored.key) await releaseImage(env, previous);
    for (const key of attachments.removed) await releaseImage(env, key);
    return { ok: true };
  }

  const attachments = await formAttachments(env, "", input);
  if (attachments.error) {
    await releaseImage(env, stored.key);
    return { ok: false, error: attachments.error };
  }
  const slug = await uniqueSlug(env, slugify(title));
  const inserted = await env.DB.prepare(
    `insert into articles (slug, title, excerpt, body, category, rubric_id, image_key, image_focus, image_caption, attachments, published, created_at, author_id, author_name, redacted)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(slug, title, excerpt, body, category, rubricId, stored.key, imageFocus, imageCaption, attachments.json, input.published ? 1 : 0, createdOn.date ?? pragueNow().date, gate.user.id, gate.user.name)
    .run();
  // Zpráva psaná k akci (z redakce akcí) se k ní rovnou připojí.
  await attachArticle(env, input.eventId, Number(inserted.meta?.last_row_id));
  return { ok: true };
}

export async function removeArticle(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const current = await env.DB.prepare("select image_key, attachments from articles where id = ?").bind(id).first();
  const proposals = (await env.DB.prepare("select id, image_key, attachments from proposals where article_id = ?").bind(id).all()).results ?? [];
  const keys = new Set();
  for (const row of [current, ...proposals]) {
    if (row?.image_key) keys.add(String(row.image_key));
    for (const key of attachmentKeys(row?.attachments)) keys.add(key);
  }
  await env.DB.prepare("delete from proposals where article_id = ?").bind(id).run();
  await env.DB.prepare("delete from articles where id = ?").bind(id).run();
  await forgetArticle(env, id);
  await reopenImports(env, { articleId: id, proposalIds: proposals.map((row) => row.id) });
  for (const key of keys) await releaseImage(env, key);
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
  copy[WELCOME_VERSION] = "1";
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
    if (item.url && value !== "-" && !/^https:\/\/[^\s"<>]+$/.test(value)) {
      return { ok: false, error: `${item.label}: napište celou adresu začínající https://, nebo pomlčku -.` };
    }
    statements.push(
      env.DB.prepare(
        "insert into copy (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
      ).bind(item.key, value),
    );
  }
  if (form.get("welcome_again")) {
    statements.push(
      env.DB.prepare(
        "insert into copy (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
      ).bind(WELCOME_VERSION, String(Date.now())),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch {
    return { ok: false, error: "Texty se neuložily. Spusťte znovu npm run nasadit, ať se v databázi doplní tabulka textů." };
  }
  return { ok: true, welcomeAgain: Boolean(form.get("welcome_again")) };
}
