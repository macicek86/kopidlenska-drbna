// Formuláře sekce Koza Drběna: uložení povahy a zkouška, jak by Drběna napsala vložený článek.
import { adminDrbena } from "./admin/drbena.js";
import { loadAssistAdmin, saveAssistSettings } from "./assist/store.js";
import { loadAdmin } from "./db.js";
import { requireChief } from "./db-core.js";
import { saveDrbena, saveFollowupSetting, saveMemorySetting, saveSpreadSetting } from "./drbena-db.js";
import { readTry, tryVoice } from "./drbena-try.js";
import { html, redirect, withError } from "./http.js";
import { pragueNow } from "./waste.js";

const BASE = "/redakce/drbena";

export const DRBENA_OK = {
  drbena: "Povaha Drběny je uložená.",
  "drbena-navazujici": "Nastavení navazujících zpráv je uložené.",
  "drbena-pamet": "Nastavení paměti je uložené.",
  "drbena-rozestup": "Rozestup zveřejňování je uložený.",
  "drbena-pomocnik": "Limity pomocníka při psaní jsou uložené.",
};

export async function drbenaPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/zkusit`) {
    const gate = await requireChief(env, request);
    if (!gate.ok) return redirect(withError(BASE, gate.error));
    const input = readTry(fields);
    const result = await tryVoice(env, input);
    const data = await loadAdmin(env, request);
    data.assist = await loadAssistAdmin(env, pragueNow().date);
    return html(adminDrbena(ctx, data, { text: "", kind: "ok" }, { input, result }));
  }
  if (path === `${BASE}/pomocnik`) {
    const result = await saveAssistSettings(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=drbena-pomocnik`);
  }
  if (path === `${BASE}/navazujici`) {
    const result = await saveFollowupSetting(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=drbena-navazujici`);
  }
  if (path === `${BASE}/pamet`) {
    const result = await saveMemorySetting(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=drbena-pamet`);
  }
  if (path === `${BASE}/rozestup`) {
    const result = await saveSpreadSetting(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=drbena-rozestup`);
  }
  if (path !== `${BASE}/ulozit`) return null;
  const result = await saveDrbena(env, request, fields);
  if (!result.ok) return redirect(withError(BASE, result.error));
  return redirect(`${BASE}?ok=drbena`);
}
