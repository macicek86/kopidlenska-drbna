// Formuláře sekce Fotbal: nastavení, ruční kontrola webu klubu a zpracování jedné aktuality.
import { checkFootballNow, runFootballOne } from "./fotbal/run.js";
import { saveFootballSettings } from "./fotbal/store.js";
import { redirect, withError } from "./http.js";
import { pragueNow } from "./waste.js";

const BASE = "/redakce/fotbal";

export const FOOTBALL_OK = {
  "fotbal-nastaveni": "Nastavení fotbalu je uložené.",
  "fotbal-hotovo": "Web klubu je zkontrolovaný.",
  "fotbal-zprava": "Aktualita je zpracovaná.",
  "fotbal-bezi": "Drběna píše. Stránka se sama obnoví, až bude hotovo.",
};

export async function footballPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveFootballSettings(env, request, fields, pragueNow().date);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=fotbal-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkFootballNow(env, request, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.background ? "fotbal-bezi" : "fotbal-hotovo"}`);
  }
  if (path === `${BASE}/zpracovat`) {
    const result = await runFootballOne(env, request, fields.id, { ctx });
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?zprava=${fields.id}` : BASE, result.error));
    return redirect(`${BASE}?zprava=${fields.id}&ok=${result.background ? "fotbal-bezi" : "fotbal-zprava"}`);
  }
  return null;
}
