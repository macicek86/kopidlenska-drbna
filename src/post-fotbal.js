// Formuláře sekce Fotbal: nastavení, ruční načtení webu klubu a zpracování vybraných aktualit.
import { checkFootballNow, selectFootball } from "./fotbal/run.js";
import { saveFootballSettings } from "./fotbal/store.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/fotbal";

export const FOOTBALL_OK = {
  "fotbal-nastaveni": "Nastavení fotbalu je uložené.",
  "fotbal-nacteno": "Aktuality jsou načtené. Zaškrtněte, které má Drběna zpracovat.",
  "fotbal-nic": "Na webu klubu není nic nového.",
  "fotbal-bezi": "Drběna píše vybrané. Stránka se sama obnoví, až bude hotovo.",
};

export async function footballPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveFootballSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=fotbal-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkFootballNow(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.added ? "fotbal-nacteno" : "fotbal-nic"}`);
  }
  if (path === `${BASE}/vybrat`) {
    const result = await selectFootball(env, request, fields.ids, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=fotbal-bezi`);
  }
  if (path === `${BASE}/zpracovat`) {
    const back = fields.id ? `${BASE}?zprava=${fields.id}` : BASE;
    const result = await selectFootball(env, request, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=fotbal-bezi`);
  }
  return null;
}
