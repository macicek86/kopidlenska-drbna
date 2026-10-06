// Formuláře stránky Akce v okolí: nastavení, ruční načtení programů, víkendový článek a schování akce.
import { redirect, withError } from "./http.js";
import { checkOkoliNow, writeOkoliNow } from "./okoli/run.js";
import { hideNearbyEvent, saveOkoliSettings } from "./okoli/store.js";

const BASE = "/redakce/okoli";

export const OKOLI_OK = {
  "okoli-nastaveni": "Nastavení je uložené.",
  "okoli-nacteno": "Akce z okolí jsou načtené.",
  "okoli-clanek": "Drběna je s článkem hotová.",
  "okoli-schovano": "Akce je schovaná, do článku nepůjde.",
  "okoli-vraceno": "Akce je zase vidět.",
};

export async function okoliPost(path, request, env, fields) {
  if (!path.startsWith(`${BASE}/`)) return null;
  if (path === `${BASE}/ulozit`) {
    const result = await saveOkoliSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=okoli-nastaveni`);
  }
  if (path === `${BASE}/nacist`) {
    const result = await checkOkoliNow(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=okoli-nacteno`);
  }
  if (path === `${BASE}/napsat`) {
    const result = await writeOkoliNow(env, request, { from: fields.fromDay, to: fields.toDay });
    if (!result.ok) return redirect(withError(`${BASE}?napsat=1`, result.error));
    return redirect(`${BASE}?ok=okoli-clanek`);
  }
  if (path === `${BASE}/schovat`) {
    const hide = fields.kind !== "ukazat";
    const result = await hideNearbyEvent(env, request, fields.id, hide);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${hide ? "okoli-schovano" : "okoli-vraceno"}`);
  }
  return null;
}
