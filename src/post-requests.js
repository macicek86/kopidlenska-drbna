// Formuláře žádostí ke schválení (sběrné dvory, lékaři, otevírací doba): schválit, zamítnout, stáhnout.
import { approveRequest, rejectRequest, withdrawRequest } from "./hours-requests-db.js";
import { redirect, withError } from "./http.js";

export const REQUESTS_OK = {
  zadost: "Návrh je odeslaný. Na web půjde, až ho schválí hlavní redaktor.",
  "zadost-schvalena": "Návrh je schválený a zapsaný.",
  "zadost-zamitnuta": "Návrh je zamítnutý.",
  "zadost-stazena": "Návrh je pryč.",
};

// Výsledek běžného formuláře: rovnou zapsané, nebo odeslané ke schválení.
export function submitted(base, result, okKey) {
  if (!result.ok) return redirect(withError(base, result.error));
  return redirect(`${base}?ok=${result.requested ? "zadost" : okKey}`);
}

export async function requestPost(path, request, env, fields, { base, section, actions }) {
  if (!path.startsWith(`${base}/zadost/`)) return null;
  const id = fields.requestId;
  if (path === `${base}/zadost/schvalit`) {
    const result = await approveRequest(env, request, { section, actions, id, input: fields });
    if (!result.ok) return redirect(withError(`${base}?zadost=${id}`, result.error));
    return redirect(`${base}?ok=zadost-schvalena`);
  }
  if (path === `${base}/zadost/zamitnout`) {
    const result = await rejectRequest(env, request, { section, id, reply: fields.reply });
    if (!result.ok) return redirect(withError(base, result.error));
    return redirect(`${base}?ok=zadost-zamitnuta`);
  }
  if (path === `${base}/zadost/stahnout`) {
    const result = await withdrawRequest(env, request, { section, id });
    if (!result.ok) return redirect(withError(base, result.error));
    return redirect(`${base}?ok=zadost-stazena`);
  }
  return null;
}
