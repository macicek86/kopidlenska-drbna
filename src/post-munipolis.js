// Formuláře sekce Munipolis: nastavení importu, ruční kontrola a zpracování jedné zprávy.
import { redirect, withError } from "./http.js";
import { checkImportNow, runOne } from "./munipolis/run.js";
import { saveImportSettings } from "./munipolis/store.js";

const BASE = "/redakce/munipolis";

export const IMPORT_OK = {
  "import-nastaveni": "Nastavení importu je uložené.",
  "import-hotovo": "Kontrola proběhla.",
  "import-zprava": "Zpráva je zpracovaná.",
  "import-bezi": "Drběna čte. Stránka se sama obnoví, až bude hotovo.",
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
    return redirect(`${BASE}?ok=${result.background ? "import-bezi" : "import-hotovo"}`);
  }
  if (path === `${BASE}/zpracovat`) {
    const result = await runOne(env, request, fields.id, { ctx });
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?zprava=${fields.id}` : BASE, result.error));
    return redirect(`${BASE}?zprava=${fields.id}&ok=${result.background ? "import-bezi" : "import-zprava"}`);
  }
  return null;
}
