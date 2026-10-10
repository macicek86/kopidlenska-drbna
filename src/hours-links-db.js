// Jednorázový odkaz pro správce: tajná adresa `/sprava/<token>` pro jedno místo, ordinaci nebo sběrný dvůr.
// Vzniká jen z e-mailu na otevírací dobu (src/mailin/, tlačítko Upravit čas na webu). Platí 24 hodin a po první
// uložené změně zanikne. Změna jde ke schválení (src/hours-requests-db.js), nebo s `direct` rovnou na web.
// Trvalé odkazy, které zakládal hlavní redaktor, už nejsou (schema.js je smazal).
import { addColumn, clip } from "./db-core.js";
import { REQUEST_SECTIONS } from "./hours-requests-db.js";

const TABLES = [
  `create table if not exists hours_links (
    id integer primary key autoincrement,
    section text not null,
    target_id integer not null,
    token text not null unique,
    label text not null default '',
    direct integer not null default 0,
    used_on text not null default '',
    used_count integer not null default 0,
    last_used_at text,
    created_by integer,
    created_at text not null default (datetime('now'))
  )`,
  "create index if not exists hours_links_target on hours_links (section, target_id)",
];

export async function ensureLinkTables(env) {
  for (const sql of TABLES) await env.DB.prepare(sql).run();
  // Jednorázový odkaz z e-mailu na otevírací dobu (src/mailin/): platí do `expires_at` a po první uložené změně zanikne.
  const info = await env.DB.prepare("pragma table_info(hours_links)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "expires_at", "alter table hours_links add column expires_at text");
  await addColumn(env, names, "once", "alter table hours_links add column once integer not null default 0");
  // Trvalé odkazy, které zakládal hlavní redaktor, už nejsou; zůstávají jen jednorázové z e-mailu.
  await env.DB.prepare("delete from hours_links where once = 0").run();
}

// 128 bitů náhody šestnáctkově: v adrese se nic neplete (podtržítko v odkazu vypadá jako mezera).
export function newToken() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function linkPath(token) {
  return `/sprava/${token}`;
}

function mapLink(row) {
  return {
    id: Number(row.id),
    section: String(row.section),
    targetId: Number(row.target_id),
    token: String(row.token),
    label: String(row.label ?? ""),
    direct: Number(row.direct) === 1,
  };
}

export async function linkByToken(env, token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token ?? ""))) return null;
  const row = await env.DB.prepare("select * from hours_links where token = ? and (expires_at is null or expires_at > datetime('now'))").bind(token).first();
  return row && REQUEST_SECTIONS[row.section] ? mapLink(row) : null;
}

// Jak dlouho jednorázový odkaz platí.
export const MAIL_LINK_HOURS = 24;

export async function createMailLink(env, { section, targetId, label, direct }) {
  if (!REQUEST_SECTIONS[section] || !targetId) return null;
  await env.DB.prepare("delete from hours_links where expires_at is not null and expires_at <= datetime('now')").run();
  const token = newToken();
  await env.DB.prepare(
    `insert into hours_links (section, target_id, token, label, direct, once, expires_at) values (?, ?, ?, ?, ?, 1, datetime('now', '+${MAIL_LINK_HOURS} hours'))`,
  )
    .bind(section, targetId, token, clip(label, 80), direct ? 1 : 0)
    .run();
  return token;
}

// Po uložené změně z odkazu: odkaz zanikne.
export async function useLink(env, link) {
  await env.DB.prepare("delete from hours_links where id = ?").bind(link.id).run();
}

// Smazaný řádek (místo, ordinace, dvůr) vezme své odkazy s sebou.
export async function removeLinksOf(env, section, targetId) {
  await env.DB.prepare("delete from hours_links where section = ? and target_id = ?").bind(section, targetId).run();
}

// Žádosti z tohoto odkazu (čekající i zamítnuté), ať je správce vidí na své stránce.
export async function linkRequests(env, link) {
  const rows = await env.DB.prepare(
    "select id, action, target_id, payload, status, reply, author_name, created_at from hours_requests where link_id = ? order by id desc limit 30",
  )
    .bind(link.id)
    .all();
  return (rows.results ?? []).map((row) => {
    let value = {};
    try {
      value = JSON.parse(String(row.payload ?? "{}")) ?? {};
    } catch {
      value = {};
    }
    return {
      id: Number(row.id),
      action: String(row.action),
      targetId: Number(row.target_id),
      value,
      status: row.status === "rejected" ? "rejected" : "pending",
      reply: String(row.reply ?? ""),
      author: String(row.author_name ?? ""),
      createdAt: String(row.created_at ?? ""),
    };
  });
}

export async function withdrawLinkRequest(env, link, id) {
  await env.DB.prepare("delete from hours_requests where id = ? and link_id = ?").bind(id ?? 0, link.id).run();
}
