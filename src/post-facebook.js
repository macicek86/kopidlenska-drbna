import { requireChief } from "./db-core.js";
import { redirect, withError } from "./http.js";
import { addPage, removePage, removePost } from "./facebook/store.js";
import { collectPage, createDraft } from "./facebook/run.js";

const BASE = "/redakce/facebook";
const ACTIONS = new Set(["pridat", "nacist", "navrh", "smazat", "vymazat"]);
export const FACEBOOK_OK = {
  "facebook-pridano": "Page je v seznamu zdrojů.",
  "facebook-nacteno": "Veřejné textové příspěvky jsou načtené.",
  "facebook-smazano": "Page i její načtené podklady jsou odebrané. Redakční návrhy a články zůstávají v sekci Zprávy.",
  "facebook-vymazano": "Načtený podklad je smazaný. Případný návrh nebo článek spravujte v sekci Zprávy.",
};

export async function facebookPost(path, request, env, fields) {
  const action = path.startsWith(`${BASE}/`) ? path.slice(BASE.length + 1) : "";
  if (!ACTIONS.has(action)) return null;
  const gate = await requireChief(env, request);
  if (!gate.ok) return redirect(withError(BASE, gate.error));
  let result;
  let ok;
  if (action === "pridat") { result = await addPage(env, fields.link); ok = "facebook-pridano"; }
  if (action === "nacist") { result = await collectPage(env, fields.id); ok = "facebook-nacteno"; }
  if (action === "navrh") {
    result = await createDraft(env, fields.id);
    if (result.ok) return redirect(`/redakce/zpravy?navrh=${result.proposalId}`);
  }
  if (action === "smazat" || action === "vymazat") {
    if (!fields.confirm) return redirect(withError(BASE, "Nejdřív potvrďte smazání."));
    const removed = action === "smazat" ? await removePage(env, fields.id) : await removePost(env, fields.id);
    result = { ok: removed, error: "Podklad se právě zpracovává nebo už byl smazaný. Zkuste to po dokončení návrhu." };
    ok = action === "smazat" ? "facebook-smazano" : "facebook-vymazano";
  }
  return redirect(result.ok ? `${BASE}?ok=${ok}` : withError(BASE, result.error));
}
