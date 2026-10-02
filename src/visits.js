// Počítadlo návštěv veřejné části: co se počítá, odkud člověk přišel a otisk návštěvníka.
// Žádné cookies ani IP adresy se neukládají. Otisk je SHA-256 z denní soli, IP a prohlížeče;
// sůl se každý den losuje znovu a starou smažeme, takže otisk nejde spojit s člověkem ani mezi dny.

const BOT =
  /bot|crawl|spider|slurp|scrape|facebookexternalhit|embedly|preview|headless|lighthouse|pagespeed|python|curl|wget|httpclient|java\/|go-http|node-fetch|undici|axios|okhttp|monitor|uptime|pingdom|feed|validator/i;

// Přihlášený z redakce (heslem i přes Cloudflare Access) se nepočítá.
const EDITOR_COOKIE = /(?:^|;\s*)(?:drbna_editor|CF_Authorization)=/;

export function isBot(userAgent) {
  const ua = String(userAgent ?? "");
  return ua.length < 10 || BOT.test(ua);
}

// Adresa, pod kterou se návštěva započítá, nebo null, když se nepočítá vůbec.
export function visitPath(request, response) {
  if (response.status !== 200) return null;
  if (!String(response.headers.get("content-type") ?? "").startsWith("text/html")) return null;
  return visitTarget(request);
}

// Totéž jen podle požadavku (u zprávy to víme dřív, než je stránka hotová).
export function visitTarget(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/redakce" || path.startsWith("/redakce/")) return null;
  const headers = request.headers;
  if (/prefetch|prerender/i.test(`${headers.get("purpose") ?? ""} ${headers.get("sec-purpose") ?? ""}`)) return null;
  if (isBot(headers.get("user-agent"))) return null;
  if (EDITOR_COOKIE.test(headers.get("cookie") ?? "")) return null;
  if (url.hostname.startsWith("popelnice.") && path === "/") return "/popelnice";
  return path.slice(0, 200);
}

const SOURCES = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)google\.[a-z.]+$/, "Google"],
  [/(^|\.)seznam\.cz$/, "Seznam"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)(x\.com|t\.co|twitter\.com)$/, "X"],
  [/(^|\.)whatsapp\.(com|net)$/, "WhatsApp"],
];

export const DIRECT = "Přímo";

// Odkud člověk přišel: jen název webu, nikdy celá adresa. Z vlastního webu (i popelnice.) je to „Přímo“.
export function visitSource(referer, ownHost) {
  let host;
  try {
    host = new URL(String(referer ?? "")).hostname.toLowerCase();
  } catch {
    return DIRECT;
  }
  const own = String(ownHost ?? "").toLowerCase().replace(/^(www|popelnice)\./, "");
  const bare = host.replace(/^(www|m|l|lm|mobile)\./, "");
  if (!bare || bare === own || bare.endsWith(`.${own}`)) return DIRECT;
  for (const [pattern, label] of SOURCES) if (pattern.test(bare)) return label;
  return bare.slice(0, 80);
}

export async function visitorHash(salt, ip, userAgent) {
  const data = new TextEncoder().encode(`${salt}|${ip ?? ""}|${userAgent ?? ""}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Veřejné „Přečteno 214×“ u zprávy.
export function readCount(views) {
  const count = Number(views) || 0;
  return count > 0 ? `Přečteno ${count.toLocaleString("cs-CZ")}×` : "";
}
