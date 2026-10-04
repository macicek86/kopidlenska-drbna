// Formuláře sekce Sběrné dvory: dvory, mimořádná uzavření a návrhy ke schválení.
import { removeClosure, removeYard, saveClosure, saveYard, YARD_ACTIONS } from "./yards-db.js";
import { redirect, withError } from "./http.js";
import { requestPost, submitted } from "./post-requests.js";

const BASE = "/redakce/dvory";

export const YARDS_OK = {
  dvur: "Sběrný dvůr je uložený.",
  "dvur-upraven": "Sběrný dvůr je upravený.",
  "dvur-smazan": "Sběrný dvůr je smazaný.",
  uzavreni: "Mimořádné uzavření je zapsané.",
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
  if (path === `${BASE}/uzavreni`) return submitted(BASE, await saveClosure(env, request, fields), "uzavreni");
  if (path === `${BASE}/uzavreni/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    return submitted(BASE, await removeClosure(env, request, fields.id), "uzavreni-smazane");
  }
  return requestPost(path, request, env, fields, { base: BASE, section: "dvory", actions: YARD_ACTIONS });
}
