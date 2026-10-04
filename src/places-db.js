// Otevírací doba v D1: místa, jejich běžný týden a změny (dočasné i nová otevírací doba).
// Nová otevírací doba (`trvala`) se v den, kdy začne platit, propíše do běžných hodin místa (`settleNewHours`).
import { changeSpan, normalizeWeek, parseHours } from "./doctors.js";
import { addColumn, asBool, clip, requireChief } from "./db-core.js";
import { submitHours } from "./hours-requests-db.js";
import { NEW_HOURS_DAYS, PLACE_SEEDS } from "./places.js";
import { addDays, pragueNow } from "./waste.js";

export const PLACE_KINDS = { docasna: "Dočasná změna", trvala: "Nová otevírací doba" };
const SECTION = "oteviraci-doba";

const TABLES = [
  `create table if not exists places (
    id integer primary key autoincrement,
    name text not null,
    label text not null default '',
    place text not null default '',
    phone text not null default '',
    hours text not null,
    sort_order integer not null default 0,
    published integer not null default 1,
    offers text not null default ''
  )`,
  `create table if not exists place_changes (
    id integer primary key autoincrement,
    place_id integer not null,
    kind text not null default 'docasna',
    starts_on text not null,
    ends_on text not null,
    note text not null default '',
    hours text not null,
    applied integer not null default 0,
    source_url text not null default '',
    created_by integer,
    created_at text not null default (date('now'))
  )`,
];

// Při prvním založení tabulky dá do ní místa z webu města.
export async function ensurePlaceTables(env) {
  const exists = await env.DB.prepare("select 1 as ok from sqlite_master where type = 'table' and name = 'places'").first();
  for (const sql of TABLES) await env.DB.prepare(sql).run();
  const info = await env.DB.prepare("pragma table_info(places)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "offers", "alter table places add column offers text not null default ''");
  if (exists) return;
  for (const seed of PLACE_SEEDS) {
    await env.DB.prepare("insert into places (name, label, place, phone, hours, sort_order, published) values (?, ?, ?, ?, ?, ?, ?)")
      .bind(seed.name, seed.label, seed.place, seed.phone, JSON.stringify(seed.week), seed.sortOrder, seed.published)
      .run();
  }
}

const OFFERS_MAX = 40;
const OFFER_MAX = 160;

// Co místo nabízí: jedna věc na řádek, odrážky na začátku se zahodí. Prázdné nevadí.
export function offerLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-–•*·]\s*/, "").replace(/\s+/g, " ").trim().slice(0, OFFER_MAX))
    .filter(Boolean)
    .slice(0, OFFERS_MAX);
}

function mapPlace(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    label: String(row.label ?? ""),
    place: String(row.place ?? ""),
    phone: String(row.phone ?? ""),
    week: parseHours(row.hours),
    sortOrder: Number(row.sort_order ?? 0),
    published: asBool(row.published),
    offers: offerLines(row.offers),
    changes: [],
  };
}

function mapChange(row) {
  return {
    id: Number(row.id),
    placeId: Number(row.place_id),
    kind: row.kind === "trvala" ? "trvala" : "docasna",
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    note: String(row.note ?? ""),
    week: parseHours(row.hours),
    applied: asBool(row.applied),
    sourceUrl: String(row.source_url ?? ""),
    createdBy: row.created_by == null || row.created_by === "" ? null : Number(row.created_by),
  };
}

// Nová otevírací doba, která už platí, se stane běžnou. Řádek zůstane kvůli upozornění na titulce.
export async function settleNewHours(env, today = pragueNow().date) {
  const due = await env.DB.prepare(
    "select id, place_id, hours from place_changes where kind = 'trvala' and applied = 0 and starts_on <= ? order by starts_on asc, id asc",
  )
    .bind(today)
    .all();
  for (const row of due.results ?? []) {
    await env.DB.prepare("update places set hours = ? where id = ?").bind(row.hours, row.place_id).run();
    await env.DB.prepare("update place_changes set applied = 1 where id = ?").bind(row.id).run();
  }
}

