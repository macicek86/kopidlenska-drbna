// Lékaři v D1: ordinace, ordinační hodiny a dočasné změny.
import { asBool, clip, requireChief, requireUser, userCan } from "./db-core.js";
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
  await env.DB.prepare("delete from doctors where id = ?").bind(id).run();
  return { ok: true };
}

async function requireDoctorHours(env, request) {
  const gate = await requireUser(env, request);
  if (!gate.ok) return gate;
  if (!userCan(gate.user, "doktori")) {
    return { ok: false, error: "Ordinační hodiny mění hlavní redaktor, nebo člověk s oprávněním Lékaři." };
  }
  return gate;
}

export async function saveDoctorHours(env, request, input) {
  const gate = await requireDoctorHours(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const doctor = await env.DB.prepare("select id from doctors where id = ?").bind(input.doctorId).first();
  if (!doctor) return { ok: false, error: "Tahle ordinace už tu není." };
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return { ok: false, error: normalized.error };
  await env.DB.prepare("update doctors set hours = ? where id = ?").bind(JSON.stringify(normalized.week), doctor.id).run();
  return { ok: true };
}

export async function saveDoctorChange(env, request, input) {
  const gate = await requireDoctorHours(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const doctor = await env.DB.prepare("select id from doctors where id = ?").bind(input.doctorId).first();
  if (!doctor) return { ok: false, error: "Tahle ordinace už tu není." };
  const span = changeSpan(input.startsOn, input.endsOn);
  if (span.error) return { ok: false, error: span.error };
  const note = clip(input.changeNote, 400);
  if (note.length < 3) return { ok: false, error: "Napište poznámku k dočasné změně." };
  const normalized = normalizeDoctorWeek(input.doctorWeek);
  if (normalized.error) return { ok: false, error: normalized.error };
  await env.DB.prepare(
    "insert into doctor_changes (doctor_id, starts_on, ends_on, note, hours, created_by) values (?, ?, ?, ?, ?, ?)",
  )
    .bind(doctor.id, span.startsOn, span.endsOn, note, JSON.stringify(normalized.week), gate.user.id)
    .run();
  return { ok: true };
}

export async function removeDoctorChange(env, request, id) {
  const gate = await requireDoctorHours(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from doctor_changes where id = ?").bind(id).run();
  return { ok: true };
}
