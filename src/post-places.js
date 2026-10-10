// Formuláře sekce Otevírací doba: místa, oprava doby, dočasné změny, nová otevírací doba a návrhy ke schválení.
import { PLACE_ACTIONS, loadPlaces, movePlace, removePlace, removePlaceChange, savePlace, savePlaceChange, savePlaceDetails, savePlaceHours, savePlaceOffers } from "./places-db.js";
import { redirect, withError } from "./http.js";
import { requestPost, submitted } from "./post-requests.js";
import { submitPeriods } from "./post-periods.js";

const BASE = "/redakce/oteviraci-doba";

export const PLACES_OK = {
  misto: "Místo je uložené.",
  "misto-upraveno": "Místo je upravené.",
  "misto-smazano": "Místo je smazané.",
  "misto-poradi": "Pořadí míst je uložené.",
  "misto-doba": "Otevírací doba je opravená.",
  "misto-nabidka": "Seznam, co tu najdete, je uložený.",
  "misto-udaje": "Adresa a telefon jsou uložené.",
  "misto-zmena": "Dočasná změna je zapsaná.",
  "misto-zmeny": "Změny otevírací doby jsou zapsané.",
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
  if (path === `${BASE}/posunout`) {
    if (!fields.id) return redirect(BASE);
    const result = await movePlace(env, request, fields.id, fields.direction);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=misto-poradi#misto-${fields.id}`);
  }
  if (path === `${BASE}/hodiny`) return submitted(BASE, await savePlaceHours(env, request, fields), "misto-doba");
  if (path === `${BASE}/udaje`) return submitted(BASE, await savePlaceDetails(env, request, fields), "misto-udaje");
  if (path === `${BASE}/nabidka`) return submitted(BASE, await savePlaceOffers(env, request, fields), "misto-nabidka");
  if (path === `${BASE}/zmena`) {
    // Nová doba natrvalo je jedna změna; dočasné změny jdou z formuláře s více obdobími.
    if (fields.kind === "trvala") {
      const result = await savePlaceChange(env, request, fields);
      return submitted(BASE, result, "misto-nova-doba");
    }
    const place = (await loadPlaces(env)).find((row) => row.id === fields.placeId);
    return submitPeriods({
      base: BASE,
      back: `${BASE}?zmena=${fields.placeId ?? ""}`,
      section: "oteviraci-doba",
      actions: PLACE_ACTIONS,
      idField: "placeId",
      targetId: fields.placeId,
      periods: fields.periods,
      regular: place?.week ?? null,
      shape: "week2",
      save: (input) => savePlaceChange(env, request, input),
      okKey: "misto-zmena",
      manyKey: "misto-zmeny",
    });
  }
  if (path === `${BASE}/zmena/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    return submitted(BASE, await removePlaceChange(env, request, fields.id), "misto-zmena-smazana");
  }
  return requestPost(path, request, env, fields, { base: BASE, section: "oteviraci-doba", actions: PLACE_ACTIONS });
}
