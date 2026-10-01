// Formuláře sekce Odstávky: hlídané obce pro elektřinu a oznámení o vodě a uzavírkách.
import { addOutageArea, refreshOutages, removeOutageArea, saveOutageAreas } from "./outages-db.js";
import { removeNotice, saveNotice } from "./notices-db.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/odstavky";

export const OUTAGE_OK = {
  oblast: "Obec je přidaná a přehled je načtený.",
  "oblast-upravena": "Oblasti jsou uložené a přehled je načtený.",
  "oblast-smazana": "Obec je ze seznamu pryč.",
  odstavky: "Přehled odstávek je načtený.",
  "odstavky-castecne": "Přehled je načtený, ale u některé obce to nevyšlo.",
  oznameni: "Oznámení je uložené.",
  "oznameni-upraveno": "Oznámení je upravené.",
  "oznameni-smazano": "Oznámení je smazané.",
};

function areaResult(result, okKey) {
  if (!result.ok) return redirect(withError(BASE, result.error));
  if (result.warn) return redirect(withError(BASE, result.warn));
  return redirect(`${BASE}?ok=${result.partial ? "odstavky-castecne" : okKey}`);
}

export async function outagePost(path, request, env, fields) {
  if (path === `${BASE}/pridat`) return areaResult(await addOutageArea(env, request, fields), "oblast");
  if (path === `${BASE}/ulozit`) return areaResult(await saveOutageAreas(env, request, fields), "oblast-upravena");
  if (path === `${BASE}/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeOutageArea(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=oblast-smazana`);
  }
  if (path === `${BASE}/nacist`) {
    const result = await refreshOutages(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.partial ? "odstavky-castecne" : "odstavky"}`);
  }
  if (path === `${BASE}/oznameni`) {
    const result = await saveNotice(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?oznameni=${fields.id}` : `${BASE}?nove-oznameni=1`, result.error));
    return redirect(`${BASE}?ok=${result.updated ? "oznameni-upraveno" : "oznameni"}`);
  }
  if (path === `${BASE}/oznameni/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeNotice(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=oznameni-smazano`);
  }
  return null;
}
