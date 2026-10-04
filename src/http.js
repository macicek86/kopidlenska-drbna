// Odpovědi workeru: HTML s bezpečnostními hlavičkami, JSON a přesměrování po POST.
// CSP pouští cizí skript a rámeček jen z challenges.cloudflare.com (Turnstile u chatu s Drběnou).

export function secure(request) {
  return new URL(request.url).protocol === "https:";
}

export function html(body, status = 200, cookie) {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy":
      "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(body, { status, headers });
}

export function redirect(location, cookie) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

// robots.txt a sitemap.xml: veřejné, hodinu v mezipaměti.
export function plain(body, contentType) {
  return new Response(body, {
    headers: {
      "content-type": `${contentType}; charset=utf-8`,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

export function withError(path, error) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}chyba=${encodeURIComponent(error)}`;
}

// Jedna adresa webu: kopidlenskadrbna.org a dočasně i stará *.workers.dev vedou na www.kopidlenskadrbna.org
// i s cestou a dotazem, popelnice.kopidlenskadrbna.org (starý web popelnic) na stránku svozu. Jinak null.
// GET trvale (301), ostatní 308, ať POST nepřijde o tělo.
export const SITE_ORIGIN = "https://www.kopidlenskadrbna.org";
const SITE_HOST = "kopidlenskadrbna.org";

export function hostRedirect(request) {
  const url = new URL(request.url);
  let target = null;
  if (url.hostname === SITE_HOST || url.hostname.endsWith(".workers.dev")) {
    target = `${SITE_ORIGIN}${url.pathname}${url.search}`;
  } else if (url.hostname === `popelnice.${SITE_HOST}`) {
    target = `${SITE_ORIGIN}/popelnice`;
  }
  if (!target) return null;
  const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
  return new Response(null, { status, headers: { location: target } });
}
