const text = new TextEncoder();

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", text.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  return `pbkdf2:${hex(salt)}:${hex(await derive(password, salt))}`;
}

export async function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored ?? "").split(":");
  if (kind !== "pbkdf2" || !saltHex || !hashHex || saltHex.length % 2 !== 0) return false;
  const next = hex(await derive(password, fromHex(saltHex)));
  if (next.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < next.length; i += 1) diff |= next.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}
