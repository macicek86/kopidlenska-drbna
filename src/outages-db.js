// Odstávky elektřiny v D1: hlídané obce a uložený přehled z widgetu ČEZ.
import { asBool, requireChief, wrote } from "./db-core.js";
import { MAX_AREAS, buildBoard, fetchAreaOutages, mergeFresh, parseAreaInput, refreshNote } from "./outages.js";

export function emptyOutageBoard() {
  return buildBoard();
}

function parseOutagePayload(text) {
  try {
    const data = JSON.parse(text || "[]");
    return Array.isArray(data) ? data.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function mapOutageArea(row) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    enabled: asBool(row.enabled),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function loadOutageAreas(env) {
  const rows = await env.DB.prepare(
    "select id, code, name, enabled, sort_order from outage_areas order by sort_order asc, name asc, id asc",
  ).all();
  return (rows.results ?? []).map(mapOutageArea);
}

export async function loadOutageBoard(env) {
  const [allAreas, row] = await Promise.all([
    loadOutageAreas(env),
    env.DB.prepare("select fetched_at, status, note, payload from outage_feed where id = 1").first(),
  ]);
  const areas = allAreas.filter((area) => area.enabled);
  return buildBoard({
    fetchedAt: row?.fetched_at ? String(row.fetched_at) : null,
    status: String(row?.status ?? ""),
    note: String(row?.note ?? ""),
    areas,
    outages: parseOutagePayload(row?.payload),
  });
}

async function lockOutageFeed(env) {
  await env.DB.prepare(
    "insert into outage_feed (id, payload) select 1, '[]' where not exists (select 1 from outage_feed where id = 1)",
  ).run();
  const now = new Date();
  const token = `${now.toISOString()}-${crypto.randomUUID()}`;
  const stale = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    "update outage_feed set fetching_at = ? where id = 1 and (fetching_at is null or fetching_at = '' or fetching_at < ?)",
  )
    .bind(token, stale)
    .run();
  return wrote(result) ? token : "";
}

async function unlockOutageFeed(env, token) {
  if (!token) return;
  await env.DB.prepare("update outage_feed set fetching_at = null where id = 1 and fetching_at = ?").bind(token).run();
}

async function writeOutageFeed(env, { fetchedAt, status, note, payload }) {
  await env.DB.prepare("update outage_feed set fetched_at = ?, status = ?, note = ?, payload = ? where id = 1")
    .bind(fetchedAt, status, note, JSON.stringify(payload))
    .run();
}

export async function refreshOutages(env, request = null, options = {}) {
  if (request) {
    const gate = await requireChief(env, request);
    if (!gate.ok) return gate;
  }
  const lock = await lockOutageFeed(env);
  if (!lock) return { ok: false, kept: false, error: "Načítání už běží. Zkuste to za chvíli." };
  try {
    const enabled = (await loadOutageAreas(env)).filter((area) => area.enabled).slice(0, MAX_AREAS);
    const fetchedAt = new Date().toISOString();
    if (!enabled.length) {
      await writeOutageFeed(env, { fetchedAt, status: "ok", note: "", payload: [] });
      return { ok: true, partial: false, count: 0 };
    }
    const previous = parseOutagePayload(
      (await env.DB.prepare("select payload from outage_feed where id = 1").first())?.payload,
    );
    const results = await fetchAreaOutages(enabled, options);
    const summary = refreshNote(results);
    const payload = mergeFresh(previous, results);
    await writeOutageFeed(env, { fetchedAt, status: summary.status, note: summary.note, payload });
    if (summary.status === "error") return { ok: false, kept: true, error: summary.note };
    return { ok: true, partial: summary.status === "partial", note: summary.note, count: payload.length };
  } finally {
    await unlockOutageFeed(env, lock);
  }
}

async function afterAreaChange(env) {
  const fresh = await refreshOutages(env);
  if (fresh.ok && fresh.partial) return { ok: true, partial: true };
  if (fresh.ok) return { ok: true };
  return { ok: true, warn: `Změna je uložená. ${fresh.error}` };
}

export async function addOutageArea(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const parsed = parseAreaInput(input);
  if (!parsed.ok) return parsed;
  const count = await env.DB.prepare("select count(*) as n from outage_areas").first();
  if (Number(count?.n) >= MAX_AREAS) return { ok: false, error: "Oblastí může být nejvýš 12." };
  try {
    await env.DB.prepare("insert into outage_areas (code, name, enabled, sort_order) values (?, ?, ?, ?)")
      .bind(parsed.area.code, parsed.area.name, parsed.area.enabled ? 1 : 0, parsed.area.sortOrder)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) return { ok: false, error: "Tahle obec už v seznamu je." };
    throw error;
  }
  return afterAreaChange(env);
}

export async function saveOutageAreas(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const rows = Array.isArray(input?.areas) ? input.areas : [];
  if (!rows.length) return { ok: false, error: "V seznamu není žádná obec." };
  const parsed = [];
  for (const row of rows) {
    const item = parseAreaInput(row);
    if (!item.ok) return item;
    const id = Number(row.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Tu obec v seznamu nemám." };
    parsed.push({ id, ...item.area });
  }
  if (new Set(parsed.map((area) => area.code)).size !== parsed.length) {
    return { ok: false, error: "Každá obec potřebuje vlastní kód." };
  }
  const existing = await loadOutageAreas(env);
  const known = new Set(existing.map((area) => area.id));
  if (parsed.length !== existing.length || parsed.some((area) => !known.has(area.id))) {
    return { ok: false, error: "Seznam obcí se mezitím změnil. Načtěte stránku znovu." };
  }
  try {
    await env.DB.batch([
      ...parsed.map((area, index) =>
        env.DB.prepare("update outage_areas set code = ? where id = ?").bind(`~${index}`, area.id),
      ),
      ...parsed.map((area) =>
        env.DB.prepare("update outage_areas set code = ?, name = ?, enabled = ?, sort_order = ? where id = ?").bind(
          area.code,
          area.name,
          area.enabled ? 1 : 0,
          area.sortOrder,
          area.id,
        ),
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) return { ok: false, error: "Tahle obec už v seznamu je." };
    throw error;
  }
  return afterAreaChange(env);
}

export async function removeOutageArea(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const result = await env.DB.prepare("delete from outage_areas where id = ?").bind(id).run();
  if (!wrote(result)) return { ok: false, error: "Tu obec v seznamu nemám." };
  return { ok: true };
}