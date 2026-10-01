// Formuláře sekce Deník: nastavení importu, ruční načtení a zpracování vybraných článků.
import { redirect, withError } from "./http.js";
import { checkDenikNow, selectDenik } from "./denik/run.js";
import { saveDenikSettings } from "./denik/store.js";

const BASE = "/redakce/denik";

export const DENIK_OK = {
  "denik-nastaveni": "Nastavení Deníku je uložené.",
  "denik-nacteno": "Články jsou načtené. Zaškrtněte, které má Drběna zpracovat.",
  "denik-nic": "V Deníku teď není nic nového o Kopidlnu.",
  "denik-bezi": "Drběna čte vybrané. Stránka se sama obnoví, až bude hotovo.",
};

export async function denikPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveDenikSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=denik-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkDenikNow(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.added ? "denik-nacteno" : "denik-nic"}`);
  }
  if (path === `${BASE}/vybrat`) {
    const result = await selectDenik(env, request, fields.ids, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=denik-bezi`);
  }
  if (path === `${BASE}/zpracovat`) {
    const back = fields.id ? `${BASE}?zprava=${fields.id}` : BASE;
    const result = await selectDenik(env, request, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=denik-bezi`);
  }
  return null;
}
