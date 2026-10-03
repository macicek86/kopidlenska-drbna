// Formuláře sekce Zprávy: zprávy hlavního redaktora a návrhy přispěvatelů (uložení, stažení, schválení, vrácení).
import { removeArticle, saveArticle } from "./db.js";
import { approveProposal, discardProposal, rejectProposal, saveProposal, withdrawProposal } from "./proposals-db.js";
import { redirect, withError } from "./http.js";

export const ARTICLES_OK = {
  zprava: "Zpráva je uložená.",
  "zprava-upravena": "Zpráva je upravená.",
  "zprava-smazana": "Zpráva je smazaná.",
  navrh: "Návrh čeká na schválení.",
  "navrh-upraven": "Návrh je upravený a pořád čeká na schválení.",
  "navrh-stazen": "Návrh je stažený.",
  "navrh-smazan": "Návrh je smazaný.",
  schvaleno: "Příspěvek je schválený a na webu.",
  vraceno: "Návrh je vrácený autorovi.",
};

function deskQuery(fields) {
  if (fields.id) return `/redakce/zpravy?navrh=${fields.id}`;
  if (fields.articleId) return `/redakce/zpravy?clanek=${fields.articleId}`;
  return "/redakce/zpravy";
}

export async function articlesPost(path, request, env, fields) {
  if (!path.startsWith("/redakce/zpravy/")) return null;
  if (path === "/redakce/zpravy/navrh") {
    const result = await saveProposal(env, request, fields);
    if (!result.ok) return redirect(withError(deskQuery(fields), result.error));
    return redirect(`/redakce/zpravy?ok=${result.updated ? "navrh-upraven" : "navrh"}`);
  }
  if (path === "/redakce/zpravy/stahnout") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/zpravy");
    const result = await withdrawProposal(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=navrh-stazen");
  }
  if (path === "/redakce/zpravy/smazat-navrh") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/zpravy");
    const result = await discardProposal(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=navrh-smazan");
  }
  if (path === "/redakce/zpravy/schvalit") {
    const result = await approveProposal(env, request, fields);
    if (!result.ok) return redirect(`/redakce/zpravy?navrh=${fields.id ?? ""}&chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=schvaleno");
  }
  if (path === "/redakce/zpravy/vratit") {
    const result = await rejectProposal(env, request, fields);
    if (!result.ok) return redirect(`/redakce/zpravy?navrh=${fields.id ?? ""}&chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=vraceno");
  }
  if (path === "/redakce/zpravy/ulozit") {
    const result = await saveArticle(env, request, fields);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/zpravy?ok=${fields.id ? "zprava-upravena" : "zprava"}`);
  }
  if (path === "/redakce/zpravy/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/zpravy");
    const result = await removeArticle(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=zprava-smazana");
  }
  return null;
}
