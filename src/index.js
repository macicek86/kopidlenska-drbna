import {
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
  removeClosure,
  removeDoctor,
  removeDoctorChange,
  removeEvent,
  removeYard,
  saveClosure,
  saveCopy,
  saveDoctor,
  saveDoctorChange,
  saveDoctorHours,
  saveEvent,
  saveProfile,
  saveSite,
  saveYard,
  loadOutageBoard,
  refreshOutages,
  removeRubric,
  saveRubric,
  sessionCookie,
  saveContributorAccess,
  setContributorActive,
  setContributorPassword,
  userCan,
} from "./db.js";
import { loadAd, loadAds } from "./ads-db.js";
import { ACCESS_LOGOUT, accessConfig } from "./access.js";
import {
  adPage,
  adsPage,
  binsPage,
  brokenPage,
  doctorsPage,
  eventsPage,
  placesPage,
  homePage,
  outagesPage,
  missingAdPage,
  missingPage,
  yardsPage,
} from "./view.js";
import { aboutPage } from "./about.js";
import { media } from "./images.js";
import { articlePage, newsPage } from "./news.js";
import {
  adminAds,
  adminArticles,
  adminChat,
  adminDoctors,
  adminDrbena,
  adminEvents,
  adminMessages,
  adminMunipolis,
  adminFootball,
  adminDenik,
  adminOutages,
  adminPlaces,
  adminOverview,
  adminPassword,
  adminPeople,
  adminRubrics,
  adminSite,
  adminStats,
  adminStock,
  adminTexts,
  adminYards,
} from "./admin/index.js";
import { pickAd, readSeenAd, seenAdCookie } from "./ads.js";
import { boardJson, feedIsStale } from "./outages.js";
import { adminQuery, formFields } from "./forms.js";
import { visitPath, visitTarget } from "./visits.js";
import { loadStats, pathViews, recordVisit, STAT_PERIODS } from "./visits-db.js";
import { html, json, plain, redirect, sameOrigin, secure, withError } from "./http.js";
import { robotsTxt, sitemapXml } from "./seo.js";
import { loadSitemap } from "./seo-db.js";
import { OUTAGE_OK, outagePost } from "./post-outages.js";
import { PLACES_OK, placesPost } from "./post-places.js";
import { STOCK_OK, stockPost } from "./post-stock.js";
import { IMPORT_OK, munipolisPost } from "./post-munipolis.js";
import { DRBENA_OK, drbenaPost } from "./post-drbena.js";
import { continueImport, runImport } from "./munipolis/run.js";
import { loadImportSettings } from "./munipolis/store.js";
import { FOOTBALL_OK, footballPost } from "./post-fotbal.js";
import { DENIK_OK, denikPost } from "./post-denik.js";
import { continueDenik, runDenik } from "./denik/run.js";
import { loadDenikSettings } from "./denik/store.js";
import { continueFootball, runFootball } from "./fotbal/run.js";
import { loadFootballSettings } from "./fotbal/store.js";
import { chatPost } from "./chat/run.js";
import { chatEnabled, loadChatAdmin } from "./chat/store.js";
import { turnstileConfig } from "./chat/pass.js";
import { CHAT_OK, chatAdminPost } from "./post-chat.js";
import { MESSAGES_OK, messagesPost } from "./post-messages.js";
import { loadMessages } from "./messages-db.js";
import { ARTICLES_OK, articlesPost } from "./post-articles.js";
import { ADS_OK, adsPost } from "./post-ads.js";

const ASSET = /\.(?:png|webp|svg|css|ico|js|jpg|jpeg|gif|woff2)$/i;

const OK = {
  ...ARTICLES_OK,
  ...ADS_OK,
  akce: "Akce je uložená.",
  "akce-upravena": "Akce je upravená.",
  "akce-smazana": "Akce je smazaná.",
  web: "Svoz a kontakt jsou uložené.",
  texty: "Texty jsou uložené.",
  heslo: "Heslo je změněné.",
  jmeno: "Údaje jsou uložené.",
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
  rubrika: "Rubrika je uložená.",
  "rubrika-upravena": "Rubrika je upravená.",
  "rubrika-smazana": "Rubrika je smazaná.",
  clovek: "Přispěvatel má účet.",
  "clovek-vypnut": "Účet je vypnutý.",
  "clovek-zapnut": "Účet je zase aktivní.",
  "clovek-heslo": "Heslo přispěvatele je nastavené.",
  "clovek-udaje": "Údaje přispěvatele jsou uložené.",
  ...OUTAGE_OK,
  ...PLACES_OK,
  ...STOCK_OK,
  ...IMPORT_OK,
  ...DRBENA_OK,
  ...FOOTBALL_OK,
  ...DENIK_OK,
  ...CHAT_OK,
  ...MESSAGES_OK,
};

