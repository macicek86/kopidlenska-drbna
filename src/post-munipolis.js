// Formuláře sekce Munipolis: nastavení importu, ruční kontrola a zpracování jedné zprávy.
import { redirect, withError } from "./http.js";
import { runImport, runOne } from "./munipolis/run.js";
import { saveImportSettings } from "./munipolis/store.js";

const BASE = "/redakce/munipolis";

export const IMPORT_OK = {
  "import-nastaveni": "Nastavení importu je uložené.",
  "import-hotovo": "Kontrola proběhla.",
  "import-zprava": "Zpráva je zpracovaná.",
};

export async function munipolisPost(path, request, env, fields) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveImportSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni=1`, result.error));
    return redirect(`${BASE}?ok=import-nastaveni`);
  }
  if (path === `${BASE}/zkontrolovat`) {
    const result = await runImport(env, { request });
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=import-hotovo`);
  }
  if (path === `${BASE}/zpracovat`) {
    const result = await runOne(env, request, fields.id);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?zprava=${fields.id}` : BASE, result.error));
    return redirect(`${BASE}?zprava=${fields.id}&ok=import-zprava`);
  }
  return null;
}
