// Formuláře sekce Knihovna obrázků: témata, nahrání a úprava fotek, náhradní téma.
import { redirect, withError } from "./http.js";
import { removeStockImage, removeStockTopic, saveStockImage, saveStockSettings, saveStockTopic, uploadStockImages } from "./stock-db.js";

const BASE = "/redakce/obrazky";

export const STOCK_OK = {
  "obrazky-nahrane": "Fotky jsou v knihovně.",
  "obrazek-upraven": "Fotka je upravená.",
  "obrazek-smazan": "Fotka je smazaná z knihovny.",
  tema: "Téma je založené.",
  "tema-upraveno": "Téma je upravené.",
  "tema-smazano": "Téma je smazané.",
  "obrazky-nahradni": "Uloženo. Když v tématu nic není, Drběna vezme fotku z náhradního tématu.",
  "obrazky-bez-nahradniho": "Uloženo. Když v tématu nic není, zpráva bude bez obrázku.",
};

export async function stockPost(path, request, env, fields) {
  if (!path.startsWith(BASE)) return null;
  if (path === `${BASE}/nahrat`) {
    const result = await uploadStockImages(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nahrat=${fields.topicId ?? ""}`, result.error));
    return redirect(`${BASE}?ok=obrazky-nahrane#tema-${fields.topicId}`);
  }
  if (path === `${BASE}/fotka`) {
    const result = await saveStockImage(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?id=${fields.id}` : BASE, result.error));
    return redirect(`${BASE}?ok=obrazek-upraven#tema-${fields.topicId}`);
  }
  if (path === `${BASE}/fotka/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeStockImage(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=obrazek-smazan`);
  }
  if (path === `${BASE}/tema`) {
    const result = await saveStockTopic(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?tema=${fields.id}` : `${BASE}?nove-tema`, result.error));
    return redirect(`${BASE}?ok=${result.updated ? "tema-upraveno" : "tema"}`);
  }
  if (path === `${BASE}/tema/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeStockTopic(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=tema-smazano`);
  }
  if (path === `${BASE}/nastaveni`) {
    const result = await saveStockSettings(env, request, fields);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${result.fallback ? "obrazky-nahradni" : "obrazky-bez-nahradniho"}`);
  }
  return null;
}
