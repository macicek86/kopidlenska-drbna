// Formuláře sekce Reklamy: nabídky hlavního redaktora a návrhy přispěvatelů.
import {
  approveAdProposal,
  rejectAdProposal,
  removeAd,
  saveAd,
  saveAdProposal,
  setAdEnabled,
  withdrawAdProposal,
} from "./ads-db.js";
import { redirect, withError } from "./http.js";

export const ADS_OK = {
  reklama: "Nabídka je uložená.",
  "reklama-upravena": "Nabídka je upravená.",
  "reklama-vypnuta": "Nabídka je vypnutá.",
  "reklama-zapnuta": "Nabídka je zase zapnutá.",
  "reklama-smazana": "Nabídka je smazaná.",
  "reklama-navrh": "Návrh nabídky čeká na schválení.",
  "reklama-navrh-upraven": "Návrh nabídky je upravený a pořád čeká na schválení.",
  "reklama-stazena": "Návrh nabídky je stažený.",
  "reklama-schvalena": "Nabídka je schválená a na webu.",
  "reklama-vracena": "Návrh nabídky je vrácený autorovi.",
};

function adDeskQuery(fields) {
  if (fields.id) return `/redakce/reklamy?navrh=${fields.id}`;
  if (fields.adId) return `/redakce/reklamy?id=${fields.adId}`;
  return "/redakce/reklamy";
}

export async function adsPost(path, request, env, fields) {
  if (!path.startsWith("/redakce/reklamy/")) return null;
  if (path === "/redakce/reklamy/ulozit") {
    const result = await saveAd(env, request, fields);
    if (!result.ok) {
      const back = fields.id ? `/redakce/reklamy?id=${fields.id}` : "/redakce/reklamy";
      return redirect(withError(back, result.error));
    }
    return redirect(`/redakce/reklamy?ok=${fields.id ? "reklama-upravena" : "reklama"}`);
  }
  if (path === "/redakce/reklamy/navrh") {
    const result = await saveAdProposal(env, request, fields);
    if (!result.ok) return redirect(withError(adDeskQuery(fields), result.error));
    return redirect(`/redakce/reklamy?ok=${result.updated ? "reklama-navrh-upraven" : "reklama-navrh"}`);
  }
  if (path === "/redakce/reklamy/stahnout") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/reklamy");
    const result = await withdrawAdProposal(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/reklamy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/reklamy?ok=reklama-stazena");
  }
  if (path === "/redakce/reklamy/schvalit") {
    const result = await approveAdProposal(env, request, fields);
    if (!result.ok) return redirect(`/redakce/reklamy?navrh=${fields.id ?? ""}&chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/reklamy?ok=reklama-schvalena");
  }
  if (path === "/redakce/reklamy/vratit") {
    const result = await rejectAdProposal(env, request, fields);
    if (!result.ok) return redirect(`/redakce/reklamy?navrh=${fields.id ?? ""}&chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/reklamy?ok=reklama-vracena");
  }
  if (path === "/redakce/reklamy/stav") {
    const result = await setAdEnabled(env, request, fields);
    if (!result.ok) return redirect(`/redakce/reklamy?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/reklamy?ok=${result.enabled ? "reklama-zapnuta" : "reklama-vypnuta"}`);
  }
  if (path === "/redakce/reklamy/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/reklamy");
    const result = await removeAd(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/reklamy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/reklamy?ok=reklama-smazana");
  }
  return null;
}
