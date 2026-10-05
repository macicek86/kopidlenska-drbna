// Formuláře stránek škol (ZŠ a MŠ, zahradnická) a webu města: nastavení importu, ruční načtení a zpracování vybraných článků.
import { redirect, withError } from "./http.js";
import { checkSkolaNow, selectSkola } from "./skola/run.js";
import { SCHOOL_LIST } from "./skola/sources.js";
import { saveSkolaSettings } from "./skola/store.js";

export const SKOLA_OK = {
  "skola-nastaveni": "Nastavení je uložené.",
  "skola-nacteno": "Články jsou načtené. Zaškrtněte, které má Drběna zpracovat.",
  "skola-nic": "Na webu teď není nic nového.",
  "skola-bezi": "Drběna čte vybrané. Stránka se sama obnoví, až bude hotovo.",
};

export async function skolaPost(path, request, env, fields, ctx) {
  const source = SCHOOL_LIST.find((school) => path.startsWith(`/redakce/${school.tag}/`));
  if (!source) return null;
  const base = `/redakce/${source.tag}`;
  if (path === `${base}/ulozit`) {
    const result = await saveSkolaSettings(env, request, source, fields);
    if (!result.ok) return redirect(withError(`${base}?nastaveni=1`, result.error));
    return redirect(`${base}?ok=skola-nastaveni`);
  }
  if (path === `${base}/zkontrolovat`) {
    const result = await checkSkolaNow(env, request, source);
    if (!result.ok) return redirect(withError(base, result.error));
    return redirect(`${base}?ok=${result.added ? "skola-nacteno" : "skola-nic"}`);
  }
  if (path === `${base}/vybrat`) {
    const result = await selectSkola(env, request, source, fields.ids, { ctx });
    if (!result.ok) return redirect(withError(base, result.error));
    return redirect(`${base}?ok=skola-bezi`);
  }
  if (path === `${base}/zpracovat`) {
    const back = fields.id ? `${base}?zprava=${fields.id}` : base;
    const result = await selectSkola(env, request, source, [fields.id], { ctx });
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=skola-bezi`);
  }
  return null;
}
