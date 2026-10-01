// Formuláře sekce Munipolis: nastavení importu, ruční načtení a zpracování vybraných zpráv.
import { redirect, withError } from "./http.js";
import { checkImportNow, selectImport } from "./munipolis/run.js";
import { saveImportSettings } from "./munipolis/store.js";

const BASE = "/redakce/munipolis";

export const IMPORT_OK = {
  "import-nastaveni": "Nastavení importu je uložené.",
  "import-nacteno": "Zprávy jsou načtené. Zaškrtněte, které má Drběna zpracovat.",
  "import-nic": "Na Munipolisu není nic nového.",
  "import-bezi": "Drběna čte vybrané. Stránka se sama obnoví, až bude hotovo.",
};

export async function munipolisPost(path, request, env, fields, ctx) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveImportSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=import-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await checkImportNow(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.added ? "import-nacteno" : "import-nic"}`);
  }
  if (path === `${BASE}/vybrat`) {
    const result = await selectImport(env, request, fields.ids, { ctx });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=import-bezi`);
  }
  if (path === `${BASE}/zpracovat`) {
    const back = fields.id ? `${BASE}?zprava=${fields.id}` : BASE;
    const result = await selectImport(env, request, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=import-bezi`);
  }
  return null;
}
