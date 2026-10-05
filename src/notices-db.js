// Odstávky vody a uzavírky v D1.
import { asBool, requireChief } from "./db-core.js";
import { loadClosureNotices } from "./ndic/store.js";
import { noticeBoard, parseNoticeInput, placeLines } from "./notices.js";

export const NOTICES_TABLE = `create table if not exists notices (
  id integer primary key autoincrement,
  kind text not null,
  title text not null,
  starts_on text not null,
  starts_time text not null default '',
  ends_on text not null default '',
  ends_time text not null default '',
  places text not null default '',
  note text not null default '',
  source_url text not null default '',
  published integer not null default 0,
  created_at text not null default (date('now'))
)`;

export async function ensureNoticeTables(env) {
  await env.DB.prepare(NOTICES_TABLE).run();
}

function mapNotice(row) {
  return {
    id: Number(row.id),
    kind: String(row.kind),
    title: String(row.title),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    startsTime: String(row.starts_time ?? ""),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    endsTime: String(row.ends_time ?? ""),
    places: placeLines(row.places),
    note: String(row.note ?? ""),
    sourceUrl: String(row.source_url ?? ""),
    published: asBool(row.published),
    // Kdy oznámení přibylo (feed odstávek).
    addedAt: String(row.created_at ?? ""),
  };
}

const FIELDS = "id, kind, title, starts_on, starts_time, ends_on, ends_time, places, note, source_url, published, created_at";

export async function loadNotices(env, { publishedOnly = false } = {}) {
  const where = publishedOnly ? "where published = 1" : "";
  const rows = await env.DB.prepare(`select ${FIELDS} from notices ${where} order by starts_on asc, starts_time asc, id asc`).all();
  return (rows.results ?? []).map(mapNotice);
}

// Na web jdou oznámení redakce a uzavírky z NDIC (Dopravní info) dohromady.
export async function loadNoticeBoard(env, now = new Date()) {
  const [notices, closures] = await Promise.all([loadNotices(env, { publishedOnly: true }), loadClosureNotices(env, now)]);
  return noticeBoard([...notices, ...closures], now);
}

function binds(notice) {
  return [
    notice.kind,
    notice.title,
    notice.startsOn,
    notice.startsTime,
    notice.endsOn,
    notice.endsTime,
    notice.places.join("\n"),
    notice.note,
    notice.sourceUrl,
    notice.published ? 1 : 0,
  ];
}

export async function insertNotice(env, notice) {
  const result = await env.DB.prepare(
    `insert into notices (kind, title, starts_on, starts_time, ends_on, ends_time, places, note, source_url, published)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(...binds(notice))
    .run();
  return Number(result?.meta?.last_row_id ?? 0) || null;
}

export async function saveNotice(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const parsed = parseNoticeInput(input);
  if (!parsed.ok) return parsed;
  if (!input.id) {
    await insertNotice(env, parsed.notice);
    return { ok: true, updated: false };
  }
  const result = await env.DB.prepare(
    `update notices set kind = ?, title = ?, starts_on = ?, starts_time = ?, ends_on = ?, ends_time = ?, places = ?, note = ?,
       source_url = ?, published = ? where id = ?`,
  )
    .bind(...binds(parsed.notice), input.id)
    .run();
  if (!Number(result?.meta?.changes ?? 0)) return { ok: false, error: "Tohle oznámení už tu není." };
  return { ok: true, updated: true };
}

export async function removeNotice(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("delete from notices where id = ?").bind(id).run();
  return { ok: true };
}
