// Odkazy pro správce: tajná adresa `/sprava/<token>` pro jedno místo, ordinaci nebo sběrný dvůr.
// Kdo ji má (zaměstnanec firmy, sestra v ordinaci), zapíše změnu hodin bez účtu v redakci.
// Změna jde ke schválení (src/hours-requests-db.js), nebo s `direct` rovnou na web. Zakládá je jen hlavní redaktor.
import { addColumn, clip, requireChief } from "./db-core.js";
import { REQUEST_SECTIONS } from "./hours-requests-db.js";
import { pragueNow } from "./waste.js";

// Kolik změn z jednoho odkazu za den: proti spamu, kdyby odkaz utekl.
export const LINK_DAILY_LIMIT = 30;

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
    once: Number(row.once ?? 0) === 1,
    usedOn: String(row.used_on ?? ""),
    usedCount: Number(row.used_count ?? 0),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : "",
    createdAt: String(row.created_at ?? ""),
  };
}

// Pro redakci: odkazy podle sekce (jen hlavní redaktor je vidí).
export async function loadLinks(env, user) {
  const out = Object.fromEntries(Object.keys(REQUEST_SECTIONS).map((section) => [section, []]));
  if (user?.role !== "hlavni") return out;
  const rows = await env.DB.prepare("select * from hours_links where once = 0 order by id asc").all();
  for (const row of rows.results ?? []) {
    const link = mapLink(row);
    out[link.section]?.push(link);
  }
  return out;
}

export async function linkByToken(env, token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token ?? ""))) return null;
  const row = await env.DB.prepare("select * from hours_links where token = ? and (expires_at is null or expires_at > datetime('now'))").bind(token).first();
  return row && REQUEST_SECTIONS[row.section] ? mapLink(row) : null;
}

// Má odkaz dnes ještě volno? Počítají se jen změny, které se opravdu uložily (`countUse`).
export function linkHasRoom(link, today = pragueNow().date) {
  return link.usedOn !== today || link.usedCount < LINK_DAILY_LIMIT;
}

// Po uložené změně: připočte ji k dnešku a zapíše, kdy byl odkaz naposledy použitý.
export async function countUse(env, link, today = pragueNow().date) {
  await env.DB.prepare(
    `update hours_links set
       used_count = case when used_on = ? then used_count + 1 else 1 end,
       used_on = ?,
       last_used_at = datetime('now')
     where id = ?`,
  )
    .bind(today, today, link.id)
    .run();
}

// Jednorázový odkaz z e-mailu: jen pro jeden řádek, den platí a po první uložené změně zanikne (`useLink`).
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

// Po uložené změně z odkazu: jednorázový zanikne, ostatní si jen připočtou použití.
export async function useLink(env, link) {
  if (link.once) await env.DB.prepare("delete from hours_links where id = ?").bind(link.id).run();
  else await countUse(env, link);
}

export async function createLink(env, request, { section, targetId, label, direct }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!REQUEST_SECTIONS[section] || !targetId) return { ok: false, error: "Tohle tu už není." };
  await env.DB.prepare("insert into hours_links (section, target_id, token, label, direct, created_by) values (?, ?, ?, ?, ?, ?)")
    .bind(section, targetId, newToken(), clip(label, 80), direct ? 1 : 0, gate.user.id)
    .run();
  return { ok: true };
}

export async function updateLink(env, request, { section, id, label, direct }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("update hours_links set label = ?, direct = ? where id = ? and section = ?")
    .bind(clip(label, 80), direct ? 1 : 0, id ?? 0, section)
    .run();
  return { ok: true };
}

// Smazaný odkaz přestane fungovat. Čekající žádosti z něj zůstanou ke schválení.
export async function removeLink(env, request, { section, id }) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from hours_links where id = ? and section = ?").bind(id ?? 0, section).run();
  return { ok: true };
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
