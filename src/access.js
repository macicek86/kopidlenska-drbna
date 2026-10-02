// Cloudflare Access před redakcí. Access pustí dál jen ověřené lidi a ke každému požadavku přidá
// podepsaný token (JWT) s jejich e-mailem. Tady ho ověříme: podpis proti klíčům týmu, adresát (AUD),
// vydavatel a platnost. Bez nastaveného ACCESS_TEAM a ACCESS_AUD (místní vývoj, náhled) je Access vypnutý
// a redakce se přihlašuje heslem.

export const ACCESS_LOGOUT = "/cdn-cgi/access/logout";
const KEYS_TTL = 60 * 60 * 1000;
const keyCache = new Map();

export function accessConfig(env) {
  const team = String(env?.ACCESS_TEAM ?? "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const aud = String(env?.ACCESS_AUD ?? "").trim();
  if (!team || !aud) return null;
  const host = team.includes(".") ? team : `${team}.cloudflareaccess.com`;
  return { issuer: `https://${host}`, aud };
}

function readToken(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization") return rest.join("=");
  }
  return "";
}

function base64url(text) {
  const plain = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = plain + "=".repeat((4 - (plain.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
}

function jsonPart(text) {
  return JSON.parse(new TextDecoder().decode(base64url(text)));
}

async function fetchKeys(issuer) {
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Klíče Cloudflare Access nejdou načíst (${response.status}).`);
  const body = await response.json();
  return Array.isArray(body?.keys) ? body.keys : [];
}

// Klíče si pamatujeme hodinu. Když token nese neznámý kid (Access klíče vyměnil), načteme je znovu,
// ale nejvýš jednou za minutu, ať je nejde zahltit tokeny s vymyšleným kid.
async function keyFor(config, kid, load, now) {
  let cached = keyCache.get(config.issuer);
  const find = () => cached?.keys.find((key) => key.kid === kid);
  const stale = !cached || cached.until < now || (!find() && cached.at < now - 60 * 1000);
  if (stale) {
    cached = { keys: await load(config.issuer), at: now, until: now + KEYS_TTL };
    keyCache.set(config.issuer, cached);
  }
  return find() ?? null;
}

// Vrátí ověřený e-mail (malými písmeny), nebo null.
export async function verifyAccessToken(token, config, { load = fetchKeys, now = Date.now() } = {}) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  let header;
  let claims;
  try {
    header = jsonPart(parts[0]);
    claims = jsonPart(parts[1]);
  } catch {
    return null;
  }
  if (header?.alg !== "RS256" || !header.kid) return null;
  const jwk = await keyFor(config, header.kid, load, now);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64url(parts[2]), signed);
  } catch {
    return null;
  }
  if (!valid) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.aud)) return null;
  if (claims.iss !== config.issuer) return null;
  const seconds = Math.floor(now / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= seconds) return null;
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 60) return null;
  const email = String(claims.email ?? "").trim().toLowerCase();
  return email || null;
}

export async function accessEmail(request, config, options) {
  const token = readToken(request);
  if (!token) return null;
  return verifyAccessToken(token, config, options);
}
