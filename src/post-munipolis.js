// Formuláře sekce Munipolis: nastavení importu, tlačítko Zkontrolovat teď a ruční puštění zprávy v detailu.
import { redirect, withError } from "./http.js";
import { checkImportNow, selectImport } from "./munipolis/run.js";
import { saveImportSettings } from "./munipolis/store.js";

const BASE = "/redakce/munipolis";

export const IMPORT_OK = {
  "import-nastaveni": "Nastavení importu je uložené.",
  "import-nacteno": "Načteno. Drběna nové zpracovává na pozadí, stránka se sama obnoví.",
  "import-nic": "Na Munipolisu není nic nového.",
  "import-bezi": "Drběna se do toho pustila. Stránka se sama obnoví, až bude hotovo.",
};

export async function munipolisPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveImportSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=import-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkImportNow(env, request, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.added ? "import-nacteno" : "import-nic"}`);
  }
  if (path === `${BASE}/zpracovat`) {
    const back = fields.id ? `${BASE}?zprava=${fields.id}` : BASE;
    const result = await selectImport(env, request, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=import-bezi`);
  }
  return null;
}
