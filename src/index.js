import {
  changePassword,
  clearCookie,
  createContributor,
  ensureSchema,
  loadAdmin,
  loadArticle,
  loadMoreArticles,
  loadCopy,
  loadPublic,
  login,
  logout,
  saveCopy,
  saveProfile,
  saveSite,
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
import { notFoundPage } from "./notfound-view.js";
import { text as tx } from "./copy.js";
import { ACCESS_LOGOUT, accessConfig } from "./access.js";
import {
  adPage,
  adsPage,
  brokenPage,
  doctorsPage,
  eventsPage,
  placesPage,
  homePage,
  outagesPage,
  missingAdPage,
  yardsPage,
} from "./view.js";
import { binsPage } from "./bins-view.js";
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
  adminSkola,
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
import { NDIC_PUSH_PATH, ndicPush } from "./ndic/push.js";
import { runNdic } from "./ndic/run.js";
import { visitPath, visitTarget } from "./visits.js";
import { loadStats, pathViews, recordVisit, STAT_PERIODS } from "./visits-db.js";
import { html, json, plain, redirect, sameOrigin, secure, withError } from "./http.js";
import { robotsTxt, sitemapXml } from "./seo.js";
import { loadSitemap } from "./seo-db.js";
import { OUTAGE_OK, outagePost } from "./post-outages.js";
import { PLACES_OK, placesPost } from "./post-places.js";
import { YARDS_OK, yardsPost } from "./post-yards.js";
import { DOCTORS_OK, doctorsPost } from "./post-doctors.js";
import { REQUESTS_OK } from "./post-requests.js";
import { canSeeHours } from "./hours-requests-db.js";
import { STOCK_OK, stockPost } from "./post-stock.js";
import { IMPORT_OK, munipolisPost } from "./post-munipolis.js";
import { DRBENA_OK, drbenaPost } from "./post-drbena.js";
import { fillKeywords } from "./keywords.js";
import { continueImport, runImport } from "./munipolis/run.js";
import { loadImportSettings } from "./munipolis/store.js";
import { FOOTBALL_OK, footballPost } from "./post-fotbal.js";
import { DENIK_OK, denikPost } from "./post-denik.js";
import { continueDenik, runDenik } from "./denik/run.js";
import { loadDenikSettings } from "./denik/store.js";
import { SKOLA_OK, skolaPost } from "./post-skola.js";
import { continueSkola, runSkola } from "./skola/run.js";
import { SCHOOL_LIST, SCHOOLS } from "./skola/sources.js";
import { loadSkolaSettings } from "./skola/store.js";
import { continueFootball, runFootball } from "./fotbal/run.js";
import { loadFootballSettings } from "./fotbal/store.js";
import { chatPost } from "./chat/run.js";
import { assistPost } from "./assist/run.js";
import { loadAssistAdmin } from "./assist/store.js";
import { pragueNow } from "./waste.js";
import { chatEnabled, loadChatAdmin } from "./chat/store.js";
import { turnstileConfig } from "./chat/pass.js";
import { CHAT_OK, chatAdminPost } from "./post-chat.js";
import { MESSAGES_OK, messagesPost } from "./post-messages.js";
import { loadMessages } from "./messages-db.js";
import { ARTICLES_OK, articlesPost } from "./post-articles.js";
import { ADS_OK, adsPost } from "./post-ads.js";
import { EVENTS_OK, eventsPost } from "./post-events.js";

const ASSET = /\.(?:png|webp|svg|css|ico|js|jpg|jpeg|gif|woff2|webmanifest)$/i;

// Prohlížeč otevírá stránku (adresa v řádku, odkaz), ne obrázek nebo styl pro stránku.
export function wantsPage(request) {
  return /text\/html/i.test(request.headers.get("accept") ?? "");
}

const OK = {
  ...ARTICLES_OK,
  ...ADS_OK,
  ...EVENTS_OK,
  web: "Svoz a kontakt jsou uložené.",
  texty: "Texty jsou uložené.",
  uvitani: "Texty jsou uložené. Uvítací okno se ukáže znovu všem, i těm, kdo ho už viděli.",
  heslo: "Heslo je změněné.",
  jmeno: "Údaje jsou uložené.",
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
  ...YARDS_OK,
  ...DOCTORS_OK,
  ...REQUESTS_OK,
  ...STOCK_OK,
  ...IMPORT_OK,
  ...DRBENA_OK,
  ...FOOTBALL_OK,
  ...DENIK_OK,
  ...SKOLA_OK,
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
  const [article, ads, views, more] = await Promise.all([
    loadArticle(env, slug),
    loadAds(env, { enabledOnly: true }),
    pathViews(env, path),
    loadMoreArticles(env, slug),
  ]);
  return { article, ads, views, more };
}

function chooseAd(request, ads) {
  return pickAd(ads, { avoidId: readSeenAd(request.headers.get("cookie")) });
}

function htmlAd(request, body, ad, status = 200) {
  const cookie = ad?.id != null ? seenAdCookie(ad.id, secure(request)) : undefined;
  return html(body, status, cookie);
}

// Stránka 404 s Drběnou a jednou reklamou.
async function notFound(request, env, ctx, { heading, ads } = {}) {
  const ad = chooseAd(request, ads ?? (await loadAds(env, { enabledOnly: true })));
  return htmlAd(request, notFoundPage(ctx, { heading, ad }), ad, 404);
}

function ctxFor(request, path) {
  const url = new URL(request.url);
  return { path, mainOrigin: url.origin, origin: url.origin };
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
    return plain(sitemapXml(url.origin, await loadSitemap(env)), "application/xml");
  }

  // Texty a data stránky najednou: na sobě nezávisí.
  const slug = path.startsWith("/zpravy/") ? decodeURIComponent(path.slice("/zpravy/".length)) : null;
  const [copy, data, admin, story, chat] = await Promise.all([
    loadCopy(env),
    PUBLIC_PAGES.has(path) ? loadPublic(env) : null,
    path.startsWith("/redakce/") ? loadAdmin(env, request) : null,
    slug == null ? null : loadStory(env, slug, path),
    path.startsWith("/redakce") ? false : chatEnabled(env),
  ]);
  // Okénko chatu s Drběnou: jen na hlavním webu, když ho redakce zapnula.
  const ctx = { ...base, copy, chat: chat ? { siteKey: turnstileConfig(env)?.siteKey ?? "" } : null };

  if (path === "/popelnice") return html(binsPage(data.waste, ctx));
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
    const { article, ads, views: counted, more } = story;
    if (!article) return notFound(request, env, ctx, { heading: tx(copy, "missing_heading"), ads });
    const ad = chooseAd(request, ads);
    // Počet i s tímhle přečtením, když se započítá.
    const views = counted + (visitTarget(request) ? 1 : 0);
    return htmlAd(request, articlePage(article, ctx, { ad, views, more }), ad);
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
    return htmlAd(request, eventsPage({ ...data, ad }, ctx, { month: url.searchParams.get("mesic") }), ad);
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
    const chiefOnly = new Set(["akce", "texty", "svoz", "lide", "odstavky", "rubriky", "munipolis", "fotbal", "denik", ...SCHOOL_LIST.map((source) => source.tag), "drbena", "chat"]);
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
      if (data.signedIn && !canSeeHours(data.user, "dvory")) {
        return redirect(`/redakce/prehled?chyba=${encodeURIComponent("Na sběrné dvory potřebuješ oprávnění.")}`);
      }
      return html(adminYards(ctx, data, message, query));
    }
    if (tab === "lekari") {
      if (data.signedIn && !canSeeHours(data.user, "lekari")) {
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
      if (data.signedIn && !canSeeHours(data.user, "oteviraci-doba")) {
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
    if (Object.hasOwn(SCHOOLS, tab)) {
      const source = SCHOOLS[tab];
      if (data.signedIn && (await continueSkola(env, source, { ctx: execution })).background) {
        data.schools = { ...data.schools, [tab]: { ...data.schools?.[tab], settings: await loadSkolaSettings(env, source) } };
      }
      return html(adminSkola(ctx, data, message, query, source));
    }
    if (tab === "drbena") {
      if (data.signedIn) data.assist = await loadAssistAdmin(env, pragueNow().date);
      return html(adminDrbena(ctx, data, message));
    }
    if (tab === "chat") {
      if (data.signedIn) data.chat = await loadChatAdmin(env);
      return html(adminChat(ctx, data, message, query));
    }
    if (tab === "lide") return html(adminPeople(ctx, data, message, query));
    if (tab === "heslo") return html(adminPassword(ctx, data, message));
  }
  return notFound(request, env, { ...ctx, path: "/" });
}

async function renderPost(request, env, url, execution) {
  if (!sameOrigin(request)) return new Response("Cizí původ.", { status: 403 });
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const https = secure(request);

  // Chat a pomocník při psaní posílají JSON, formulář se tu nečte.
  const chat = await chatPost(path, request, env, execution);
  if (chat) return chat;
  const assist = await assistPost(path, request, env);
  if (assist) return assist;

  if (path === "/redakce/texty/ulozit") {
    const result = await saveCopy(env, request);
    if (!result.ok) return redirect(`/redakce/texty?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/texty?ok=${result.welcomeAgain ? "uvitani" : "texty"}`);
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
  if (path === "/redakce/svoz/ulozit") {
    const result = await saveSite(env, request, fields);
    if (!result.ok) return redirect(`/redakce/svoz?chyba=${encodeURIComponent(result.error)}`);
    return redirect("/redakce/svoz?ok=web");
  }
  const section =
    (await articlesPost(path, request, env, fields)) ??
    (await adsPost(path, request, env, fields)) ??
    (await eventsPost(path, request, env, fields)) ??
    (await outagePost(path, request, env, fields, execution)) ??
    (await placesPost(path, request, env, fields)) ??
    (await yardsPost(path, request, env, fields)) ??
    (await doctorsPost(path, request, env, fields)) ??
    (await stockPost(path, request, env, fields)) ??
    (await munipolisPost(path, request, env, fields, execution)) ??
    (await footballPost(path, request, env, fields, execution)) ??
    (await denikPost(path, request, env, fields, execution)) ??
    (await skolaPost(path, request, env, fields, execution)) ??
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
    // Samostatný web popelnic skončil: popelnice.kopidlenskadrbna.org vede na stránku svozu.
    if (url.hostname.startsWith("popelnice.")) {
      return Response.redirect(`${url.protocol}//${url.hostname.slice("popelnice.".length)}/popelnice`, 301);
    }
    try {
      // Statické soubory databázi nepotřebují.
      if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/media/") && ASSET.test(url.pathname)) {
        const asset = await env.ASSETS.fetch(request);
        // Chybějící soubor: obrázkům a stylům stačí prázdná 404, člověk s adresou v prohlížeči dostane stránku s Drběnou.
        if (asset.status !== 404 || !wantsPage(request)) return asset;
      }
      await ensureSchema(env);
      // Zprávy od NDIC (uzavírky silnic): vlastní přihlášení jménem a heslem, bez kontroly původu.
      if (url.pathname === NDIC_PUSH_PATH) return await ndicPush(request, env, execution);
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
    for (const source of SCHOOL_LIST) ctx.waitUntil(runSkola(env, source).catch(() => {}));
    ctx.waitUntil(runNdic(env).catch(() => {}));
    ctx.waitUntil(fillKeywords(env).catch(() => {}));
  },
};
