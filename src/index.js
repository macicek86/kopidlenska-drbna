import {
  ensureSchema,
  loadArticle,
  loadAdmin,
  loadMoreArticles,
  loadCopy,
  loadPublic,
  saveCopy,
  saveSite,
  loadOutageBoard,
  refreshOutages,
  removeRubric,
  saveRubric,
} from "./db.js";
import { loadAd, loadAds } from "./ads-db.js";
import { notFoundPage } from "./notfound-view.js";
import { text as tx } from "./copy.js";
import { currentUser } from "./db-core.js";
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
import { renderAdmin } from "./admin-get.js";
import { manageGet, managePost } from "./manage/routes.js";
import { auditFinish, auditStart } from "./audit.js";
import { pruneAudit } from "./audit-db.js";
import { echoEnabled, loginGet, loginPost } from "./login.js";
import { pruneLogin } from "./login-db.js";
import { accountPost } from "./post-account.js";
import { OK } from "./ok-messages.js";
import { pickAd, readSeenAd, seenAdCookie } from "./ads.js";
import { boardJson, feedIsStale } from "./outages.js";
import { formFields } from "./forms.js";
import { NDIC_PUSH_PATH, ndicPush } from "./ndic/push.js";
import { runNdic } from "./ndic/run.js";
import { visitPath, visitTarget } from "./visits.js";
import { pathViews, recordVisit } from "./visits-db.js";
import { hostRedirect, html, json, plain, redirect, sameOrigin, secure, withError } from "./http.js";
import { robotsTxt, sitemapXml } from "./seo.js";
import { loadSitemap } from "./seo-db.js";
import { feedGet, feedsPageHtml } from "./feeds/routes.js";
import { anyFeedOn, loadFeedSettings } from "./feeds/settings.js";
import { outagePost } from "./post-outages.js";
import { placesPost } from "./post-places.js";
import { yardsPost } from "./post-yards.js";
import { doctorsPost } from "./post-doctors.js";
import { stockPost } from "./post-stock.js";
import { munipolisPost } from "./post-munipolis.js";
import { drbenaPost } from "./post-drbena.js";
import { fillKeywords } from "./keywords.js";
import { runImport } from "./munipolis/run.js";
import { footballPost } from "./post-fotbal.js";
import { denikPost } from "./post-denik.js";
import { runDenik } from "./denik/run.js";
import { skolaPost } from "./post-skola.js";
import { runSkola } from "./skola/run.js";
import { SCHOOL_LIST } from "./skola/sources.js";
import { runFootball } from "./fotbal/run.js";
import { chatPost } from "./chat/run.js";
import { assistPost } from "./assist/run.js";
import { chatPublic } from "./chat/store.js";
import { turnstileConfig } from "./chat/pass.js";
import { chatAdminPost } from "./post-chat.js";
import { messagesPost } from "./post-messages.js";
import { articlesPost } from "./post-articles.js";
import { adsPost } from "./post-ads.js";
import { eventsPost } from "./post-events.js";
import { feedsPost } from "./post-feeds.js";

const ASSET = /\.(?:png|webp|svg|css|ico|js|jpg|jpeg|gif|woff2|webmanifest)$/i;