export async function loadPlaces(env, { publicOnly = false, today = pragueNow().date } = {}) {
  await settleNewHours(env, today);
  const rows = await env.DB.prepare(
    `select id, name, label, place, phone, hours, sort_order, published, offers from places
     ${publicOnly ? "where published = 1" : ""} order by sort_order asc, id asc`,
  ).all();
  const places = (rows.results ?? []).map(mapPlace);
  if (!places.length) return [];
  const changes = await env.DB.prepare(
    `select id, place_id, kind, starts_on, ends_on, note, hours, applied, source_url, created_by from place_changes
     where (kind = 'docasna' and ends_on >= ?) or (kind = 'trvala' and starts_on >= ?)
     order by starts_on asc, id asc`,
  )
    .bind(today, addDays(today, -NEW_HOURS_DAYS))
    .all();
  const byId = new Map(places.map((place) => [place.id, place]));
  for (const row of changes.results ?? []) {
    const change = mapChange(row);
    byId.get(change.placeId)?.changes.push(change);
  }
  return places;
}

function readPlace(input) {
  const name = clip(input.name, 120);
  const label = clip(input.label, 120);
  const place = clip(input.place, 160);
  const phone = clip(input.phone, 40);
  const normalized = normalizeWeek(input.doctorWeek);
  if (normalized.error) return normalized;
  const sortOrder = Number(input.sortOrder);
  if (name.length < 2) return { error: "Doplňte název místa." };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) return { error: "Pořadí musí být číslo od 0 do 999." };
  const offers = offerLines(input.offers).join("\n");
  return { name, label, place, phone, hours: JSON.stringify(normalized.week), sortOrder, published: input.published ? 1 : 0, offers };
}

