// Formuláře sekce Koza Drběna: uložení povahy a zkouška, jak by Drběna napsala vložený článek.
import { adminDrbena } from "./admin/drbena.js";
import { loadAdmin } from "./db.js";
import { requireChief } from "./db-core.js";
import { saveDrbena } from "./drbena-db.js";
import { readTry, tryVoice } from "./drbena-try.js";
import { html, redirect, withError } from "./http.js";

const BASE = "/redakce/drbena";

export const DRBENA_OK = { drbena: "Povaha Drběny je uložená." };

export async function drbenaPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/zkusit`) {
    const gate = await requireChief(env, request);
    if (!gate.ok) return redirect(withError(BASE, gate.error));
    const input = readTry(fields);
    const result = await tryVoice(env, input);
    const data = await loadAdmin(env, request);
    return html(adminDrbena(ctx, data, { text: "", kind: "ok" }, { input, result }));
  }
  if (path !== `${BASE}/ulozit`) return null;
  const result = await saveDrbena(env, request, fields);
  if (!result.ok) return redirect(withError(BASE, result.error));
  return redirect(`${BASE}?ok=drbena`);
}