// Prohlížeč otevírá stránku (adresa v řádku, odkaz), ne obrázek nebo styl pro stránku.
export function wantsPage(request) {
  return /text\/html/i.test(request.headers.get("accept") ?? "");
}


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
  // Feedy (Atom), kalendář akcí (iCalendar) a otevírací doba jako data.
  const feed = await feedGet(path, request, env, url);
  if (feed) return feed;

  // Odkaz pro správce místa, ordinace či dvora: vlastní stránka bez přihlášení.
  const manage = await manageGet(path, request, env, url);
  if (manage) return manage;

  // Texty a data stránky najednou: na sobě nezávisí.
  const slug = path.startsWith("/zpravy/") ? decodeURIComponent(path.slice("/zpravy/".length)) : null;
  const [copy, data, admin, story, chat, feedOn] = await Promise.all([
    loadCopy(env),
    PUBLIC_PAGES.has(path) ? loadPublic(env) : null,
    path.startsWith("/redakce/") ? loadAdmin(env, request) : null,
    slug == null ? null : loadStory(env, slug, path),
    path.startsWith("/redakce") ? null : chatPublic(env),
    path.startsWith("/redakce") ? null : loadFeedSettings(env),
  ]);
  // Okénko chatu s Drběnou: jen na hlavním webu, když ho redakce zapnula.
  // feedOn: které feedy redakce nechala zapnuté (odkazy v hlavičce, na stránkách a strukturovaná data hodin).
  const ctx = { ...base, copy, feedOn, chat: chat ? { ...chat, siteKey: turnstileConfig(env)?.siteKey ?? "" } : null };

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
  if (path === "/odber") return anyFeedOn(feedOn) ? html(await feedsPageHtml(env, ctx)) : notFound(request, env, ctx);
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
    const login = await loginGet(path, request, env, url);
    if (login) return login;
    // Místní náhled s LOGIN_CODE_ECHO: kód z adresy se ukáže na přihlašovací stránce.
    if (admin.login && echoEnabled(env, url)) admin.login.echo = /^\d{6}$/.test(url.searchParams.get("kod") ?? "") ? url.searchParams.get("kod") : "";
    const page = await renderAdmin(env, url, ctx, admin, execution);
    if (page) return page;
  }
  return notFound(request, env, { ...ctx, path: "/" });
}

async function renderPost(request, env, url, execution) {
  if (!sameOrigin(request)) return new Response("Cizí původ.", { status: 403 });
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Chat a pomocník při psaní posílají JSON, formulář se tu nečte.
  const chat = await chatPost(path, request, env, execution);
  if (chat) return chat;
  const assist = await assistPost(path, request, env);
  if (assist) return assist;

  // Texty webu čtou formulář samy (pole podle seznamu textů).
  const fields = path === "/redakce/texty/ulozit" ? {} : await formFields(request);
  // Přihlášení a odhlášení: mimo historii změn, zapisují se samy (src/login.js).
  const login = await loginPost(path, request, env, url, fields);
  if (login) return login;
  // Odkaz pro správce: do historie změn zapisuje sám, pod jménem, které správce napsal.
  const manage = await managePost(path, request, env, fields);
  if (manage) return manage;
  // Historie změn: snímek dotčených záznamů před uložením a po něm.
  const watch = path.startsWith("/redakce/") ? await auditStart(env, path, fields, () => currentUser(env, request)).catch(() => null) : null;
  const response = await handlePost(request, env, path, fields, execution);
  await auditFinish(env, watch, response, OK).catch(() => {});
  return response;
}

async function handlePost(request, env, path, fields, execution) {
  if (path === "/redakce/texty/ulozit") {
    const result = await saveCopy(env, request);
    if (!result.ok) return redirect(`/redakce/texty?chyba=${encodeURIComponent(result.error)}`);
    return redirect(`/redakce/texty?ok=${result.welcomeAgain ? "uvitani" : "texty"}`);
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
    (await accountPost(path, request, env, fields)) ??
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
    (await feedsPost(path, request, env, fields)) ??
    (await messagesPost(path, request, env, fields));
  if (section) return section;
  return new Response("Tahle akce tu není.", { status: 404 });
}

export default {
  async fetch(request, env, execution) {
    const url = new URL(request.url);
    // NDIC přesměrování nesleduje: zprávy o uzavírkách se berou na kterékoli adrese.
    const moved = url.pathname === NDIC_PUSH_PATH ? null : hostRedirect(request);
    if (moved) return moved;
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
    ctx.waitUntil(pruneAudit(env).catch(() => {}));
    ctx.waitUntil(pruneLogin(env).catch(() => {}));
  },
};
