// Formuláře sekce Akce: uložení a smazání akce. Nová akce může rovnou vést k nové zprávě o ní.
import { removeEvent, saveEvent } from "./events-db.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/akce";

export const EVENTS_OK = {
  akce: "Akce je uložená.",
  "akce-upravena": "Akce je upravená.",
  "akce-smazana": "Akce je smazaná.",
  "zprava-k-akci": "Zpráva je uložená a připojená k akci.",
};

export async function eventsPost(path, request, env, fields) {
  if (!path.startsWith(`${BASE}/`)) return null;
  if (path === `${BASE}/ulozit`) {
    const result = await saveEvent(env, request, fields);
    if (!result.ok) return redirect(withError(fields.id ? `${BASE}?id=${fields.id}` : BASE, result.error));
    if (fields.writeArticle && !fields.eventArticleId) return redirect(`/redakce/zpravy?novy=1&akce=${result.id}`);
    return redirect(`${BASE}?ok=${fields.id ? "akce-upravena" : "akce"}`);
  }
  if (path === `${BASE}/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeEvent(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=akce-smazana`);
  }
  return null;
}
