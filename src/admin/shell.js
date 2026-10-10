import { byline, userCan } from "../db.js";
import { canSeeHours } from "../hours-requests-db.js";
import { problemCount } from "../health/rules.js";
import { SCHOOL_LIST } from "../skola/sources.js";
import { esc, flashOf } from "../view.js";
import { adminDocument } from "./document.js";
import { loginPage } from "./login.js";
import { icon } from "./ui.js";

function nav(data) {
  const chief = data.user?.role === "hlavni";
  const waiting = (data.proposals ?? []).filter((item) => item.status === "pending").length;
  const adWaiting = (data.adProposals ?? []).filter((item) => item.status === "pending").length;
  const returned = chief ? 0 : (data.proposals ?? []).filter((item) => item.status === "rejected").length + (data.botProposals ?? []).length;
  const adReturned = chief ? 0 : (data.adProposals ?? []).filter((item) => item.status === "rejected").length;
  const importFailed = (data.importItems ?? []).filter((item) => item.status === "chyba").length;
  const footballFailed = (data.footballItems ?? []).filter((item) => item.status === "chyba").length;
  const denikFailed = (data.denikItems ?? []).filter((item) => item.status === "chyba").length;
  const schoolFailed = (tag) => (data.schools?.[tag]?.items ?? []).filter((item) => item.status === "chyba").length;
  // Hlavnímu redaktorovi návrhy ke schválení, žadateli zamítnuté.
  const hoursWaiting = (section) => (data.hoursRequests?.[section] ?? []).filter((item) => chief || item.status === "rejected").length;
  const noticesWaiting = (data.notices ?? []).filter((item) => !item.published && item.sourceUrl).length;
  const groups = [
    {
      name: "",
      links: [
        ["prehled", "Přehled", "home"],
        userCan(data.user, "vzkazy") && ["vzkazy", "Vzkazy", "inbox", data.newMessages],
        (chief || userCan(data.user, "statistiky")) && ["statistiky", "Statistiky", "chart"],
      ],
    },
    {
      name: "Obsah",
      links: [
        ["zpravy", "Zprávy", "news", chief ? waiting : returned],
        chief && ["rubriky", "Rubriky", "folder"],
        chief && ["akce", "Akce", "calendar"],
        (chief || userCan(data.user, "obrazky")) && ["obrazky", "Knihovna obrázků", "image"],
        ["reklamy", "Reklamy", "megaphone", chief ? adWaiting : adReturned],
      ],
    },
    {
      name: "Importy",
      links: [
        chief && ["munipolis", "Munipolis", "inbox", importFailed],
        chief && ["fotbal", "Fotbal", "ball", footballFailed],
        chief && ["denik", "Deník", "paper", denikFailed],
        ...SCHOOL_LIST.map((source) => chief && [source.tag, source.page, source.icon, schoolFailed(source.tag)]),
        chief && ["okoli", "Akce v okolí", "pin"],
      ],
    },
    {
      name: "Služby",
      links: [
        chief && ["svoz", "Popelnice", "bin"],
        canSeeHours(data.user, "dvory") && ["dvory", "Sběrné dvory", "recycle", hoursWaiting("dvory")],
        canSeeHours(data.user, "lekari") && ["lekari", "Lékaři", "cross", hoursWaiting("lekari")],
        canSeeHours(data.user, "oteviraci-doba") && ["oteviraci-doba", "Otevírací doba", "clock", hoursWaiting("oteviraci-doba")],
        chief && ["emaily", "E-mail na hodiny", "inbox", (data.mailRequests ?? []).length + (data.mailUnresolved ?? []).length],
        chief && ["odstavky", "Odstávky", "bolt", noticesWaiting],
      ],
    },
    {
      name: "Drběna",
      links: [chief && ["drbena", "Koza Drběna", "pen"], chief && ["chat", "Chat s Drběnou", "chat"]],
    },
    {
      name: "Správa",
      links: [
        chief && ["lide", "Lidé", "users"],
        chief && ["odber", "Odběr a data", "rss"],
        chief && ["texty", "Texty webu", "text"],
        chief && ["stav", "Stav drbny", "pulse", problemCount(data.healthRows ?? [])],
        chief && ["historie", "Historie změn", "clock"],
        ["ucet", "Můj účet", "user"],
      ],
    },
  ];
  return groups
    .map((group) => ({ ...group, links: group.links.filter(Boolean) }))
    .filter((group) => group.links.length);
}

const countBadge = (count) => (count ? `<b class="adm-count" aria-label="${count} čeká">${count}</b>` : "");

