// Formuláře sekce Vzkazy: vyřízení (i vrácení mezi nové) a smazání vzkazu z chatu.
import { markMessage, removeMessage } from "./messages-db.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/vzkazy";

export const MESSAGES_OK = {
  "vzkaz-vyrizeny": "Vzkaz je vyřízený.",
  "vzkaz-novy": "Vzkaz je zpátky mezi novými.",
  "vzkaz-smazany": "Vzkaz je smazaný.",
};

export async function messagesPost(path, request, env, fields) {
  if (path === `${BASE}/vyrizeno` || path === `${BASE}/vratit`) {
    if (!fields.id) return redirect(BASE);
    const done = path === `${BASE}/vyrizeno`;
    const result = await markMessage(env, request, fields.id, done);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=${done ? "vzkaz-vyrizeny" : "vzkaz-novy"}`);
  }
  if (path === `${BASE}/smazat`) {
    if (!fields.confirm || !fields.id) return redirect(BASE);
    const result = await removeMessage(env, request, fields.id);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=vzkaz-smazany`);
  }
  return null;
}
