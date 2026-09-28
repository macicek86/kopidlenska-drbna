import {
  approveProposal,
  changePassword,
  clearCookie,
  createContributor,
  ensureSchema,
  loadAdmin,
  loadArticle,
  loadCopy,
  loadPublic,
  login,
  logout,
  media,
  rejectProposal,
  removeArticle,
  removeClosure,
  removeDoctor,
  removeDoctorChange,
  removeEvent,
  removeYard,
  saveArticle,
  saveClosure,
  saveCopy,
  saveDoctor,
  saveDoctorChange,
  saveDoctorHours,
  saveEvent,
  saveProfile,
  saveProposal,
  saveSite,
  saveYard,
  sessionCookie,
  saveContributorAccess,
  setContributorActive,
  setContributorPassword,
  userCan,
  withdrawProposal,
} from "./db.js";
import {
  aboutPage,
  adminArticles,
  adminEvents,
  adminPassword,
  adminPeople,
  adminSite,
  adminTexts,
  adminDoctors,
  adminYards,
  articlePage,
  binsPage,
  brokenPage,
  doctorsPage,
  eventsPage,
  homePage,
  missingPage,
  newsPage,
  yardsPage,
} from "./view.js";
import { WEEK_DAYS } from "./yards.js";

const ASSET = /\.(?:png|webp|svg|css|ico|js|jpg|jpeg|gif|woff2)$/i;

const OK = {
  zprava: "Zpráva je uložená.",
  "zprava-upravena": "Zpráva je upravená.",
  "zprava-smazana": "Zpráva je smazaná.",
  akce: "Akce je uložená.",
  "akce-upravena": "Akce je upravená.",
  "akce-smazana": "Akce je smazaná.",
  web: "Svoz a kontakt jsou uložené.",
  texty: "Texty jsou uložené.",
  heslo: "Heslo je změněné.",
  jmeno: "Jméno a alias jsou uložené.",
  dvur: "Sběrný dvůr je uložený.",
  "dvur-upraven": "Sběrný dvůr je upravený.",
  "dvur-smazan": "Sběrný dvůr je smazaný.",
  uzavreni: "Mimořádné uzavření je zapsané.",
  "uzavreni-smazane": "Mimořádné uzavření je zrušené.",
  lekar: "Ordinace je uložená.",
  "lekar-upraven": "Ordinace je upravená.",
  "lekar-smazan": "Ordinace je smazaná.",
  "lekar-hodiny": "Ordinační hodiny jsou uložené.",
  "lekar-zmena": "Dočasná změna je zapsaná.",
  "lekar-zmena-smazana": "Dočasná změna je zrušená.",
  navrh: "Návrh čeká na schválení.",
  "navrh-upraven": "Návrh je upravený a pořád čeká na schválení.",
  "navrh-stazen": "Návrh je stažený.",
  schvaleno: "Příspěvek je schválený a na webu.",
  vraceno: "Návrh je vrácený autorovi.",
  clovek: "Přispěvatel má účet.",
  "clovek-vypnut": "Účet je vypnutý.",
  "clovek-zapnut": "Účet je zase aktivní.",
  "clovek-heslo": "Heslo přispěvatele je nastavené.",
  "clovek-udaje": "Alias a oprávnění jsou uložené.",
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
  const chyba = url.searchParams.get("chyba");
  if (chyba) return { text: chyba, kind: "bad" };
  const ok = url.searchParams.get("ok");
  if (ok && OK[ok]) return { text: OK[ok], kind: "ok" };
  return { text: "", kind: "ok" };
}

function positiveParam(url, name) {
  const id = Number(url.searchParams.get(name));
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
    login: text("login"),
    name: text("name"),
    note: text("note"),
    active: text("active"),
    articleId: Number.isInteger(Number(text("clanek"))) && Number(text("clanek")) > 0 ? Number(text("clanek")) : undefined,
    current: text("current"),
    next: text("next"),
    contactNote: text("contactNote"),
    wasteNote: text("wasteNote"),
    holidayNote: text("holidayNote"),
    weekday: text("weekday"),
    weekParity: text("weekParity"),
    stepDays: text("stepDays"),
    accepts: text("accepts"),
    week: WEEK_DAYS.map(({ day }) => ({
      day,
      open: form.get(`open-${day}`) === "1",
      from: text(`from-${day}`),
      to: text(`to-${day}`),
    })),
    endsOn: text("endsOn"),
    reason: text("reason"),
    alias: text("alias"),
    sortOrder: text("sortOrder"),
    yardId: Number.isInteger(Number(text("yardId"))) && Number(text("yardId")) > 0 ? Number(text("yardId")) : undefined,
    specialty: text("specialty"),
    phone: text("phone"),
    changeNote: text("changeNote"),
    doctorId: Number.isInteger(Number(text("doctorId"))) && Number(text("doctorId")) > 0 ? Number(text("doctorId")) : undefined,
    doctorWeek: WEEK_DAYS.map(({ day }) => ({
      day,
      morning: {
        open: form.get(`am-open-${day}`) === "1",
        from: text(`am-from-${day}`),
        to: text(`am-to-${day}`),
        note: text(`am-note-${day}`),
      },
      afternoon: {
        open: form.get(`pm-open-${day}`) === "1",
        from: text(`pm-from-${day}`),
        to: text(`pm-to-${day}`),
        note: text(`pm-note-${day}`),
      },
    })),
    permissions: form.getAll("permission").map((item) => String(item)),
    confirm: text("confirm") === "1",
  };
}