// Skupiny jsou <details>: na mobilu se rozbalují, otevřená je ta s aktuální stránkou; na počítači jsou vidět vždy (admin.css).
function navHtml(groups, tab) {
  return groups
    .map((group) => {
      const links = group.links
        .map(([id, label, glyph, count]) => {
          const on = id === tab;
          return `<a class="adm-link${on ? " is-on" : ""}" href="/redakce/${id}"${on ? ' aria-current="page"' : ""}>${icon(glyph)}<span>${esc(label)}</span>${countBadge(count)}</a>`;
        })
        .join("");
      if (!group.name) return `<div class="adm-group">${links}</div>`;
      const open = group.links.some(([id]) => id === tab);
      const waiting = group.links.reduce((sum, link) => sum + (link[3] || 0), 0);
      return `<details class="adm-group"${open ? " open" : ""}><summary class="adm-group-name"><span>${esc(group.name)}</span>${countBadge(waiting)}</summary>${links}</details>`;
    })
    .join("");
}

// Na mobilu je menu schované za tlačítkem s názvem aktuální stránky (zaškrtávátko, funguje i bez JS).
function menuButton(groups, tab) {
  const links = groups.flatMap((group) => group.links);
  const current = links.find(([id]) => id === tab)?.[1] ?? "Menu";
  const waiting = links.reduce((sum, link) => sum + (link[3] || 0), 0);
  return `<input class="adm-menu-check" type="checkbox" id="adm-menu" aria-label="Menu redakce">
    <label class="adm-menu-btn adm-only-mobile" for="adm-menu" aria-hidden="true">${icon("menu")}<span>${esc(current)}</span>${countBadge(waiting)}</label>`;
}

export const ADMIN_TABS = ["prehled", "vzkazy", "statistiky", "zpravy", "rubriky", "akce", "munipolis", "fotbal", "denik", ...SCHOOL_LIST.map((source) => source.tag), "okoli", "obrazky", "reklamy", "svoz", "dvory", "lekari", "oteviraci-doba", "emaily", "odstavky", "drbena", "chat", "odber", "texty", "lide", "historie", "ucet"];

export function toastHtml(flash) {
  if (!flash.text) return "";
  return `<div class="toast toast-${flash.kind}" role="${flash.kind === "bad" ? "alert" : "status"}" data-toast>
    ${icon(flash.kind === "bad" ? "x" : "check")}<span>${esc(flash.text)}</span>
    <button type="button" class="toast-x" data-toast-close aria-label="Zavřít">${icon("x")}</button>
  </div>`;
}

export function adminShell(ctx, data, tab, message, inner, options = {}) {
  const flash = flashOf(message);
  if (!data.signedIn) return loginPage(ctx, data, flash);
  const chief = data.user?.role === "hlavni";
  const who = chief ? "hlavní redaktor" : "přispěvatel";
  const name = data.user?.name ?? "";
  const initial = (byline(data.user) || name || "R").trim().charAt(0).toUpperCase();
  const home = ctx.mainOrigin || "/";
  const groups = nav(data);
  return adminDocument({
    title: `${options.title ? `${options.title} · ` : ""}Redakce | Kopidlenská drbna`,
    rich: Boolean(options.rich),
    body: `<a class="skip" href="#obsah">Přeskočit na obsah</a>
<div class="adm-app">
  <aside class="adm-side">
    <div class="adm-side-top">
      <a class="adm-brand" href="/redakce/prehled"><img src="/kozel-maskot.webp" alt=""><span><strong>Drbna</strong><small>Redakce</small></span></a>
      <a class="adm-icon-btn adm-only-mobile" href="${esc(home)}" target="_blank" rel="noopener" title="Otevřít web">${icon("external")}</a>
      <form class="adm-only-mobile" method="post" action="/redakce/odhlasit"><button class="adm-icon-btn" type="submit" title="Odhlásit">${icon("logout")}</button></form>
    </div>
    ${menuButton(groups, tab)}
    <nav class="adm-nav" aria-label="Redakce">${navHtml(groups, tab)}</nav>
    <div class="adm-me">
      <span class="adm-avatar" aria-hidden="true">${esc(initial)}</span>
      <span class="adm-me-text"><strong>${esc(name)}</strong><small>${who}</small></span>
    </div>
    <div class="adm-side-actions">
      <a class="adm-side-link" href="${esc(home)}" target="_blank" rel="noopener">${icon("external")}<span>Otevřít web</span></a>
      <form method="post" action="/redakce/odhlasit"><button class="adm-side-link" type="submit">${icon("logout")}<span>Odhlásit</span></button></form>
    </div>
  </aside>
  <main class="adm-main" id="obsah">
    ${inner}
  </main>
</div>
<div class="toasts" aria-live="polite">${toastHtml(flash)}</div>`,
  });
}
