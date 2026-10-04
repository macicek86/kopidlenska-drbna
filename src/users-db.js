// Účty redakce: přihlášení heslem, e-mail pro Cloudflare Access, přispěvatelé a jejich oprávnění.

import { accessConfig } from "./access.js";
import { addColumn, asBool, clip, mapAccount, normalizeLogin, readCookie, requireChief, requireUser } from "./db-core.js";
import { hashPassword, verifyPassword } from "./password.js";

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
  {
    code: "oteviraci_doba",
    label: "Otevírací doba",
    detail: "Může měnit otevírací dobu míst, dočasné změny a novou otevírací dobu. Místa samotná zakládá hlavní redaktor.",
  },
  {
    code: "drbena_navrhy",
    label: "Články od Drběny",
    detail: "Může upravit a schválit články, které koza Drběna napsala z importu a čekají na schválení. Smazat je nemůže.",
  },
  {
    code: "ai_pomocnik",
    label: "Pomocník při psaní",
    detail: "U zprávy může nechat Drběnu přepsat text svým hlasem nebo ho jen učesat. Kolikrát denně, nastavuje hlavní redaktor na stránce Koza Drběna.",
  },
  {
    code: "obrazky",
    label: "Knihovna obrázků",
    detail: "Může nahrávat a mazat ilustrační fotky a měnit jejich témata.",
  },
  {
    code: "vzkazy",
    label: "Vzkazy z chatu",
    detail: "Vidí vzkazy, které Drběna v chatu předala redakci (chybějící místo, oprava, tip na článek), a může je vyřídit.",
  },
  {
    code: "statistiky",
    label: "Statistiky",
    detail: "Vidí návštěvnost webu: kolik lidí přišlo, co čtou a odkud přišli.",
  },
];

const ACCESS_ON = "Přihlášení heslem je vypnuté, redakce se přihlašuje e-mailem přes Cloudflare Access.";

export function knownPermissions(values) {
  const allowed = new Set(PERMISSIONS.map((item) => item.code));
  const list = Array.isArray(values) ? values : [];
  return [...new Set(list.map((item) => String(item)))].filter((code) => allowed.has(code));
}

export async function ensureUserColumns(env) {
  const info = await env.DB.prepare("pragma table_info(users)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "alias", "alter table users add column alias text not null default ''");
  await addColumn(env, names, "email", "alter table users add column email text");
  await env.DB.prepare("create unique index if not exists users_email on users(email) where email is not null").run();
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

export async function loadUsers(env) {
  const rows = await env.DB.prepare(
    "select id, login, name, alias, email, role, active from users order by case role when 'hlavni' then 0 else 1 end, name",
  ).all();
  return attachPermissions(env, (rows.results ?? []).map((row) => mapAccount(row)));
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function login(env, loginName, password) {
  if (accessConfig(env)) return { ok: false, error: ACCESS_ON };
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
  if (accessConfig(env)) return { ok: false, error: ACCESS_ON };
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

// E-mail, se kterým se člověk přihlásí přes Cloudflare Access. S Accessem je povinný, bez něj nepovinný.
export function readEmail(value, required) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return required ? { error: "Doplňte e-mail, se kterým se bude přihlašovat." } : { email: null };
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Tohle nevypadá jako e-mail." };
  }
  return { email };
}

async function emailTaken(env, email, userId) {
  if (!email) return false;
  const row = await env.DB.prepare("select id from users where email = ? and id != ?").bind(email, userId ?? 0).first();
  return Boolean(row);
}

const EMAIL_TAKEN = "Tenhle e-mail už má jiný účet.";

export async function saveProfile(env, request, input) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const next = clip(input.name, 60);
  if (next.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  const alias = readAlias(input.alias);
  if (alias.error) return { ok: false, error: alias.error };
  // Svůj e-mail si mění jen hlavní redaktor, přispěvatelům ho nastavuje on.
  let email = gate.user.email || null;
  if (gate.user.role === "hlavni") {
    const read = readEmail(input.email, Boolean(accessConfig(env)));
    if (read.error) return { ok: false, error: read.error };
    if (await emailTaken(env, read.email, gate.user.id)) return { ok: false, error: EMAIL_TAKEN };
    email = read.email;
  }
  await env.DB.prepare("update users set name = ?, alias = ?, email = ? where id = ?")
    .bind(next, alias.alias, email, gate.user.id)
    .run();
  return { ok: true };
}

async function writePermissions(env, userId, codes) {
  await env.DB.prepare("delete from user_permissions where user_id = ?").bind(userId).run();
  for (const code of codes) {
    await env.DB.prepare("insert into user_permissions (user_id, code) values (?, ?)").bind(userId, code).run();
  }
}

export function loginBase(email) {
  const base = String(email ?? "")
    .split("@")[0]
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 28);
  return base.length >= 3 ? base : `clen${base}`;
}

async function loginFromEmail(env, email) {
  const base = loginBase(email);
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}${n}`;
    const row = await env.DB.prepare("select id from users where login = ?").bind(candidate).first();
    if (!row) return candidate;
  }
}

export async function createContributor(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = Boolean(accessConfig(env));
  const name = clip(input.name, 60);
  const alias = readAlias(input.alias);
  const email = readEmail(input.email, access);
  if (name.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  if (alias.error) return { ok: false, error: alias.error };
  if (email.error) return { ok: false, error: email.error };
  // S Accessem se jménem a heslem nikdo nepřihlásí: jméno se vezme z e-mailu a heslo je náhodné, nikdo ho nezná.
  const loginName = access ? await loginFromEmail(env, email.email) : normalizeLogin(input.login);
  const password = access ? token() : String(input.password ?? "").trim();
  if (!/^[a-z0-9]{3,32}$/.test(loginName)) {
    return { ok: false, error: "Přihlašovací jméno může mít 3 až 32 znaků: malá písmena a číslice." };
  }
  if (password.length < 8) return { ok: false, error: "Heslo musí mít aspoň 8 znaků." };
  const existing = await env.DB.prepare("select id from users where login = ?").bind(loginName).first();
  if (existing) return { ok: false, error: "Tohle přihlašovací jméno už někdo má." };
  if (await emailTaken(env, email.email)) return { ok: false, error: EMAIL_TAKEN };
  await env.DB.prepare(
    "insert into users (login, name, alias, email, password_hash, role) values (?, ?, ?, ?, ?, 'prispevovatel')",
  )
    .bind(loginName, name, alias.alias, email.email, await hashPassword(password))
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
  const email = readEmail(input.email, Boolean(accessConfig(env)));
  if (email.error) return { ok: false, error: email.error };
  if (await emailTaken(env, email.email, row.id)) return { ok: false, error: EMAIL_TAKEN };
  await env.DB.prepare("update users set alias = ?, email = ? where id = ?").bind(alias.alias, email.email, row.id).run();
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
  if (accessConfig(env)) return { ok: false, error: ACCESS_ON };
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
