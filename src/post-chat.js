// Formuláře sekce Chat s Drběnou: nastavení a smazání uložených otázek.
import { clearChatQuestions, saveChatSettings } from "./chat/store.js";
import { redirect, withError } from "./http.js";

const BASE = "/redakce/chat";

export const CHAT_OK = {
  "chat-zapnuty": "Uloženo. Chat s Drběnou je na webu.",
  "chat-vypnuty": "Uloženo. Chat s Drběnou je vypnutý.",
  "chat-otazky-smazane": "Uložené otázky jsou smazané.",
};

export async function chatAdminPost(path, request, env, fields) {
  if (path === `${BASE}/ulozit`) {
    const result = await saveChatSettings(env, request, fields);
    if (!result.ok) return redirect(withError(`${BASE}?nastaveni`, result.error));
    return redirect(`${BASE}?ok=${result.enabled ? "chat-zapnuty" : "chat-vypnuty"}`);
  }
  if (path === `${BASE}/smazat-otazky`) {
    if (!fields.confirm) return redirect(BASE);
    const result = await clearChatQuestions(env, request);
    if (!result.ok) return redirect(withError(BASE, result.error));
    return redirect(`${BASE}?ok=chat-otazky-smazane#otazky`);
  }
  return null;
}
