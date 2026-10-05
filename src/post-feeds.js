// Formulář sekce Odběr a data: vypínače feedů.
import { saveFeedSettings } from "./feeds/settings.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/odber";

export const FEEDS_OK = { odber: "Nastavení odběru je uložené." };

export async function feedsPost(path, request, env, fields) {
  if (path !== `${BASE}/ulozit`) return null;
  const result = await saveFeedSettings(env, request, fields);
  if (!result.ok) return redirect(withError(BASE, result.error));
  return redirect(`${BASE}?ok=odber`);
}
