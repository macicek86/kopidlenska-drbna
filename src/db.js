import { COPY } from "./copy.js";
import { hashPassword, verifyPassword } from "./password.js";
import { buildWasteView } from "./waste.js";

export const CATEGORIES = ["Zprávy", "Komunita", "Kultura", "Praktické", "Sport"];
export const POPELNICE_URL = "https://popelnice.kopidlenskadrbna.org/";
const COOKIE = "drbna_editor";

function clip(value, max) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function asBool(value) {
  return value === 1 || value === true || value === "1";
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

async function isEditor(env, request) {
  const token = readCookie(request);
  if (!token || token.length < 20) return false;
  const row = await env.DB.prepare("select 1 as ok from settings where id = 1 and session_token = ?")
    .bind(token)
    .first();
  return Boolean(row);
}

export async function loadPublic(env) {
  const row = await settings(env);
  const articles = (
    await env.DB.prepare(
      `select id, slug, title, excerpt, body, category, image_key, published, created_at
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
    `select id, slug, title, excerpt, body, category, image_key, published, created_at
     from articles where slug = ? and published = 1`,
  )
    .bind(slug)
    .first();
  return row ? mapArticle(row) : null;
}

export async function loadAdmin(env, request) {
  const row = await settings(env);
  const signedIn = await isEditor(env, request);
  const base = {
    signedIn,
    showDefaultPassword: asBool(row.password_is_default),
    waste: buildWasteView(wasteFrom(row)),
    contactNote: String(row.contact_note),
    articles: [],
    events: [],
  };
  if (!signedIn) return base;
  base.articles = (
    await env.DB.prepare(
      `select id, slug, title, excerpt, body, category, image_key, published, created_at
       from articles order by created_at desc, id desc`,
    ).all()
  ).results.map(mapArticle);
  base.events = (
    await env.DB.prepare(
      `select id, title, place, starts_on, starts_time, description, published
       from events order by starts_on asc, starts_time asc, id asc`,
    ).all()
  ).results.map(mapEvent);
  return base;
}

async function requireEditor(env, request) {
  if (!(await isEditor(env, request))) return "Přihlaste se do redakce.";
  return null;
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function login(env, password) {
  const row = await settings(env);
  if (!(await verifyPassword(password, row.password_hash))) return { ok: false, error: "Heslo nesedí." };
  const next = token();
  await env.DB.prepare("update settings set session_token = ? where id = 1").bind(next).run();
  return { ok: true, token: next };
}

export async function logout(env) {
  await env.DB.prepare("update settings set session_token = null where id = 1").run();
}

export async function changePassword(env, request, current, next) {
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
  if (next.trim().length < 8) return { ok: false, error: "Nové heslo musí mít aspoň 8 znaků." };
  const row = await settings(env);
  if (!(await verifyPassword(current, row.password_hash))) return { ok: false, error: "Současné heslo nesedí." };
  const session = token();
  await env.DB.prepare(
    "update settings set password_hash = ?, password_is_default = 0, session_token = ? where id = 1",
  )
    .bind(await hashPassword(next.trim()), session)
    .run();
  return { ok: true, token: session };
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

export async function saveArticle(env, request, input) {
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
  const title = clip(input.title, 160);
  const excerpt = clip(input.excerpt, 320);
  const body = clip(input.body, 12000);
  const category = CATEGORIES.includes(input.category) ? input.category : "Zprávy";
  if (title.length < 3) return { ok: false, error: "Doplňte nadpis." };
  if (excerpt.length < 3) return { ok: false, error: "Doplňte krátký perex." };
  if (body.length < 3) return { ok: false, error: "Doplňte text." };
  const stored = await storeImage(env, input.image);
  if (stored.error) return { ok: false, error: stored.error };

  if (input.id) {
    const current = await env.DB.prepare("select image_key from articles where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tahle zpráva už tu není." };
    let imageKey = current.image_key ? String(current.image_key) : null;
    if (stored.key) {
      if (imageKey) await env.BUCKET.delete(imageKey);
      imageKey = stored.key;
    }
    await env.DB.prepare(
      "update articles set title = ?, excerpt = ?, body = ?, category = ?, published = ?, image_key = ? where id = ?",
    )
      .bind(title, excerpt, body, category, input.published ? 1 : 0, imageKey, input.id)
      .run();
    return { ok: true };
  }

  const slug = await uniqueSlug(env, slugify(title));
  await env.DB.prepare(
    `insert into articles (slug, title, excerpt, body, category, image_key, published, created_at)
     values (?, ?, ?, ?, ?, ?, ?, date('now'))`,
  )
    .bind(slug, title, excerpt, body, category, stored.key, input.published ? 1 : 0)
    .run();
  return { ok: true };
}

export async function removeArticle(env, request, id) {
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
  const current = await env.DB.prepare("select image_key from articles where id = ?").bind(id).first();
  if (current?.image_key) await env.BUCKET.delete(String(current.image_key));
  await env.DB.prepare("delete from articles where id = ?").bind(id).run();
  return { ok: true };
}

export async function saveEvent(env, request, input) {
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
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
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
  await env.DB.prepare("delete from events where id = ?").bind(id).run();
  return { ok: true };
}

export async function saveSite(env, request, input) {
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
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
  const denied = await requireEditor(env, request);
  if (denied) return { ok: false, error: denied };
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
