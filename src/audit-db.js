// Historie změn v redakci: kdo, kdy, co a u úprav i staré a nové hodnoty. Zapisuje src/audit.js,
// stránka je src/admin/audit.js (jen hlavní redaktor). Záznamy starší než KEEP_DAYS maže cron.
import { clip } from "./db-core.js";

export const KEEP_DAYS = 365;
export const PAGE_SIZE = 50;

const AUDIT_TABLES = [
  `create table if not exists audit_log (
    id integer primary key autoincrement,
    at text not null default (datetime('now')),
    user_id integer,
    user_name text not null default '',
    section text not null default '',
    action text not null default '',
    title text not null default '',
    changes text not null default ''
  )`,
  "create index if not exists audit_log_user on audit_log (user_id, id)",
  "create index if not exists audit_log_section on audit_log (section, id)",
];

export async function ensureAuditTables(env) {
  for (const sql of AUDIT_TABLES) await env.DB.prepare(sql).run();
}

// `user` je účet ({ id, name }) nebo null (neúspěšné přihlášení: jméno je to, co člověk napsal).
// `changes` je seznam změněných záznamů z src/audit.js, prázdný u akcí bez hodnot.
export async function recordAudit(env, { user = null, userName = "", section, action, title = "", changes = [] }) {
  await env.DB.prepare(
    "insert into audit_log (user_id, user_name, section, action, title, changes) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      user?.id ?? null,
      clip(user?.name ?? userName, 80),
      clip(section, 40),
      clip(action, 200),
      clip(title, 200),
      changes.length ? JSON.stringify(changes) : "",
    )
    .run();
}

function mapEntry(row) {
  let changes = [];
  try {
    changes = row.changes ? JSON.parse(String(row.changes)) : [];
  } catch {
    changes = [];
  }
  return {
    id: Number(row.id),
    at: `${String(row.at).replace(" ", "T")}Z`,
    userId: row.user_id == null ? null : Number(row.user_id),
    userName: String(row.user_name ?? ""),
    section: String(row.section ?? ""),
    action: String(row.action ?? ""),
    title: String(row.title ?? ""),
    changes: Array.isArray(changes) ? changes : [],
    hasChanges: Number(row.has_changes ?? 0) === 1 || changes.length > 0,
  };
}

// Stránka historie: nejnovější nahoře, `before` je id posledního záznamu z předchozí stránky.
export async function loadAudit(env, { userId = 0, section = "", before = 0, entryId = 0 } = {}) {
  const where = [];
  const binds = [];
  if (userId) {
    where.push("user_id = ?");
    binds.push(userId);
  }
  if (section) {
    where.push("section = ?");
    binds.push(section);
  }
  if (before) {
    where.push("id < ?");
    binds.push(before);
  }
  const filter = where.length ? `where ${where.join(" and ")}` : "";
  const [rows, people, sections, entry] = await Promise.all([
    env.DB.prepare(
      `select id, at, user_id, user_name, section, action, title, '' as changes, changes != '' as has_changes
       from audit_log ${filter} order by id desc limit ?`,
    )
      .bind(...binds, PAGE_SIZE + 1)
      .all(),
    env.DB.prepare(
      `select user_id, max(user_name) as user_name from audit_log where user_id is not null group by user_id order by user_name`,
    ).all(),
    env.DB.prepare("select distinct section from audit_log order by section").all(),
    entryId ? env.DB.prepare("select * from audit_log where id = ?").bind(entryId).first() : null,
  ]);
  const list = (rows.results ?? []).map(mapEntry);
  return {
    entries: list.slice(0, PAGE_SIZE),
    more: list.length > PAGE_SIZE,
    people: (people.results ?? []).map((row) => ({ id: Number(row.user_id), name: String(row.user_name ?? "") })),
    sections: (sections.results ?? []).map((row) => String(row.section)).filter(Boolean),
    entry: entry ? mapEntry(entry) : null,
  };
}

export async function pruneAudit(env, days = KEEP_DAYS) {
  await env.DB.prepare("delete from audit_log where at < datetime('now', ?)").bind(`-${days} days`).run();
}
