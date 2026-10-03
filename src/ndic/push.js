// Příjem zpráv od NDIC protokolem PUSH: NDIC posílá změny uzavírek metodou POST, chráněné jménem a heslem.
// Na každou přijatou zprávu musí přijít 200, jinak to NDIC zkouší znovu a po zhruba 24 hodinách odběr zastaví.
// Proto i zprávu, která se nedá přečíst, potvrdíme a chybu ukážeme v redakci.
import { isDatexMessage, parseSituations } from "./datex.js";
import { continueNdic } from "./run.js";
import { noteReceived, saveSituations } from "./store.js";

export const NDIC_PUSH_PATH = "/ndic/uzavirky";
const MAX_BYTES = 40 * 1024 * 1024;

function reply(text, status = 200, headers = {}) {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
}

function sameText(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export function pushConfig(env) {
  const user = String(env.NDIC_PUSH_USER ?? "");
  const password = String(env.NDIC_PUSH_PASSWORD ?? "");
  return user && password ? { user, password } : null;
}

export function authorized(request, config) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Basic\s+(.+)$/i);
  if (!match) return false;
  let decoded = "";
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(match[1].trim()), (ch) => ch.charCodeAt(0)));
  } catch {
    return false;
  }
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  // Obě porovnání vždy, ať délka odpovědi neprozradí, které z nich nesedí.
  const userOk = sameText(decoded.slice(0, split), config.user);
  const passwordOk = sameText(decoded.slice(split + 1), config.password);
  return userOk && passwordOk;
}

// Tělo zprávy jako text. Gzip poznáme podle prvních bajtů, ne podle hlavičky (nemusí sedět).
export async function bodyText(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

export async function ndicPush(request, env, ctx = null) {
  const config = pushConfig(env);
  if (!config) return reply("Příjem uzavírek není nastavený.", 503);
  if (!authorized(request, config)) return reply("Přihlaste se.", 401, { "www-authenticate": 'Basic realm="ndic"' });
  if (request.method !== "POST") return reply("Sem se posílá POST.", 405);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    await noteReceived(env, { error: "Zpráva od NDIC byla moc velká. Omezte v odběru oblast." });
    return reply("OK");
  }
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const xml = await bodyText(bytes);
    if (!isDatexMessage(xml)) {
      await noteReceived(env, { error: "Přišla zpráva, která není DATEX II." });
      return reply("OK");
    }
    const result = await saveSituations(env, parseSituations(xml));
    await noteReceived(env, result);
    // Nové uzavírky v okruhu Drběna přepíše hned na pozadí (když je zapnutá), zbytek dopíše cron.
    if (ctx) await continueNdic(env, { ctx }).catch(() => {});
    return reply("OK");
  } catch (error) {
    const message = error instanceof Error ? error.message : "neznámá chyba";
    await noteReceived(env, { error: `Zprávu se nepodařilo zpracovat: ${message}` }).catch(() => {});
    // Chyba databáze bývá chvilková: ať to NDIC zkusí znovu.
    return reply("Chyba, zkuste to znovu.", 500);
  }
}
