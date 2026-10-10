// Formuláře stránky E-mail na otevírací dobu: adresy, které smějí psát (jen hlavní redaktor).
import { redirect, withError } from "./http.js";
import { refuseRequest } from "./mailin/register.js";
import { replayRequest } from "./mailin/run.js";
import { removeSender, saveSender } from "./mailin/store.js";

const BASE = "/redakce/emaily";

export const MAILIN_OK = {
  "email-adresa": "Adresa je uložená.",
  "email-adresa-smazana": "Adresa je smazaná, e-maily z ní už se nezapíšou.",
  "email-adresa-povolena": "Adresa je povolená a její e-mail jsem zpracovala.",
  "email-zadost-zamitnuta": "Adresa není povolená, odesílatel to ví.",
};

export async function mailinPost(path, request, env, fields) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveSender(env, request, { id: fields.id, email: fields.email, label: fields.label, direct: fields.direct, targets: fields.mailTargets });
    const back = fields.requestId ? `${BASE}?povolit=${fields.requestId}` : fields.id ? `${BASE}?id=${fields.id}` : `${BASE}?novy=1`;
    if (!result.ok) return redirect(withError(back, result.error));
    // Adresa z žádosti: uložený e-mail se zpracuje, jako by přišel teď.
    if (fields.requestId && (await replayRequest(env, Number(fields.requestId)))) return redirect(`${BASE}?ok=email-adresa-povolena`);
    return redirect(`${BASE}?ok=email-adresa`);
  }
  if (path === `${BASE}/zamitnout`) {
    const result = await refuseRequest(env, request, Number(fields.id));
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=email-zadost-zamitnuta`);
  }
  if (path === `${BASE}/smazat`) {
    const result = await removeSender(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=email-adresa-smazana`);
  }
  return null;
}
