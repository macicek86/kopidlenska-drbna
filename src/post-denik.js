// Formuláře sekce Deník: nastavení importu, tlačítko Zkontrolovat teď a ruční puštění článku v detailu.
import { redirect, withError } from "./http.js";
import { checkDenikNow, selectDenik } from "./denik/run.js";
import { saveDenikSettings } from "./denik/store.js";

const BASE = "/redakce/denik";

export const DENIK_OK = {
  "denik-nastaveni": "Nastavení Deníku je uložené.",
  "denik-nacteno": "Načteno. Drběna nové zpracovává na pozadí, stránka se sama obnoví.",
  "denik-nic": "V Deníku teď není nic nového o Kopidlnu.",
  "denik-bezi": "Drběna se do toho pustila. Stránka se sama obnoví, až bude hotovo.",
};

export async function denikPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveDenikSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=denik-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkDenikNow(env, request, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.added ? "denik-nacteno" : "denik-nic"}`);
  }
  if (path === `${BASE}/zpracovat`) {
    const back = fields.id ? `${BASE}?zprava=${fields.id}` : BASE;
    const result = await selectDenik(env, request, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=denik-bezi`);
  }
  return null;
}
