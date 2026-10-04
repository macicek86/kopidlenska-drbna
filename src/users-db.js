// Účty redakce: e-mail, se kterým se člověk přihlašuje kódem (src/login.js), přispěvatelé a jejich oprávnění.

import { addColumn, clip, mapAccount, requireChief, requireUser } from "./db-core.js";
import { endUserSessions } from "./login-db.js";

export const PERMISSIONS = [
  {
    code: "sberny_dvur",
    label: "Sběrný dvůr",
    detail: "Může zapsat mimořádné uzavření a důvod. Dvůr samotný pořád mění hlavní redaktor.",
  },
  {
    code: "sberny_dvur_navrh",
    label: "Sběrný dvůr ke schválení",
    detail: "Může navrhnout mimořádné uzavření nebo jeho zrušení. Na web jde, až to schválí hlavní redaktor.",
  },
  {
    code: "doktori",
    label: "Lékaři",
    detail: "Může měnit ordinační hodiny a dočasnou změnu. Ordinaci samotnou pořád zakládá hlavní redaktor.",
  },
  {
    code: "doktori_navrh",
    label: "Lékaři ke schválení",
    detail: "Může navrhnout ordinační hodiny, dočasnou změnu nebo její zrušení. Na web jde, až to schválí hlavní redaktor.",
  },
  {
    code: "oteviraci_doba",
    label: "Otevírací doba",
    detail: "Může měnit otevírací dobu míst, dočasné změny a novou otevírací dobu. Místa samotná zakládá hlavní redaktor.",
  },
  {
    code: "oteviraci_doba_navrh",
    label: "Otevírací doba ke schválení",
    detail: "Může navrhnout opravu otevírací doby, dočasnou změnu, novou dobu nebo zrušení změny. Na web jde, až to schválí hlavní redaktor.",
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

function readAlias(value) {
  const alias = clip(value, 60);
  if (alias && alias.length < 2) {
    return { error: "Alias musí mít aspoň 2 znaky. Když ho nechcete, nechte pole prázdné." };
  }
  return { alias };
}

// E-mail, se kterým se člověk přihlašuje. Účet bez něj se nepřihlásí.
export function readEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return { error: "Doplňte e-mail, se kterým se bude přihlašovat." };
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
    const read = readEmail(input.email);
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
  const name = clip(input.name, 60);
  const alias = readAlias(input.alias);
  const email = readEmail(input.email);
  if (name.length < 2) return { ok: false, error: "Doplňte jméno, jak má být pod článkem." };
  if (alias.error) return { ok: false, error: alias.error };
  if (email.error) return { ok: false, error: email.error };
  if (await emailTaken(env, email.email)) return { ok: false, error: EMAIL_TAKEN };
  // Přihlašovací jméno se vezme z e-mailu: je jen vnitřní značka účtu, nikdo ho nezadává. Heslo se nepoužívá.
  const loginName = await loginFromEmail(env, email.email);
  await env.DB.prepare(
    "insert into users (login, name, alias, email, password_hash, role) values (?, ?, ?, ?, '', 'prispevovatel')",
  )
    .bind(loginName, name, alias.alias, email.email)
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
  const email = readEmail(input.email);
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
  await env.DB.prepare("update users set active = ? where id = ?").bind(active ? 1 : 0, row.id).run();
  // Vypnutý účet se odhlásí ze všech zařízení.
  if (!active) await endUserSessions(env, row.id);
  return { ok: true, active };
}
