import {
  changePassword,
  clearCookie,
  loadAdmin,
  loadArticle,
  loadPublic,
  login,
  logout,
  media,
  removeArticle,
  removeEvent,
  saveArticle,
  saveEvent,
  saveSite,
  sessionCookie,
} from "./db.js";
import {
  aboutPage,
  adminArticles,
  adminEvents,
  adminPassword,
  adminSite,
  articlePage,
  binsPage,
  brokenPage,
  eventsPage,
  homePage,
  missingPage,
  newsPage,
} from "./view.js";

const ASSET = /\.(?:png|webp|svg|css|ico|jpg|jpeg|gif|woff2)$/i;

const OK = {
  zprava: "Zpráva je uložená.",
  "zprava-upravena": "Zpráva je upravená.",
  "zprava-smazana": "Zpráva je smazaná.",
  akce: "Akce je uložená.",
  "akce-upravena": "Akce je upravená.",
  "akce-smazana": "Akce je smazaná.",
  web: "Svoz a kontakt jsou uložené.",
  heslo: "Heslo je změněné.",
};

function secure(request) {
  return new URL(request.url).protocol === "https:";
}

function html(body, status = 200, cookie) {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(body, { status, headers });
}

function redirect(location, cookie) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function ctxFor(request, path) {
  const url = new URL(request.url);
  const minimal = url.hostname.startsWith("popelnice.");
  const host = minimal ? url.hostname.replace(/^popelnice\./, "") : url.hostname;
  return { path, minimal, mainOrigin: `${url.protocol}//${host}` };
}

function messageFrom(url) {
  const ok = url.searchParams.get("ok");
  const chyba = url.searchParams.get("chyba");
  if (chyba) return chyba;
  if (ok && OK[ok]) return OK[ok];
  return "";
}

function idParam(url) {
  const raw = url.searchParams.get("id");
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function confirmParam(url) {
  const id = Number(url.searchParams.get("smazat"));
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

async function formFields(request) {
  const form = await request.formData();
  const text = (name) => String(form.get(name) ?? "");
  const id = Number(text("id"));
  return {
    id: Number.isInteger(id) && id > 0 ? id : undefined,
    title: text("title"),
    excerpt: text("excerpt"),
    body: text("body"),
    category: text("category"),
    published: form.get("published") === "1",
    image: form.get("image"),
    place: text("place"),
    startsOn: text("startsOn"),
    startsTime: text("startsTime"),
    description: text("description"),
    password: text("password"),
    current: text("current"),
    next: text("next"),
    contactNote: text("contactNote"),
    wasteNote: text("wasteNote"),
    holidayNote: text("holidayNote"),
    weekday: text("weekday"),
    weekParity: text("weekParity"),
    stepDays: text("stepDays"),
    confirm: text("confirm") === "1",
  };
}

async function renderGet(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const ctx = ctxFor(request, path);
  const minimalHome = ctx.minimal && path === "/";

  if (path === "/media" || path.startsWith("/media/")) {
    const key = decodeURIComponent(path.slice("/media/".length));
    const object = await media(env, key);
    if (!object) return new Response("Fotka tu není.", { status: 404 });
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || "application/octet-stream",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (minimalHome || path === "/popelnice") {
    const data = await loadPublic(env);
    return html(
      binsPage(data.waste, { ...ctx, path: "/popelnice", minimal: minimalHome || ctx.minimal }, {
        showExternal: !minimalHome,
        standaloneTitle: minimalHome,
      }),
    );
  }
  if (path === "/") {
    const data = await loadPublic(env);
    return html(homePage(data, ctx));
  }
  if (path === "/zpravy") {
    const data = await loadPublic(env);
    return html(newsPage(data, ctx, url.searchParams.get("rubrika") ?? ""));
  }
  if (path.startsWith("/zpravy/")) {
    const slug = decodeURIComponent(path.slice("/zpravy/".length));
    const article = await loadArticle(env, slug);
    if (!article) return html(missingPage(ctx), 404);
    return html(articlePage(article, ctx));
  }
  if (path === "/akce") {
    const data = await loadPublic(env);
    return html(eventsPage(data, ctx));
  }
  if (path === "/o-nas") {
    const data = await loadPublic(env);
    return html(aboutPage(data, ctx));
  }
  if (path === "/redakce") return redirect("/redakce/zpravy");
  if (path.startsWith("/redakce/")) {
    const data = await loadAdmin(env, request);
    const tab = path.slice("/redakce/".length);
    const message = messageFrom(url);
    if (tab === "zpravy") return html(adminArticles(ctx, data, message, idParam(url), confirmParam(url)));
    if (tab === "akce") return html(adminEvents(ctx, data, message, idParam(url), confirmParam(url)));
    if (tab === "svoz") return html(adminSite(ctx, data, message));
    if (tab === "heslo") return html(adminPassword(ctx, data, message));
  }
  return html(missingPage({ ...ctx, path: "/" }), 404);
}

async function renderPost(request, env, url) {
  if (!sameOrigin(request)) return new Response("Cizí původ.", { status: 403 });
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const https = secure(request);
  const fields = await formFields(request);

  if (path === "/redakce/prihlasit") {
    const result = await login(env, fields.password);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy", sessionCookie(result.token, https));
  }
  if (path === "/redakce/odhlasit") {
    await logout(env);
    return redirect("/redakce/zpravy", clearCookie(https));
  }
  if (path === "/redakce/zpravy/ulozit") {
    const result = await saveArticle(env, request, fields);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/zpravy?ok=${fields.id ? "zprava-upravena" : "zprava"}`);
  }
  if (path === "/redakce/zpravy/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/zpravy");
    const result = await removeArticle(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=zprava-smazana");
  }
  if (path === "/redakce/akce/ulozit") {
    const result = await saveEvent(env, request, fields);
    if (!result.ok) return redirect(`/redakce/akce?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/akce?ok=${fields.id ? "akce-upravena" : "akce"}`);
  }
  if (path === "/redakce/akce/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/akce");
    const result = await removeEvent(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/akce?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/akce?ok=akce-smazana");
  }
  if (path === "/redakce/svoz/ulozit") {
    const result = await saveSite(env, request, fields);
    if (!result.ok) return redirect(`/redakce/svoz?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/svoz?ok=web");
  }
  if (path === "/redakce/heslo/ulozit") {
    const result = await changePassword(env, request, fields.current, fields.next);
    if (!result.ok) return redirect(`/redakce/heslo?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/heslo?ok=heslo", sessionCookie(result.token, https));
  }
  return new Response("Tahle akce tu není.", { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && !url.pathname.startsWith("/media/") && ASSET.test(url.pathname)) {
        return env.ASSETS.fetch(request);
      }
      if (request.method === "GET" || request.method === "HEAD") {
        const response = await renderGet(request, env, url);
        return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
      }
      if (request.method === "POST") return await renderPost(request, env, url);
      return new Response("Metoda není povolená.", { status: 405 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neznámá chyba.";
      return html(brokenPage(message), 500);
    }
  },
};
