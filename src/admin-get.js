// Stránky redakce (GET /redakce/…): kontrola oprávnění, doplnění dat sekce a vykreslení.
import {
  adminAccount,
  adminAds,
  adminArticles,
  adminAudit,
  adminHealth,
  adminChat,
  adminFeeds,
  adminMailin,
  adminDoctors,
  adminDrbena,
  adminEvents,
  adminMessages,
  adminMunipolis,
  adminFacebook,
  adminFootball,
  adminDenik,
  adminSkola,
  adminOkoli,
  adminOutages,
  adminPlaces,
  adminOverview,
  adminPeople,
  adminRubrics,
  adminSite,
  adminStats,
  adminStock,
  adminTexts,
  adminYards,
} from "./admin/index.js";
import { auditQuery } from "./admin/audit.js";
import { loadAudit } from "./audit-db.js";
import { userCan } from "./db.js";
import { adminQuery } from "./forms.js";
import { canSeeHours } from "./hours-requests-db.js";
import { html, redirect } from "./http.js";
import { messageFrom } from "./ok-messages.js";
import { loadMessages } from "./messages-db.js";
import { listSessions, loginSettings } from "./login-db.js";
import { loadNotifySwitches } from "./notify.js";
import { loadStats, STAT_PERIODS } from "./visits-db.js";
import { SCHOOL_LIST, SCHOOLS } from "./skola/sources.js";
import { countBySource, loadNearbyEvents, loadOkoliSettings } from "./okoli/store.js";
import { shiftDay } from "./okoli/outings.js";
import { loadAssistAdmin } from "./assist/store.js";
import { chatEnabled, loadChatAdmin } from "./chat/store.js";
import { pragueNow } from "./waste.js";
import { loadFeedSettings } from "./feeds/settings.js";
import { loadPushStats } from "./push/store.js";
import { vapidReady } from "./push/crypto.js";
import { loadMailAdmin } from "./mailin/store.js";
import { loadHealthRows } from "./health/store.js";
import { loadFacebook } from "./facebook/store.js";
import { loadQueues } from "./health/queues.js";

// `data` je loadAdmin. Neznámá stránka: null.
export async function renderAdmin(env, url, ctx, data) {
  const tab = url.pathname.replace(/\/+$/, "").slice("/redakce/".length);
  const message = messageFrom(url);
  const chiefOnly = new Set(["akce", "texty", "svoz", "lide", "odstavky", "rubriky", "munipolis", "facebook", "fotbal", "denik", ...SCHOOL_LIST.map((source) => source.tag), "okoli", "drbena", "chat", "odber", "emaily", "historie", "stav"]);
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
    return html(adminMunipolis(ctx, data, message, query));
  }
  if (tab === "facebook") {
    if (data.signedIn) data.facebook = await loadFacebook(env);
    return html(adminFacebook(ctx, data, message, query));
  }
  if (tab === "fotbal") {
    return html(adminFootball(ctx, data, message, query));
  }
  if (tab === "denik") {
    return html(adminDenik(ctx, data, message, query));
  }
  if (Object.hasOwn(SCHOOLS, tab)) {
    const source = SCHOOLS[tab];
    return html(adminSkola(ctx, data, message, query, source));
  }
  if (tab === "okoli") {
    if (data.signedIn) {
      const today = pragueNow().date;
      const [settings, sources, events] = await Promise.all([loadOkoliSettings(env), countBySource(env, today), loadNearbyEvents(env, { from: today, to: shiftDay(today, 27), withHidden: true })]);
      data.okoli = { settings, sources, events };
    }
    return html(adminOkoli(ctx, data, message, query));
  }
  if (tab === "drbena") {
    if (data.signedIn) data.assist = await loadAssistAdmin(env, pragueNow().date);
    return html(adminDrbena(ctx, data, message));
  }
  if (tab === "chat") {
    if (data.signedIn) data.chat = await loadChatAdmin(env);
    return html(adminChat(ctx, data, message, query));
  }
  if (tab === "odber") {
    if (data.signedIn) {
      [data.feedSettings, data.push] = await Promise.all([loadFeedSettings(env), loadPushStats(env)]);
      data.push.ready = vapidReady(env);
    }
    return html(adminFeeds(ctx, data, message));
  }
  if (tab === "emaily") {
    if (data.signedIn) data.mailin = await loadMailAdmin(env);
    return html(adminMailin(ctx, data, message, query));
  }
  if (tab === "stav") {
    if (data.signedIn) data.health = { rows: data.healthRows ?? (await loadHealthRows(env)), ...(await loadQueues(env)) };
    return html(adminHealth(ctx, data, message));
  }
  if (tab === "historie") {
    if (data.signedIn) data.audit = await loadAudit(env, auditQuery(url));
    return html(adminAudit(ctx, data, message, auditQuery(url)));
  }
  if (tab === "lide") {
    if (data.signedIn) data.loginSettings = await loginSettings(env);
    return html(adminPeople(ctx, data, message, query));
  }
  if (tab === "ucet") {
    if (data.signedIn) {
      [data.sessions, data.notifySwitches] = await Promise.all([listSessions(env, data.user.id), loadNotifySwitches(env, data.user)]);
    }
    return html(adminAccount(ctx, data, message));
  }
  return null;
}
