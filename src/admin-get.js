// Stránky redakce (GET /redakce/…): kontrola oprávnění, doplnění dat sekce a vykreslení.
import {
  adminAccount,
  adminAds,
  adminArticles,
  adminAudit,
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
import { loadStats, STAT_PERIODS } from "./visits-db.js";
import { continueImport } from "./munipolis/run.js";
import { loadImportSettings } from "./munipolis/store.js";
import { continueFootball } from "./fotbal/run.js";
import { loadFootballSettings } from "./fotbal/store.js";
import { continueDenik } from "./denik/run.js";
import { loadDenikSettings } from "./denik/store.js";
import { continueSkola } from "./skola/run.js";
import { SCHOOL_LIST, SCHOOLS } from "./skola/sources.js";
import { loadSkolaSettings } from "./skola/store.js";
import { loadAssistAdmin } from "./assist/store.js";
import { chatEnabled, loadChatAdmin } from "./chat/store.js";
import { pragueNow } from "./waste.js";

// `data` je loadAdmin, `execution` kontext Workeru (importy dopisují vybrané na pozadí). Neznámá stránka: null.
export async function renderAdmin(env, url, ctx, data, execution) {
  const tab = url.pathname.replace(/\/+$/, "").slice("/redakce/".length);
  const message = messageFrom(url);
  const chiefOnly = new Set(["akce", "texty", "svoz", "lide", "odstavky", "rubriky", "munipolis", "fotbal", "denik", ...SCHOOL_LIST.map((source) => source.tag), "drbena", "chat", "historie"]);
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
  if (tab === "historie") {
    if (data.signedIn) data.audit = await loadAudit(env, auditQuery(url));
    return html(adminAudit(ctx, data, message, auditQuery(url)));
  }
  if (tab === "lide") {
    if (data.signedIn) data.loginSettings = await loginSettings(env);
    return html(adminPeople(ctx, data, message, query));
  }
  if (tab === "ucet") {
    if (data.signedIn) data.sessions = await listSessions(env, data.user.id);
    return html(adminAccount(ctx, data, message));
  }
  return null;
}