// Stránky, které berou data z loadPublic.
const PUBLIC_PAGES = new Set([
  "/",
  "/popelnice",
  "/odstavky",
  "/zpravy",
  "/reklamy",
  "/akce",
  "/o-nas",
  "/sberne-dvory",
  "/lekari",
  "/oteviraci-doba",
]);

async function loadStory(env, slug, path) {
  const [article, ads, views] = await Promise.all([
    loadArticle(env, slug),
    loadAds(env, { enabledOnly: true }),
    pathViews(env, path),
  ]);
  return { article, ads, views };
}

function chooseAd(request, ads) {
  return pickAd(ads, { avoidId: readSeenAd(request.headers.get("cookie")) });
}

function htmlAd(request, body, ad) {
  const cookie = ad?.id != null ? seenAdCookie(ad.id, secure(request)) : undefined;
  return html(body, 200, cookie);
}

function ctxFor(request, path) {
  const url = new URL(request.url);
  const minimal = url.hostname.startsWith("popelnice.");
  const host = minimal ? url.hostname.replace(/^popelnice\./, "") : url.hostname;
  return { path, minimal, mainOrigin: `${url.protocol}//${host}`, origin: url.origin };
}

function messageFrom(url) {
  const chyba = url.searchParams.get("chyba");
  if (chyba) return { text: chyba, kind: "bad" };
  const ok = url.searchParams.get("ok");
  if (ok && OK[ok]) return { text: OK[ok], kind: "ok" };
  return { text: "", kind: "ok" };
}

function kickOutageRefresh(env, ctx, board) {
  if (!ctx?.waitUntil || !feedIsStale(board)) return;
  ctx.waitUntil(refreshOutages(env).catch(() => {}));
}

