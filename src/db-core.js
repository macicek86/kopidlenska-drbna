// Společné kousky pro práci s D1: ořez textu, slug, přihlášený člověk a oprávnění.

import { sessionAccount } from "./login-db.js";
import { pragueNow } from "./waste.js";

const COOKIE = "drbna_editor";

// Tabulky importů (Munipolis, fotbal, Deník): položka zdroje a zpráva nebo návrh, který z ní vznikl.
export const IMPORT_ITEM_TABLES = ["import_items", "football_items", "denik_items", "skola_items", "zahradka_items", "webmesta_items"];

export const REOPENED_REASON = "Redakce zprávu smazala. Jde zpracovat znovu.";

// Smazaná zpráva nebo návrh od Drběny vrátí zdrojovou položku do fronty jako „smazano“: sama se znovu nezpracuje,
// redakce ji ale může vybrat. Akce, která z položky vznikla, zůstává v kalendáři.
export async function reopenImports(env, { articleId = 0, proposalIds = [] } = {}) {
  const ids = proposalIds.map(Number).filter((id) => id > 0);
  const marks = ids.map(() => "?").join(", ");
  const match = ids.length ? `article_id = ? or proposal_id in (${marks})` : "article_id = ?";
  for (const table of IMPORT_ITEM_TABLES) {
    await env.DB.prepare(
      `update ${table} set status = 'smazano', reason = ?, article_id = null, proposal_id = null, manual = 0, attempts = 0
       where status = 'hotovo' and (${match})`,
    )
      .bind(REOPENED_REASON, Number(articleId) || 0, ...ids)
      .run();
  }
}

// Zpráva je na webu, když je zveřejněná a její den už nastal: datum v budoucnu je plánované zveřejnění.
// Starší zprávy mají v `created_at` i čas, proto se porovná jen den. Dnešek je vždy YYYY-MM-DD z pragueNow.
export function liveArticle(alias = "a", today = pragueNow().date) {
  return `${alias}.published = 1 and substr(${alias}.created_at, 1, 10) <= '${today}'`;
}

function sqlStamp(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Okamžik, kdy zpráva vyšla na web (`articles.published_at`, UTC „YYYY-MM-DD HH:MM:SS“): s dnešním datem teď,
// s jiným půlnoc toho dne v Praze (naplánovaná zpráva se tehdy objeví, starší datum zvolila redakce).
export function publishMoment(day, now = new Date()) {
  if (!day || day === pragueNow(now).date) return sqlStamp(now);
  const [y, m, d] = day.split("-").map(Number);
  for (const hours of [1, 2]) {
    const candidate = new Date(Date.UTC(y, m - 1, d) - hours * 3_600_000);
    const local = pragueNow(candidate);
    if (local.date === day && local.time === "00:00") return sqlStamp(candidate);
  }
  return sqlStamp(new Date(Date.UTC(y, m - 1, d)));
}

export function clip(value, max) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function asBool(value) {
  return value === 1 || value === true || value === "1";
}

export function normalizeLogin(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function slugify(input) {
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

export function userCan(user, code) {
  if (!user) return false;
  if (user.role === "hlavni") return true;
  return Array.isArray(user.permissions) && user.permissions.includes(code);
}

export function mapAccount(row, permissions = []) {
  return {
    id: Number(row.id),
    login: String(row.login),
    name: String(row.name),
    alias: String(row.alias ?? "").trim(),
    email: String(row.email ?? ""),
    role: String(row.role),
    active: asBool(row.active),
    permissions,
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

export function sessionCookie(token, secure, maxAge = 2592000) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(secure) {
  const parts = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function addColumn(env, present, name, sql) {
  if (present.has(name)) return;
  try {
    await env.DB.prepare(sql).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column/i.test(message)) throw error;
  }
}

export async function permissionCodes(env, userId) {
  const rows = await env.DB.prepare("select code from user_permissions where user_id = ?").bind(userId).all();
  return (rows.results ?? []).map((row) => String(row.code));
}


// Kdo je přihlášený: podle cookie s tokenem přihlášeného zařízení (src/login-db.js). `sessionId` je to zařízení.
export async function identify(env, request) {
  const found = await sessionAccount(env, readCookie(request));
  if (!found) return { user: null, sessionId: null };
  return { user: mapAccount(found.row, await permissionCodes(env, found.row.id)), sessionId: found.sessionId };
}

export async function currentUser(env, request) {
  return (await identify(env, request)).user;
}

export async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) return { ok: false, error: "Přihlaste se do redakce." };
  return { ok: true, user };
}

export async function requireChief(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (gate.user.role !== "hlavni") return { ok: false, error: "Tohle mění jen hlavní redaktor." };
  return gate;
}

export async function uniqueSlug(env, base) {
  let slug = base;
  let n = 2;
  for (;;) {
    const row = await env.DB.prepare("select id from articles where slug = ?").bind(slug).first();
    if (!row) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

export function wrote(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}