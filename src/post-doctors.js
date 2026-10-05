// Formuláře sekce Lékaři: ordinace, ordinační hodiny, dočasné změny a návrhy ke schválení.
import { DOCTOR_ACTIONS, removeDoctor, removeDoctorChange, saveDoctor, saveDoctorChange, saveDoctorDetails, saveDoctorHours } from "./doctors-db.js";
import { redirect, withError } from "./http.js";
import { requestPost, submitted } from "./post-requests.js";

const BASE = "/redakce/lekari";

export const DOCTORS_OK = {
  lekar: "Ordinace je uložená.",
  "lekar-upraven": "Ordinace je upravená.",
  "lekar-smazan": "Ordinace je smazaná.",
  "lekar-hodiny": "Ordinační hodiny jsou uložené.",
  "lekar-udaje": "Údaje ordinace jsou uložené.",
  "lekar-zmena": "Dočasná změna je zapsaná.",
  "lekar-zmena-smazana": "Dočasná změna je zrušená.",
};

export async function doctorsPost(path, request, env, fields) {
  if (!path.startsWith(BASE)) return null;
  if (path === `${BASE}/ulozit`) {
    const result = await saveDoctor(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?id=${fields.id}` : BASE, result.error));
    return redirect(`${BASE}?ok=${result.updated ? "lekar-upraven" : "lekar"}`);
  }
  if (path === `${BASE}/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeDoctor(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=lekar-smazan`);
  }
  if (path === `${BASE}/hodiny`) return submitted(BASE, await saveDoctorHours(env, request, fields), "lekar-hodiny");
  if (path === `${BASE}/udaje`) return submitted(BASE, await saveDoctorDetails(env, request, fields), "lekar-udaje");
  if (path === `${BASE}/zmena`) return submitted(BASE, await saveDoctorChange(env, request, fields), "lekar-zmena");
  if (path === `${BASE}/zmena/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    return submitted(BASE, await removeDoctorChange(env, request, fields.id), "lekar-zmena-smazana");
  }
  return requestPost(path, request, env, fields, { base: BASE, section: "lekari", actions: DOCTOR_ACTIONS });
}
