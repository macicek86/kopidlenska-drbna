// Formuláře stránek škol (ZŠ a MŠ, zahradnická) a webu města: nastavení importu, tlačítko Zkontrolovat teď a ruční puštění článku v detailu.
// U vložených příspěvků místo Zkontrolovat teď formulář Vložit příspěvek.
import { continueResponse } from "./admin-continue.js";
import { redirect, withError } from "./http.js";
import { checkSkolaNow, continueSkola, selectSkola } from "./skola/run.js";
import { pasteSkolaItem } from "./skola/paste.js";
import { SCHOOL_LIST } from "./skola/sources.js";
import { saveSkolaSettings } from "./skola/store.js";

export const SKOLA_OK = {
  "skola-nastaveni": "Nastavení je uložené.",
  "skola-nacteno": "Načteno. Drběna nové zpracovává na pozadí, stránka se sama obnoví.",
  "skola-nic": "Na webu teď není nic nového.",
  "skola-bezi": "Drběna se do toho pustila. Stránka se sama obnoví, až bude hotovo.",
  "skola-vlozeno": "Příspěvek je vložený. Drběna ho teď zpracuje, nechte stránku otevřenou.",
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
  // Otevřená stránka dopisuje frontu po jedné dávce a čeká na odpověď (public/admin.js, data-continue).
  if (path === `${base}/pokracovat`) return continueResponse(env, request, ctx, () => continueSkola(env, source));
  if (path === `${base}/vlozit` && source.pasted) {
    const result = await pasteSkolaItem(env, request, source, fields);
    if (!result.ok) return redirect(withError(`${base}?vlozit=1`, result.error));
    return redirect(`${base}?ok=skola-vlozeno`);
  }
  if (path === `${base}/zkontrolovat` && !source.pasted) {
    const result = await checkSkolaNow(env, request, source);
    if (!result.ok) return redirect(withError(base, result.error));
    return redirect(`${base}?ok=${result.added ? "skola-nacteno" : "skola-nic"}`);
  }
  if (path === `${base}/zpracovat`) {
    const back = fields.id ? `${base}?zprava=${fields.id}` : base;
    const result = await selectSkola(env, request, source, [fields.id]);
    if (!result.ok) return redirect(withError(back, result.error));
    return redirect(`${back}${back.includes("?") ? "&" : "?"}ok=skola-bezi`);
  }
  return null;
}
