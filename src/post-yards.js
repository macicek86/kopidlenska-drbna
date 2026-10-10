// Formuláře sekce Sběrné dvory: dvory, mimořádná uzavření a návrhy ke schválení.
import { loadYards, removeClosure, removeYard, saveClosure, saveYard, saveYardDetails, saveYardHours, YARD_ACTIONS } from "./yards-db.js";
import { redirect, withError } from "./http.js";
import { requestPost, submitted } from "./post-requests.js";
import { submitPeriods } from "./post-periods.js";

const BASE = "/redakce/dvory";

export const YARDS_OK = {
  dvur: "Sběrný dvůr je uložený.",
  "dvur-upraven": "Sběrný dvůr je upravený.",
  "dvur-smazan": "Sběrný dvůr je smazaný.",
  uzavreni: "Mimořádné uzavření je zapsané.",
  "dvur-zmena": "Změna otevírací doby je zapsaná.",
  "dvur-zmeny": "Změny otevírací doby jsou zapsané.",
  "dvur-hodiny": "Otevírací doba dvora je uložená.",
  "dvur-udaje": "Údaje dvora jsou uložené.",
  "uzavreni-smazane": "Mimořádné uzavření je zrušené.",
};

export async function yardsPost(path, request, env, fields) {
  if (!path.startsWith(BASE)) return null;
  if (path === `${BASE}/ulozit`) {
    const result = await saveYard(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?id=${fields.id}` : BASE, result.error));
    return redirect(`${BASE}?ok=${result.updated ? "dvur-upraven" : "dvur"}`);
  }
  if (path === `${BASE}/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeYard(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=dvur-smazan`);
  }
  if (path === `${BASE}/hodiny`) return submitted(BASE, await saveYardHours(env, request, fields), "dvur-hodiny");
  if (path === `${BASE}/udaje`) return submitted(BASE, await saveYardDetails(env, request, fields), "dvur-udaje");
  if (path === `${BASE}/zmena`) {
    const yard = (await loadYards(env)).find((row) => row.id === fields.yardId);
    return submitPeriods({
      base: BASE,
      back: `${BASE}?uzavreni=${fields.yardId ?? ""}`,
      section: "dvory",
      actions: YARD_ACTIONS,
      idField: "yardId",
      targetId: fields.yardId,
      periods: fields.periods,
      regular: yard?.legacy ? null : yard?.week ?? null,
      shape: "week1",
      save: (input) => saveClosure(env, request, input),
      okKey: "dvur-zmena",
      manyKey: "dvur-zmeny",
    });
  }
  if (path === `${BASE}/uzavreni/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    return submitted(BASE, await removeClosure(env, request, fields.id), "uzavreni-smazane");
  }
  return requestPost(path, request, env, fields, { base: BASE, section: "dvory", actions: YARD_ACTIONS });
}
