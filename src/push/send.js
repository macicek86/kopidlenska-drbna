// Odeslání jednoho upozornění službě prohlížeče. Vrací stav HTTP (0 = nepodařilo se spojit).
import { encryptPayload, vapidAuthorization } from "./crypto.js";

// Jak dlouho služba upozornění drží, když je telefon vypnutý (12 h, pak už je stejně staré).
const TTL_SECONDS = 12 * 3600;

export async function sendPush(env, sub, payload) {
  try {
    const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
    const response = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: await vapidAuthorization(env, sub.endpoint),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_SECONDS),
        urgency: "normal",
      },
      body,
    });
    return response.status;
  } catch {
    return 0;
  }
}

// Co se stavem udělat: odešlo, odběr zanikl (prohlížeč upozornění vypnul), nejde poslat vůbec, nebo zkusit znovu.
export function sendOutcome(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 400 || status === 403 || status === 413) return "drop";
  return "retry";
}
