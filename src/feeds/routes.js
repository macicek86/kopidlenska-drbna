// Adresy feedů, kalendáře a dat. Čtečky se ptají často: odpověď nese ETag a stejnou verzi vrátí jako 304.
import { loadCopy, loadDoctors, loadFeedArticles, loadOutageBoard, loadRubrics, loadYards } from "../db.js";
import { loadEvents } from "../events-db.js";
import { loadNoticeBoard } from "../notices-db.js";
import { loadPlaces } from "../places-db.js";
import { findRubric } from "../rubrics.js";
import { pragueNow } from "../waste.js";
import { eventsCalendar, eventsFeed } from "./events.js";
import { hoursFeed, loadHoursChanges } from "./hours.js";
import { hoursJson } from "./hours-json.js";
import { NEWS_LIMIT, newsFeed } from "./news.js";
import { noticesFeed } from "./notices.js";
import { feedsPage } from "./page.js";
import { feedOn, loadFeedSettings } from "./settings.js";

const ATOM = "application/atom+xml";
export const FEED_PATHS = ["/feed.xml", "/akce/feed.xml", "/akce.ics", "/oteviraci-doba/feed.xml", "/oteviraci-doba.json", "/odstavky/feed.xml"];

async function etagOf(body) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `"${[...new Uint8Array(hash).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

export async function feedResponse(request, body, contentType) {
  const etag = await etagOf(body);
  const headers = new Headers({
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "public, max-age=900",
    etag,
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  });
  const match = (request.headers.get("if-none-match") ?? "").split(",").map((tag) => tag.trim().replace(/^W\//, ""));
  if (match.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

async function newsBody(env, url, copy) {
  const slug = url.searchParams.get("rubrika") ?? "";
  if (!slug) return newsFeed(url.origin, await loadFeedArticles(env, { limit: NEWS_LIMIT }), copy);
  const rubrics = await loadRubrics(env);
  const rubric = findRubric(rubrics, slug);
  if (!rubric) return null;
  const scope = rubrics.filter((item) => item.id === rubric.id || (!rubric.parentId && item.parentId === rubric.id));
  const articles = await loadFeedArticles(env, {
    rubricIds: scope.map((item) => item.id),
    rubricNames: scope.map((item) => item.name),
    limit: NEWS_LIMIT,
  });
  return newsFeed(url.origin, articles, copy, { rubric, rubrics });
}

async function render(path, env, url, copy) {
  const today = pragueNow().date;
  const base = url.origin;
  if (path === "/feed.xml") return [await newsBody(env, url, copy), ATOM];
  if (path === "/akce/feed.xml") return [eventsFeed(base, await loadEvents(env, { publicOnly: true }), copy, today), ATOM];
  if (path === "/akce.ics") return [eventsCalendar(base, await loadEvents(env, { publicOnly: true }), copy, today), "text/calendar"];
  if (path === "/oteviraci-doba/feed.xml") return [hoursFeed(base, await loadHoursChanges(env, today), copy), ATOM];
  if (path === "/odstavky/feed.xml") {
    const [notices, power] = await Promise.all([loadNoticeBoard(env), loadOutageBoard(env)]);
    return [noticesFeed(base, { notices, power }, copy), ATOM];
  }
  if (path === "/oteviraci-doba.json") {
    const [places, doctors, yards] = await Promise.all([
      loadPlaces(env, { publicOnly: true, today }),
      loadDoctors(env, { publicOnly: true, today }),
      loadYards(env, { publicOnly: true, today }),
    ]);
    return [JSON.stringify(hoursJson(base, { places, doctors, yards })), "application/json"];
  }
  return [null, ""];
}

// Feed, kalendář nebo data na dané adrese, jinak null (pokračuje běžný web).
export async function feedGet(path, request, env, url) {
  if (!FEED_PATHS.includes(path)) return null;
  const [copy, on] = await Promise.all([loadCopy(env), loadFeedSettings(env)]);
  const rubric = path === "/feed.xml" && url.searchParams.get("rubrika");
  // Vypnutý v redakci: jako by tu nebyl.
  if (!feedOn(on, rubric ? "/feed.xml?rubrika=" : path)) return new Response("Tenhle feed je vypnutý.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const [body, contentType] = await render(path, env, url, copy);
  if (body == null) return new Response("Tahle rubrika tu není.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return feedResponse(request, body, contentType);
}

// Stránka /odber (HTML, jde přes běžné vykreslení webu).
export async function feedsPageHtml(env, ctx) {
  return feedsPage(await loadRubrics(env), ctx);
}
