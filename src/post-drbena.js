// Formulář sekce Koza Drběna: uložení povahy.
import { saveDrbena } from "./drbena-db.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/drbena";

export const DRBENA_OK = { drbena: "Povaha Drběny je uložená." };

export async function drbenaPost(path, request, env, fields) {
  if (path !== `${BASE}/ulozit`) return null;
  const result = await saveDrbena(env, request, fields);
  if (!result.ok) return redirect(withError(BASE, result.error));
  return redirect(`${BASE}?ok=drbena`);
}
