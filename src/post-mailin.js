// Formuláře stránky E-mail na otevírací dobu: adresy, které smějí psát (jen hlavní redaktor).
import { redirect, withError } from "./http.js";
import { removeSender, saveSender } from "./mailin/store.js";

const BASE = "/redakce/emaily";

export const MAILIN_OK = {
  "email-adresa": "Adresa je uložená.",
  "email-adresa-smazana": "Adresa je smazaná, e-maily z ní už se nezapíšou.",
};

export async function mailinPost(path, request, env, fields) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveSender(env, request, { id: fields.id, email: fields.email, label: fields.label, direct: fields.direct, targets: fields.mailTargets });
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?id=${fields.id}` : `${BASE}?novy=1`, result.error));
    return redirect(`${BASE}?ok=email-adresa`);
  }
  if (path === `${BASE}/smazat`) {
    const result = await removeSender(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=email-adresa-smazana`);
  }
  return null;
}
