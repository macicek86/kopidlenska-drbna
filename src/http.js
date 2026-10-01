// Odpovědi workeru: HTML s bezpečnostními hlavičkami, JSON a přesměrování po POST.

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
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
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

export function withError(path, error) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}chyba=${encodeURIComponent(error)}`;
}