export async function savePlace(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = readPlace(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  const values = [parsed.name, parsed.label, parsed.place, parsed.phone, parsed.hours, parsed.sortOrder, parsed.published, parsed.offers];
  if (input.id) {
    const current = await env.DB.prepare("select id from places where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tohle místo už tu není." };
    await env.DB.prepare("update places set name = ?, label = ?, place = ?, phone = ?, hours = ?, sort_order = ?, published = ?, offers = ? where id = ?")
      .bind(...values, input.id)
      .run();
    return { ok: true, updated: true };
  }
  await env.DB.prepare("insert into places (name, label, place, phone, hours, sort_order, published, offers) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(...values)
    .run();
  return { ok: true, updated: false };
}

export async function removePlace(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from place_changes where place_id = ?").bind(id).run();
  await env.DB.prepare("delete from places where id = ?").bind(id).run();
  return { ok: true };
}

// Posune místo o jedno nahoru (`up`) nebo dolů. Pořadí všech míst přečísluje po deseti, ať jde zase posouvat.
export async function movePlace(env, request, id, direction) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const rows = await env.DB.prepare("select id from places order by sort_order asc, id asc").all();
  const ids = (rows.results ?? []).map((row) => Number(row.id));
  const from = ids.indexOf(Number(id));
  if (from < 0) return { ok: false, error: "Tohle místo už tu není." };
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return { ok: true };
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await env.DB.batch(ids.map((placeId, index) => env.DB.prepare("update places set sort_order = ? where id = ?").bind((index + 1) * 10, placeId)));
  return { ok: true };
}

// Změnu zapíše redakce i Drběna. Stejnou změnu podruhé nezapíše a vrátí tu, co už je.
export async function insertPlaceChange(env, { placeId, kind, startsOn, endsOn, note, week, sourceUrl = "", createdBy = null }) {
  const hours = JSON.stringify(week);
  const end = kind === "trvala" ? startsOn : endsOn;
  const same = await env.DB.prepare(
    "select id from place_changes where place_id = ? and kind = ? and starts_on = ? and ends_on = ? and hours = ?",
  )
    .bind(placeId, kind, startsOn, end, hours)
    .first();
  if (same) return Number(same.id);
  const result = await env.DB.prepare(
    "insert into place_changes (place_id, kind, starts_on, ends_on, note, hours, source_url, created_by) values (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(placeId, kind, startsOn, end, note, hours, sourceUrl, createdBy)
    .run();
  return Number(result.meta.last_row_id);
}

async function placeExists(env, id) {
  return Boolean(await env.DB.prepare("select id from places where id = ?").bind(id).first());
}

function readPlaceHours(input) {
  const normalized = normalizeWeek(input.doctorWeek);
  return normalized.error ? normalized : { week: normalized.week };
}

function readPlaceOffers(input) {
  return { offers: offerLines(input.offers) };
}

function readPlaceChange(input) {
  const kind = input.kind === "trvala" ? "trvala" : "docasna";
  const span = changeSpan(input.startsOn, kind === "trvala" ? "" : input.endsOn);
  if (span.error) return span;
  const note = clip(input.changeNote, 400);
  if (kind === "docasna" && note.length < 3) return { error: "Napište poznámku k dočasné změně." };
  const normalized = normalizeWeek(input.doctorWeek);
  if (normalized.error) return normalized;
  return { kind, startsOn: span.startsOn, endsOn: span.endsOn, note, week: normalized.week };
}

// Co jde u místa změnit rovnou nebo poslat ke schválení (src/hours-requests-db.js).
export const PLACE_ACTIONS = {
  // Oprava běžných hodin bez upozornění na titulce.
  hodiny: {
    read: readPlaceHours,
    target: placeExists,
    missing: "Tohle místo už tu není.",
    apply: async (env, placeId, value) => {
      await env.DB.prepare("update places set hours = ? where id = ?").bind(JSON.stringify(value.week), placeId).run();
      return { ok: true };
    },
  },
  // Co místo nabízí (seznam v okně na webu, ví o něm i Drběna v chatu).
  nabidka: {
    read: readPlaceOffers,
    target: placeExists,
    missing: "Tohle místo už tu není.",
    apply: async (env, placeId, value) => {
      await env.DB.prepare("update places set offers = ? where id = ?").bind(value.offers.join("\n"), placeId).run();
      return { ok: true };
    },
  },
  zmena: {
    read: readPlaceChange,
    target: placeExists,
    missing: "Tohle místo už tu není.",
    apply: async (env, placeId, value, userId) => {
      await insertPlaceChange(env, { placeId, ...value, createdBy: userId });
      return { ok: true };
    },
  },
  zrusit: {
    fields: false,
    read: () => ({}),
    target: async (env, id) => Boolean(await env.DB.prepare("select id from place_changes where id = ?").bind(id).first()),
    missing: "Tahle změna už tu není.",
    apply: async (env, changeId) => {
      await env.DB.prepare("delete from place_changes where id = ?").bind(changeId).run();
      return { ok: true };
    },
  },
};

const submit = (env, request, action, targetId, input = {}) =>
  submitHours(env, request, { section: SECTION, actions: PLACE_ACTIONS, action, targetId, input });

export const savePlaceHours = (env, request, input) => submit(env, request, "hodiny", input.placeId, input);
export const savePlaceOffers = (env, request, input) => submit(env, request, "nabidka", input.placeId, input);
export const savePlaceChange = (env, request, input) => submit(env, request, "zmena", input.placeId, input);
export const removePlaceChange = (env, request, id) => submit(env, request, "zrusit", id);

// Místo podle názvu (bez ohledu na velikost písmen), nebo nové. Pro Drběnu, když zpráva mluví o místě, které drbna nezná.
export async function placeByName(env, name, label = "") {
  const clean = clip(name, 120);
  const found = await env.DB.prepare("select id from places where lower(name) = lower(?)").bind(clean).first();
  if (found) return Number(found.id);
  const result = await env.DB.prepare("insert into places (name, label, place, phone, hours, sort_order, published) values (?, ?, 'Kopidlno', '', ?, 100, 1)")
    .bind(clean, clip(label, 120), JSON.stringify(normalizeWeek([]).week))
    .run();
  return Number(result.meta.last_row_id);
}
