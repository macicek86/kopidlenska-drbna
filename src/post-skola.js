// Formuláře sekce Škola: nastavení importu z webu ZŠ a MŠ, ruční načtení a zpracování vybraných článků.
import { redirect, withError } from "./http.js";
import { checkSkolaNow, selectSkola } from "./skola/run.js";
import { saveSkolaSettings } from "./skola/store.js";

const BASE = "/redakce/skola";

export const SKOLA_OK = {
  "skola-nastaveni": "Nastavení školy je uložené.",
  "skola-nacteno": "Články jsou načtené. Zaškrtněte, které má Drběna zpracovat.",
  "skola-nic": "Na webu školy teď není nic nového.",
  "skola-bezi": "Drběna čte vybrané. Stránka se sama obnoví, až bude hotovo.",
};

export async function skolaPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveSkolaSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=skola-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkSkolaNow(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.added ? "skola-nacteno" : "skola-nic"}`);
  }
  if (path === `${BASE}/vybrat`) {
    const result = await selectSkola(env, request, fields.ids, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=skola-bezi`);
  }
  if (path === `${BASE}/zpracovat`) {
    const back = fields.id ? `${BASE}?zprava=${fields.id}` : BASE;
    const result = await selectSkola(env, request, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=skola-bezi`);
  }
  return null;
}