async function renderGet(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const base = ctxFor(request, path);
  const minimalHome = base.minimal && path === "/";

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

  const ctx = { ...base, copy: await loadCopy(env) };

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
  if (path === "/sberne-dvory") {
    const data = await loadPublic(env);
    return html(yardsPage(data, ctx));
  }
  if (path === "/lekari") {
    const data = await loadPublic(env);
    return html(doctorsPage(data, ctx));
  }
  if (path === "/redakce") return redirect("/redakce/zpravy");
  if (path.startsWith("/redakce/")) {
    const data = await loadAdmin(env, request);
    const tab = path.slice("/redakce/".length);
    const message = messageFrom(url);
    const chiefOnly = new Set(["akce", "texty", "svoz", "lide"]);
    if (data.signedIn && data.user?.role !== "hlavni" && chiefOnly.has(tab)) {
      return redirect(`/redakce/zpravy?chyba=${encodeURIComponent("Tohle mění jen hlavní redaktor.")}`);
    }
    if (tab === "zpravy") {
      return html(
        adminArticles(ctx, data, message, {
          editingId: positiveParam(url, "id"),
          confirmId: positiveParam(url, "smazat"),
          proposalId: positiveParam(url, "navrh"),
          targetId: positiveParam(url, "clanek"),
          withdrawId: positiveParam(url, "stahnout"),
        }),
      );
    }
    if (tab === "akce") return html(adminEvents(ctx, data, message, positiveParam(url, "id"), positiveParam(url, "smazat")));
    if (tab === "texty") return html(adminTexts(ctx, data, message));
    if (tab === "svoz") return html(adminSite(ctx, data, message));
    if (tab === "dvory") {
      if (data.signedIn && !userCan(data.user, "sberny_dvur")) {
        return redirect(`/redakce/zpravy?chyba=${encodeURIComponent("Na sběrné dvory potřebuješ oprávnění.")}`);
      }
      return html(
        adminYards(
          ctx,
          data,
          message,
          positiveParam(url, "id"),
          positiveParam(url, "smazat"),
          positiveParam(url, "zrusit"),
        ),
      );
    }
    if (tab === "lekari") {
      if (data.signedIn && !userCan(data.user, "doktori")) {
        return redirect(`/redakce/zpravy?chyba=${encodeURIComponent("Na lékaře potřebuješ oprávnění.")}`);
      }
      return html(
        adminDoctors(
          ctx,
          data,
          message,
          positiveParam(url, "id"),
          positiveParam(url, "smazat"),
          positiveParam(url, "zrusit"),
        ),
      );
    }
    if (tab === "lide") return html(adminPeople(ctx, data, message, positiveParam(url, "vypnout")));
    if (tab === "heslo") return html(adminPassword(ctx, data, message));
  }
  return html(missingPage({ ...ctx, path: "/" }), 404);
}