async function renderGet(request, env, url, execution) {
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

  if (path === "/robots.txt") return plain(robotsTxt(url.origin), "text/plain");
  if (path === "/sitemap.xml") {
    return plain(sitemapXml(url.origin, await loadSitemap(env), { minimal: base.minimal }), "application/xml");
  }

  // Texty a data stránky najednou: na sobě nezávisí.
  const slug = path.startsWith("/zpravy/") ? decodeURIComponent(path.slice("/zpravy/".length)) : null;
  const [copy, data, admin, story, chat] = await Promise.all([
    loadCopy(env),
    minimalHome || PUBLIC_PAGES.has(path) ? loadPublic(env) : null,
    path.startsWith("/redakce/") ? loadAdmin(env, request) : null,
    slug == null ? null : loadStory(env, slug, path),
    path.startsWith("/redakce") || base.minimal ? false : chatEnabled(env),
  ]);
  // Okénko chatu s Drběnou: jen na hlavním webu, když ho redakce zapnula.
  const ctx = { ...base, copy, chat: chat ? { siteKey: turnstileConfig(env)?.siteKey ?? "" } : null };

  if (minimalHome || path === "/popelnice") {
    return html(
      binsPage(data.waste, { ...ctx, path: "/popelnice", minimal: minimalHome || ctx.minimal }, {
        showExternal: !minimalHome,
        standaloneTitle: minimalHome,
      }),
    );
  }
  if (path === "/") {
    kickOutageRefresh(env, execution, data.outages);
    const ad = chooseAd(request, data.ads);
    return htmlAd(request, homePage({ ...data, ad }, ctx), ad);
  }
  if (path === "/odstavky.json") {
    const board = await loadOutageBoard(env);
    kickOutageRefresh(env, execution, board);
    return json(boardJson(board));
  }
  if (path === "/odstavky") {
    kickOutageRefresh(env, execution, data.outages);
    return html(outagesPage(data, ctx));
  }
  if (path === "/zpravy") {
    const ad = chooseAd(request, data.ads);
    return htmlAd(request, newsPage({ ...data, ad }, ctx, url.searchParams.get("rubrika") ?? ""), ad);
  }
  if (path.startsWith("/zpravy/")) {
    const { article, ads, views: counted } = story;
    if (!article) return html(missingPage(ctx), 404);
    const ad = chooseAd(request, ads);
    // Počet i s tímhle přečtením, když se započítá.
    const views = counted + (visitTarget(request) ? 1 : 0);
    return htmlAd(request, articlePage(article, ctx, { ad, views }), ad);
  }
  if (path === "/reklamy") {
    return html(adsPage(data, ctx));
  }
  if (path.startsWith("/reklamy/")) {
    const slug = decodeURIComponent(path.slice("/reklamy/".length));
    const ad = await loadAd(env, slug);
    if (!ad) return html(missingAdPage(ctx), 404);
    return html(adPage(ad, ctx));
  }
  if (path === "/akce") {
    const ad = chooseAd(request, data.ads);
    return htmlAd(request, eventsPage({ ...data, ad }, ctx), ad);
  }
  if (path === "/o-nas") {
    return html(aboutPage(data, ctx));
  }
  if (path === "/sberne-dvory") {
    return html(yardsPage(data, ctx));
  }
  if (path === "/lekari") {
    return html(doctorsPage(data, ctx));
  }
  if (path === "/oteviraci-doba") {
    return html(placesPage(data, ctx));
  }
  if (path === "/redakce") return redirect("/redakce/prehled");
  if (path.startsWith("/redakce/")) {
    const data = admin;
    const tab = path.slice("/redakce/".length);
    const message = messageFrom(url);
    const chiefOnly = new Set(["akce", "texty", "svoz", "lide", "odstavky", "rubriky", "munipolis", "fotbal", "denik", "drbena", "chat"]);
    if (data.signedIn && data.user?.role !== "hlavni" && chiefOnly.has(tab)) {
      return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Tohle mění jen hlavní redaktor.")}`);
    }
    const query = adminQuery(url);
    if (tab === "prehled") return html(adminOverview(ctx, data, message));
    if (tab === "reklamy") return html(adminAds(ctx, data, message, query));
    if (tab === "zpravy") return html(adminArticles(ctx, data, message, query));
    if (tab === "rubriky") return html(adminRubrics(ctx, data, message, query));
    if (tab === "akce") return html(adminEvents(ctx, data, message, query));
    if (tab === "texty") return html(adminTexts(ctx, data, message));
    if (tab === "svoz") return html(adminSite(ctx, data, message));
    if (tab === "dvory") {
      if (data.signedIn && !userCan(data.user, "sberny_dvur")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na sběrné dvory potřebuješ oprávnění.")}`);
      }
      return html(adminYards(ctx, data, message, query));
    }
    if (tab === "lekari") {
      if (data.signedIn && !userCan(data.user, "doktori")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na lékaře potřebuješ oprávnění.")}`);
      }
      return html(adminDoctors(ctx, data, message, query));
    }
    if (tab === "vzkazy") {
      if (data.signedIn && !userCan(data.user, "vzkazy")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na vzkazy potřebuješ oprávnění.")}`);
      }
      if (data.signedIn) [data.messages, data.chatOff] = await Promise.all([loadMessages(env), chatEnabled(env).then((on) => !on)]);
      return html(adminMessages(ctx, data, message, { remove: Number(url.searchParams.get("smazat")) || 0 }));
    }
    if (tab === "statistiky") {
      if (data.signedIn && !userCan(data.user, "statistiky")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na statistiky potřebuješ oprávnění.")}`);
      }
      const period = Number(url.searchParams.get("obdobi"));
      if (data.signedIn) data.stats = await loadStats(env, STAT_PERIODS.includes(period) ? period : 30);
      return html(adminStats(ctx, data, message));
    }
    if (tab === "oteviraci-doba") {
      if (data.signedIn && !userCan(data.user, "oteviraci_doba")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na otevírací dobu potřebuješ oprávnění.")}`);
      }
      return html(adminPlaces(ctx, data, message, query));
    }
    if (tab === "obrazky") {
      if (data.signedIn && !userCan(data.user, "obrazky")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na knihovnu obrázků potřebuješ oprávnění.")}`);
      }
      return html(adminStock(ctx, data, message, query));
    }
    if (tab === "odstavky") return html(adminOutages(ctx, data, message, query));
    if (tab === "munipolis") {
      // Otevřená stránka dopisuje, co redakce vybrala (na pozadí, po krátkých dávkách).
      if (data.signedIn && (await continueImport(env, { ctx: execution })).background) data.importSettings = await loadImportSettings(env);
      return html(adminMunipolis(ctx, data, message, query));
    }
    if (tab === "fotbal") {
      if (data.signedIn && (await continueFootball(env, { ctx: execution })).background) data.footballSettings = await loadFootballSettings(env);
      return html(adminFootball(ctx, data, message, query));
    }
    if (tab === "denik") {
      if (data.signedIn && (await continueDenik(env, { ctx: execution })).background) data.denikSettings = await loadDenikSettings(env);
      return html(adminDenik(ctx, data, message, query));
    }
    if (tab === "drbena") return html(adminDrbena(ctx, data, message));
    if (tab === "chat") {
      if (data.signedIn) data.chat = await loadChatAdmin(env);
      return html(adminChat(ctx, data, message, query));
    }
    if (tab === "lide") return html(adminPeople(ctx, data, message, query));
    if (tab === "heslo") return html(adminPassword(ctx, data, message));
  }
  return html(missingPage({ ...ctx, path: "/" }), 404);
}

