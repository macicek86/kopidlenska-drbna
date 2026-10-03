// Společné kousky pro práci s D1: ořez textu, slug, přihlášený člověk a oprávnění.

import { accessConfig, accessEmail } from "./access.js";

const COOKIE = "drbna_editor";

// Tabulky importů (Munipolis, fotbal, Deník): položka zdroje a zpráva nebo návrh, který z ní vznikl.
export const IMPORT_ITEM_TABLES = ["import_items", "football_items", "denik_items", "skola_items", "zahradka_items"];

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

const ACCOUNT_FIELDS = "id, login, name, alias, email, role, active";

// Kdo je přihlášený. S Cloudflare Access podle ověřeného e-mailu (ten vrací i bez účtu, ať redakce
// může říct, že pro něj účet nemá), jinak podle cookie z přihlášení heslem.
export async function identify(env, request) {
  const access = accessConfig(env);
  if (access) {
    const email = await accessEmail(request, access);
    if (!email) return { user: null, email: null };
    const row = await env.DB.prepare(`select ${ACCOUNT_FIELDS} from users where email = ? and active = 1`)
      .bind(email)
      .first();
    return { user: row ? mapAccount(row, await permissionCodes(env, row.id)) : null, email };
  }
  const token = readCookie(request);
  if (!token || token.length < 20) return { user: null, email: null };
  const row = await env.DB.prepare(`select ${ACCOUNT_FIELDS} from users where session_token = ? and active = 1`)
    .bind(token)
    .first();
  return { user: row ? mapAccount(row, await permissionCodes(env, row.id)) : null, email: null };
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