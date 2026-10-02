// Formuláře sekce Otevírací doba: místa, oprava doby, dočasné změny a nová otevírací doba.
import { removePlace, removePlaceChange, savePlace, savePlaceChange, savePlaceHours } from "./places-db.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/oteviraci-doba";

export const PLACES_OK = {
  misto: "Místo je uložené.",
  "misto-upraveno": "Místo je upravené.",
  "misto-smazano": "Místo je smazané.",
  "misto-doba": "Otevírací doba je opravená.",
  "misto-zmena": "Dočasná změna je zapsaná.",
  "misto-nova-doba": "Nová otevírací doba je zapsaná.",
  "misto-zmena-smazana": "Změna je zrušená.",
};

export async function placesPost(path, request, env, fields) {
  if (!path.startsWith(BASE)) return null;
  if (path === `${BASE}/ulozit`) {
    const result = await savePlace(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?id=${fields.id}` : `${BASE}?novy=1`, result.error));
    return redirect(`${BASE}?ok=${result.updated ? "misto-upraveno" : "misto"}`);
  }
  if (path === `${BASE}/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removePlace(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=misto-smazano`);
  }
  if (path === `${BASE}/hodiny`) {
    const result = await savePlaceHours(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=misto-doba`);
  }
  if (path === `${BASE}/zmena`) {
    const result = await savePlaceChange(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.kind === "trvala" ? "misto-nova-doba" : "misto-zmena"}`);
  }
  if (path === `${BASE}/zmena/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removePlaceChange(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=misto-zmena-smazana`);
  }
  return null;
}
