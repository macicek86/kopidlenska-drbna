import { byline, userCan } from "../db.js";
import { esc, flashOf } from "../view.js";
import { field, icon, input } from "./ui.js";

function nav(data) {
  const chief = data.user?.role === "hlavni";
  const waiting = (data.proposals ?? []).filter((item) => item.status === "pending").length;
  const adWaiting = (data.adProposals ?? []).filter((item) => item.status === "pending").length;
  const returned = chief ? 0 : (data.proposals ?? []).filter((item) => item.status === "rejected").length;
  const adReturned = chief ? 0 : (data.adProposals ?? []).filter((item) => item.status === "rejected").length;
  const importFailed = (data.importItems ?? []).filter((item) => item.status === "chyba").length;
  const footballFailed = (data.footballItems ?? []).filter((item) => item.status === "chyba").length;
  const denikFailed = (data.denikItems ?? []).filter((item) => item.status === "chyba").length;
  const noticesWaiting = (data.notices ?? []).filter((item) => !item.published && item.sourceUrl).length;
  const groups = [
    {
      name: "",
      links: [["prehled", "Přehled", "home"]],
    },
    {
      name: "Obsah",
      links: [
        ["zpravy", "Zprávy", "news", chief ? waiting : returned],
        chief && ["rubriky", "Rubriky", "folder"],
        chief && ["akce", "Akce", "calendar"],
        chief && ["munipolis", "Munipolis", "inbox", importFailed],
        chief && ["fotbal", "Fotbal", "ball", footballFailed],
        chief && ["denik", "Deník", "paper", denikFailed],
        ["reklamy", "Reklamy", "megaphone", chief ? adWaiting : adReturned],
      ],
    },
    {
      name: "Služby",
      links: [
        chief && ["svoz", "Popelnice", "bin"],
        (chief || userCan(data.user, "sberny_dvur")) && ["dvory", "Sběrné dvory", "recycle"],
        (chief || userCan(data.user, "doktori")) && ["lekari", "Lékaři", "cross"],
        chief && ["odstavky", "Odstávky", "bolt", noticesWaiting],
      ],
    },
    {
      name: "Nastavení",
      links: [chief && ["drbena", "Koza Drběna", "pen"], chief && ["texty", "Texty webu", "text"], chief && ["lide", "Lidé", "users"], ["heslo", "Můj účet", "user"]],
    },
  ];
  return groups
    .map((group) => ({ ...group, links: group.links.filter(Boolean) }))
    .filter((group) => group.links.length);
}

function navHtml(data, tab) {
  return nav(data)
    .map((group) => {
      const links = group.links
        .map(([id, label, glyph, count]) => {
          const on = id === tab;
          return `<a class="adm-link${on ? " is-on" : ""}" href="/redakce/${id}"${on ? ' aria-current="page"' : ""}>${icon(glyph)}<span>${esc(label)}</span>${
            count ? `<b class="adm-count" aria-label="${count} čeká">${count}</b>` : ""
          }</a>`;
        })
        .join("");
      return `<div class="adm-group">${group.name ? `<p class="adm-group-name">${esc(group.name)}</p>` : ""}${links}</div>`;
    })
    .join("");
}

export const ADMIN_TABS = ["prehled", "zpravy", "rubriky", "akce", "munipolis", "fotbal", "denik", "reklamy", "svoz", "dvory", "lekari", "odstavky", "drbena", "texty", "lide", "heslo"];

function toastHtml(flash) {
  if (!flash.text) return "";
  return `<div class="toast toast-${flash.kind}" role="${flash.kind === "bad" ? "alert" : "status"}" data-toast>
    ${icon(flash.kind === "bad" ? "x" : "check")}<span>${esc(flash.text)}</span>
    <button type="button" class="toast-x" data-toast-close aria-label="Zavřít">${icon("x")}</button>
  </div>`;
}

function document({ title, body, rich = false, bodyClass = "adm" }) {
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
  ${rich ? `<link rel="stylesheet" href="/vendor/trix/trix.css">` : ""}
  <link rel="stylesheet" href="/admin.css">
  <link rel="stylesheet" href="/photo-pick.css">
</head>
<body class="${bodyClass}">
${body}
${rich ? `<script src="/vendor/trix/trix.umd.min.js" defer></script>` : ""}
<script src="/editor.js" defer></script>
<script src="/photo-pick.js" defer></script>
<script src="/admin.js" defer></script>
</body>
</html>`;
}

function loginPage(data, flash) {
  return document({
    title: "Redakce | Kopidlenská drbna",
    bodyClass: "adm adm-login",
    body: `<main class="login-box" id="obsah">
      <a class="login-brand" href="/"><img src="/kozel-maskot.webp" alt=""><span>Kopidlenská <b>drbna</b></span></a>
      <form class="login-card form" method="post" action="/redakce/prihlasit">
        <h1>Redakce</h1>
        <p class="adm-lede">Přihlášení pro hlavního redaktora a přispěvatele.</p>
        ${
          data.showDefaultPassword
            ? `<div class="callout callout-warn">Výchozí přihlášení je jméno <b>redakce</b> a heslo <b>Drbna2026</b>. Po vstupu si ho změňte.</div>`
            : ""
        }
        ${flash.text ? `<div class="callout callout-bad" role="alert">${esc(flash.text)}</div>` : ""}
        ${field("Přihlašovací jméno", `<input class="${input}" name="login" autocomplete="username" autocapitalize="none" required autofocus>`)}
        ${field("Heslo", `<input class="${input}" type="password" name="password" autocomplete="current-password" required>`)}
        <button class="btn btn-primary btn-block" type="submit">Přihlásit</button>
      </form>
      <a class="login-back" href="/">← Zpět na web</a>
    </main>`,
  });
}

export function adminShell(ctx, data, tab, message, inner, options = {}) {
  const flash = flashOf(message);
  if (!data.signedIn) return loginPage(data, flash);
  const chief = data.user?.role === "hlavni";
  const who = chief ? "hlavní redaktor" : "přispěvatel";
  const name = data.user?.name ?? "";
  const initial = (byline(data.user) || name || "R").trim().charAt(0).toUpperCase();
  const home = ctx.mainOrigin || "/";
  const warn =
    chief && data.showDefaultPassword
      ? `<div class="callout callout-warn">Pořád platí výchozí heslo. <a href="/redakce/heslo">Nastavte si vlastní</a>.</div>`
      : "";
  return document({
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
    <nav class="adm-nav" aria-label="Redakce">${navHtml(data, tab)}</nav>
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
    ${warn}
    ${inner}
  </main>
</div>
<div class="toasts" aria-live="polite">${toastHtml(flash)}</div>`,
  });
}
