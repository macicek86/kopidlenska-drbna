// Lékaři v D1: ordinace, ordinační hodiny a dočasné změny.
import { asBool, clip, requireChief } from "./db-core.js";
import { submitHours } from "./hours-requests-db.js";
import { removeLinksOf } from "./hours-links-db.js";
import { removeMailTargetsOf } from "./mailin/store.js";
import { changeSpan, normalizeWeek as normalizeDoctorWeek, parseHours as parseDoctorHours } from "./doctors.js";

function mapDoctor(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    specialty: String(row.specialty ?? ""),
    place: String(row.place ?? ""),
    phone: String(row.phone ?? ""),
    week: parseDoctorHours(row.hours),
    sortOrder: Number(row.sort_order ?? 0),
    published: asBool(row.published),
    changes: [],
  };
}

function mapDoctorChange(row) {
  return {
    id: Number(row.id),
    doctorId: Number(row.doctor_id),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    note: String(row.note ?? ""),
    week: parseDoctorHours(row.hours),
    createdBy: row.created_by == null || row.created_by === "" ? null : Number(row.created_by),
  };
}

export async function loadDoctors(env, { publicOnly = false, today = null } = {}) {
  const doctorSql = publicOnly
    ? `select id, name, specialty, place, phone, hours, sort_order, published
       from doctors where published = 1 order by sort_order asc, id asc`
    : `select id, name, specialty, place, phone, hours, sort_order, published
       from doctors order by sort_order asc, id asc`;
  const doctors = ((await env.DB.prepare(doctorSql).all()).results ?? []).map(mapDoctor);
  if (!doctors.length) return [];
  let changeSql = "select id, doctor_id, starts_on, ends_on, note, hours, created_by from doctor_changes";
  const binds = [];
  if (today) {
    changeSql += " where ends_on >= ?";
    binds.push(today);
  }
  changeSql += " order by starts_on asc, id asc";
  const query = env.DB.prepare(changeSql);
  const rows = binds.length ? await query.bind(...binds).all() : await query.all();
  const byDoctor = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  for (const row of rows.results ?? []) {
    const change = mapDoctorChange(row);
    const doctor = byDoctor.get(change.doctorId);
    if (doctor) doctor.changes.push(change);
  }
  return doctors;
}

function readDoctor(input) {
  const name = clip(input.name, 120);
  const specialty = clip(input.specialty, 120);
  const place = clip(input.place, 160);
  const phone = clip(input.phone, 40);
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return normalized;
  const sortOrder = Number(input.sortOrder);
  if (name.length < 2) return { error: "Doplňte jméno lékaře nebo ordinace." };
  if (specialty.length < 2) return { error: "Doplňte obor." };
  if (place.length < 2) return { error: "Doplňte místo." };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    return { error: "Pořadí musí být číslo od 0 do 999." };
  }
  return {
    name,
    specialty,
    place,
    phone,
    hours: JSON.stringify(normalized.week),
    sortOrder,
    published: input.published ? 1 : 0,
  };
}

export async function saveDoctor(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const parsed = readDoctor(input);
  if (parsed.error) return { ok: false, error: parsed.error };
  if (input.id) {
    const current = await env.DB.prepare("select id from doctors where id = ?").bind(input.id).first();
    if (!current) return { ok: false, error: "Tahle ordinace už tu není." };
    await env.DB.prepare(
      "update doctors set name = ?, specialty = ?, place = ?, phone = ?, hours = ?, sort_order = ?, published = ? where id = ?",
    )
      .bind(parsed.name, parsed.specialty, parsed.place, parsed.phone, parsed.hours, parsed.sortOrder, parsed.published, input.id)
      .run();
    return { ok: true, updated: true };
  }
  await env.DB.prepare(
    "insert into doctors (name, specialty, place, phone, hours, sort_order, published) values (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(parsed.name, parsed.specialty, parsed.place, parsed.phone, parsed.hours, parsed.sortOrder, parsed.published)
    .run();
  return { ok: true, updated: false };
}

export async function removeDoctor(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from doctor_changes where doctor_id = ?").bind(id).run();
  await removeLinksOf(env, "lekari", id);
  await removeMailTargetsOf(env, "lekari", id);
  await env.DB.prepare("delete from doctors where id = ?").bind(id).run();
  return { ok: true };
}

async function doctorExists(env, id) {
  return Boolean(await env.DB.prepare("select id from doctors where id = ?").bind(id).first());
}

function readDoctorHours(input) {
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  return normalized.error ? normalized : { week: normalized.week };
}

// Obor, místo a telefon. Jméno mění jen hlavní redaktor.
function readDoctorDetails(input) {
  const specialty = clip(input.specialty, 120);
  const place = clip(input.place, 160);
  if (specialty.length < 2) return { error: "Doplňte obor." };
  if (place.length < 2) return { error: "Doplňte místo." };
  return { specialty, place, phone: clip(input.phone, 40) };
}

function readDoctorChange(input) {
  const span = changeSpan(input.startsOn, input.endsOn);
  if (span.error) return span;
  const note = clip(input.changeNote, 400);
  if (note.length < 3) return { error: "Napište poznámku k dočasné změně." };
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return normalized;
  return { startsOn: span.startsOn, endsOn: span.endsOn, note, week: normalized.week };
}

// Co jde u ordinace změnit rovnou nebo poslat ke schválení (src/hours-requests-db.js).
export const DOCTOR_ACTIONS = {
  hodiny: {
    read: readDoctorHours,
    target: doctorExists,
    missing: "Tahle ordinace už tu není.",
    apply: async (env, doctorId, value) => {
      await env.DB.prepare("update doctors set hours = ? where id = ?").bind(JSON.stringify(value.week), doctorId).run();
      return { ok: true };
    },
  },
  udaje: {
    read: readDoctorDetails,
    target: doctorExists,
    missing: "Tahle ordinace už tu není.",
    apply: async (env, doctorId, value) => {
      await env.DB.prepare("update doctors set specialty = ?, place = ?, phone = ? where id = ?").bind(value.specialty, value.place, value.phone, doctorId).run();
      return { ok: true };
    },
  },
  zmena: {
    read: readDoctorChange,
    target: doctorExists,
    missing: "Tahle ordinace už tu není.",
    apply: async (env, doctorId, value, userId) => {
      await env.DB.prepare(
        "insert into doctor_changes (doctor_id, starts_on, ends_on, note, hours, created_by) values (?, ?, ?, ?, ?, ?)",
      )
        .bind(doctorId, value.startsOn, value.endsOn, value.note, JSON.stringify(value.week), userId)
        .run();
      return { ok: true };
    },
  },
  zrusit: {
    fields: false,
    read: () => ({}),
    target: async (env, id) => Boolean(await env.DB.prepare("select id from doctor_changes where id = ?").bind(id).first()),
    missing: "Tahle změna už tu není.",
    apply: async (env, changeId) => {
      await env.DB.prepare("delete from doctor_changes where id = ?").bind(changeId).run();
      return { ok: true };
    },
  },
};

const submit = (env, request, action, targetId, input = {}) =>
  submitHours(env, request, { section: "lekari", actions: DOCTOR_ACTIONS, action, targetId, input });

export const saveDoctorHours = (env, request, input) => submit(env, request, "hodiny", input.doctorId, input);
export const saveDoctorDetails = (env, request, input) => submit(env, request, "udaje", input.doctorId, input);
export const saveDoctorChange = (env, request, input) => submit(env, request, "zmena", input.doctorId, input);
export const removeDoctorChange = (env, request, id) => submit(env, request, "zrusit", id);