async function renderPost(request, env, url, execution) {
  if (!sameOrigin(request)) return new Response("Cizí původ.", { status: 403 });
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const https = secure(request);

  // Chat posílá JSON, formulář se tu nečte.
  const chat = await chatPost(path, request, env, execution);
  if (chat) return chat;

  if (path === "/redakce/texty/ulozit") {
    const result = await saveCopy(env, request);
    if (!result.ok) return redirect(`/redakce/texty?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/texty?ok=texty");
  }

  const fields = await formFields(request);

  if (path === "/redakce/prihlasit") {
    const result = await login(env, fields.login, fields.password);
    if (!result.ok) return redirect(`/redakce/prehled?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/prehled", sessionCookie(result.token, https));
  }
  if (path === "/redakce/odhlasit") {
    await logout(env, request);
    return redirect(accessConfig(env) ? ACCESS_LOGOUT : "/redakce/prehled", clearCookie(https));
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
  if (path === "/redakce/rubriky/ulozit") {
    const result = await saveRubric(env, request, fields);
    if (!result.ok) {
      const back = fields.id ? `/redakce/rubriky?id=${fields.id}` : "/redakce/rubriky";
      return redirect(withError(back, result.error));
    }
    return redirect(`/redakce/rubriky?ok=${fields.id ? "rubrika-upravena" : "rubrika"}`);
  }
  if (path === "/redakce/rubriky/smazat") {
    if (!fields.confirm || !fields.id) return redirect("/redakce/rubriky");
    const result = await removeRubric(env, request, fields.id);
    if (!result.ok) return redirect(`/redakce/rubriky?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/rubriky?ok=rubrika-smazana");
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
  const section =
    (await articlesPost(path, request, env, fields)) ??
    (await adsPost(path, request, env, fields)) ??
    (await outagePost(path, request, env, fields)) ??
    (await placesPost(path, request, env, fields)) ??
    (await stockPost(path, request, env, fields)) ??
    (await munipolisPost(path, request, env, fields, execution)) ??
    (await footballPost(path, request, env, fields, execution)) ??
    (await denikPost(path, request, env, fields, execution)) ??
    (await drbenaPost(path, request, env, fields, ctxFor(request, "/redakce/drbena"))) ??
    (await chatAdminPost(path, request, env, fields)) ??
    (await messagesPost(path, request, env, fields));
  if (section) return section;
  if (path === "/redakce/heslo/ulozit") {
    const result = await changePassword(env, request, fields.current, fields.next);
    if (!result.ok) return redirect(`/redakce/heslo?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/heslo?ok=heslo", sessionCookie(result.token, https));
  }
  return new Response("Tahle akce tu není.", { status: 404 });
}



export default {
  async fetch(request, env, execution) {
    const url = new URL(request.url);
    try {
      // Statické soubory databázi nepotřebují.
      if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/media/") && ASSET.test(url.pathname)) {
        return env.ASSETS.fetch(request);
      }
      await ensureSchema(env);
      if (request.method === "GET" || request.method === "HEAD") {
        const response = await renderGet(request, env, url, execution);
        const visit = visitPath(request, response);
        if (visit) execution.waitUntil(recordVisit(env, request, visit).catch(() => {}));
        return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
      }
      if (request.method === "POST") return await renderPost(request, env, url, execution);
      return new Response("Metoda není povolená.", { status: 405 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neznámá chyba.";
      return html(brokenPage(message), 500);
    }
  },
  async scheduled(_event, env, ctx) {
    await ensureSchema(env);
    ctx.waitUntil(refreshOutages(env).catch(() => {}));
    ctx.waitUntil(runImport(env).catch(() => {}));
    ctx.waitUntil(runFootball(env).catch(() => {}));
    ctx.waitUntil(runDenik(env).catch(() => {}));
  },
};
