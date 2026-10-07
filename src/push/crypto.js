// Web Push bez knihovny: podpis VAPID (RFC 8292) a šifrování obsahu aes128gcm (RFC 8291) přes WebCrypto.
// Klíče jsou tajemství VAPID_PUBLIC_KEY (65 bajtů nekomprimovaného bodu P-256) a VAPID_PRIVATE_KEY (32 bajtů),
// obojí base64url; vyrobí je `node scripts/vapid-keys.mjs`.
const encoder = new TextEncoder();
const RECORD_SIZE = 4096;

export function b64url(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value) {
  const text = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(text + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function hmac(key, data) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

// Je VAPID nastavené? Bez klíčů se nic neposílá a stránka /upozorneni řekne, že to zatím nejde.
export function vapidReady(env) {
  return Boolean(env?.VAPID_PUBLIC_KEY && env?.VAPID_PRIVATE_KEY);
}

let cachedKey = null;

async function signingKey(env) {
  if (cachedKey?.public === env.VAPID_PUBLIC_KEY) return cachedKey.key;
  const point = fromB64url(env.VAPID_PUBLIC_KEY);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(point.slice(1, 33)), y: b64url(point.slice(33, 65)), d: env.VAPID_PRIVATE_KEY, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  cachedKey = { public: env.VAPID_PUBLIC_KEY, key };
  return key;
}

// Hlavička Authorization pro službu prohlížeče (FCM, Mozilla, Apple…). Platí 12 hodin.
export async function vapidAuthorization(env, endpoint, { subject = "mailto:redakce@kopidlenskadrbna.org", now = Date.now() } = {}) {
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const unsigned = `${header}.${claims}`;
  // WebCrypto vrací podpis jako r||s, přesně jak ho chce JWS.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env), encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Zašifruje obsah pro jeden odběr (klíče p256dh a auth z prohlížeče). `local` a `salt` jen pro testy.
export async function encryptPayload(payload, p256dh, auth, { local = null, salt = null } = {}) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const keys = local ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, keys.privateKey, 256));
  const prkKey = await hmac(authSecret, shared);
  const ikm = await hmac(prkKey, concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic, Uint8Array.of(1)));
  const nonceSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(nonceSalt, ikm);
  const cek = (await hmac(prk, concat(encoder.encode("Content-Encoding: aes128gcm\0"), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(encoder.encode("Content-Encoding: nonce\0"), Uint8Array.of(1)))).slice(0, 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Jediný záznam: obsah a oddělovač posledního záznamu (2), bez výplně.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, Uint8Array.of(2))));
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, RECORD_SIZE);
  return concat(nonceSalt, size, Uint8Array.of(asPublic.length), asPublic, cipher);
}
