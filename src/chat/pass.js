// Chat s Drběnou: Turnstile (ověření, že píše člověk) a podepsaný lístek na rozhovor.
// Turnstile se ověří jednou na začátku rozhovoru; lístek pak platí dvě hodiny a nese číslo rozhovoru.
// Zapíná se tajemstvími TURNSTILE_SITE_KEY a TURNSTILE_SECRET. Bez nich (místně, náhled) chat Turnstile nechce.

const PASS_HOURS = 2;
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileConfig(env) {
  const siteKey = String(env.TURNSTILE_SITE_KEY ?? "").trim();
  const secret = String(env.TURNSTILE_SECRET ?? "").trim();
  return siteKey && secret ? { siteKey, secret } : null;
}

export async function verifyTurnstile(config, token, ip, fetcher = fetch) {
  if (!token || String(token).length > 2048) return false;
  const body = new FormData();
  body.set("secret", config.secret);
  body.set("response", String(token));
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetcher(VERIFY_URL, { method: "POST", body });
    const result = await response.json();
    return result?.success === true;
  } catch {
    return false;
  }
}

const encoder = new TextEncoder();

function base64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(secret, data) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

export async function issuePass(secret, now = Date.now()) {
  const conversation = base64url(crypto.getRandomValues(new Uint8Array(12)));
  const data = `${conversation}.${now + PASS_HOURS * 3_600_000}`;
  return `${data}.${await sign(secret, data)}`;
}

// Vrací číslo rozhovoru, nebo null (cizí, upravený nebo prošlý lístek).
export async function readPass(secret, pass, now = Date.now()) {
  const parts = String(pass ?? "").split(".");
  if (parts.length !== 3 || !secret) return null;
  const [conversation, expires, signature] = parts;
  if (!/^[\w-]{16}$/.test(conversation) || !(Number(expires) > now)) return null;
  const expected = await sign(secret, `${conversation}.${expires}`);
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0 ? conversation : null;
}