async function renderPost(request, env, url) {
  if (!sameOrigin(request)) return new Response("Cizí původ.", { status: 403 });
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const https = secure(request);

  if (path === "/redakce/texty/ulozit") {
    const result = await saveCopy(env, request);
    if (!result.ok) return redirect(`/redakce/texty?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/texty?ok=texty");
  }

  const fields = await formFields(request);

  if (path === "/redakce/prihlasit") {
    const result = await login(env, fields.login, fields.password);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy", sessionCookie(result.token, https));
  }
  if (path === "/redakce/odhlasit") {
    await logout(env, request);
    return redirect("/redakce/zpravy", clearCookie(https));
  }
  if (path === "/redakce/zpravy/navrh") {
    const result = await saveProposal(env, request, fields);
    if (!result.ok) return redirect(withError(deskQuery(fields), result.error));
    return redirect(`/redakce/zpravy?ok=${result.updated ? "navrh-upraven" : "navrh"}`);
  }
  if (path === "/redakce/zpravy/stahnout") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/zpravy");
    const result = await withdrawProposal(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/zpravy?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=navrh-stazen");
  }
  if (path === "/redakce/zpravy/schvalit") {
    const result = await approveProposal(env, request, fields);
    if (!result.ok) return redirect(`/redakce/zpravy?navrh=${fields.id ?? ""}&chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=schvaleno");
  }
  if (path === "/redakce/zpravy/vratit") {
    const result = await rejectProposal(env, request, fields);
    if (!result.ok) return redirect(`/redakce/zpravy?navrh=${fields.id ?? ""}&chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/zpravy?ok=vraceno");
  }
  if (path === "/redakce/lide/ulozit") {
    const result = await createContributor(env, request, fields);
    if (!result.ok) return redirect(`/redakce/lide?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lide?ok=clovek");
  }
  if (path === "/redakce/lide/stav") {
    const result = await setContributorActive(env, request, fields);
    if (!result.ok) return redirect(`/redakce/lide?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/lide?ok=${result.active ? "clovek-zapnut" : "clovek-vypnut"}`);
  }
  if (path === "/redakce/lide/heslo") {
    const result = await setContributorPassword(env, request, fields);
    if (!result.ok) return redirect(`/redakce/lide?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lide?ok=clovek-heslo");
  }
  if (path === "/redakce/lide/udaje") {
    const result = await saveContributorAccess(env, request, fields);
    if (!result.ok) return redirect(`/redakce/lide?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lide?ok=clovek-udaje");
  }
  if (path === "/redakce/jmeno/ulozit") {
    const result = await saveProfile(env, request, fields);
    if (!result.ok) return redirect(`/redakce/heslo?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/heslo?ok=jmeno");
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
  if (path === "/redakce/dvory/ulozit") {
    const result = await saveYard(env, request, fields);
    if (!result.ok) {
      const back = fields.id ? `/redakce/dvory?id=${fields.id}` : "/redakce/dvory";
      return redirect(withError(back, result.error));
    }
    return redirect(`/redakce/dvory?ok=${result.updated ? "dvur-upraven" : "dvur"}`);
  }
  if (path === "/redakce/dvory/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/dvory");
    const result = await removeYard(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/dvory?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/dvory?ok=dvur-smazan");
  }
  if (path === "/redakce/dvory/uzavreni") {
    const result = await saveClosure(env, request, fields);
    if (!result.ok) return redirect(`/redakce/dvory?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/dvory?ok=uzavreni");
  }
  if (path === "/redakce/dvory/uzavreni/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/dvory");
    const result = await removeClosure(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/dvory?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/dvory?ok=uzavreni-smazane");
  }
  if (path === "/redakce/lekari/ulozit") {
    const result = await saveDoctor(env, request, fields);
    if (!result.ok) {
      const back = fields.id ? `/redakce/lekari?id=${fields.id}` : "/redakce/lekari";
      return redirect(withError(back, result.error));
    }
    return redirect(`/redakce/lekari?ok=${result.updated ? "lekar-upraven" : "lekar"}`);
  }
  if (path === "/redakce/lekari/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/lekari");
    const result = await removeDoctor(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/lekari?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lekari?ok=lekar-smazan");
  }
  if (path === "/redakce/lekari/hodiny") {
    const result = await saveDoctorHours(env, request, fields);
    if (!result.ok) return redirect(`/redakce/lekari?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lekari?ok=lekar-hodiny");
  }
  if (path === "/redakce/lekari/zmena") {
    const result = await saveDoctorChange(env, request, fields);
    if (!result.ok) return redirect(`/redakce/lekari?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lekari?ok=lekar-zmena");
  }
  if (path === "/redakce/lekari/zmena/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/lekari");
    const result = await removeDoctorChange(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/lekari?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/lekari?ok=lekar-zmena-smazana");
  }
  if (path === "/redakce/heslo/ulozit") {
    const result = await changePassword(env, request, fields.current, fields.next);
    if (!result.ok) return redirect(`/redakce/heslo?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/heslo?ok=heslo", sessionCookie(result.token, https));
  }
  return new Response("Tahle akce tu není.", { status: 404 });
}

function deskQuery(fields) {
  if (fields.id) return `/redakce/zpravy?navrh=${fields.id}`;
  if (fields.articleId) return `/redakce/zpravy?clanek=${fields.articleId}`;
  return "/redakce/zpravy";
}

function withError(path, error) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}chyba=${encodeURIComponent(error)}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      await ensureSchema(env);
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
