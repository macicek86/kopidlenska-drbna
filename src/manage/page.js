// Stránka odkazu pro správce (`/sprava/<token>`): jak je místo teď na drbně, zapsané změny, tlačítka na formuláře
// a co čeká na schválení. Okna mají vlastní adresu (`?okno=klíč`, `?zrusit=ID`) jako v redakci, takže jdou i bez JS.
import { REQUEST_SECTIONS } from "../hours-requests-db.js";
import { linkPath } from "../hours-links-db.js";
import { describeRequest } from "../admin/hours-requests.js";
import { adminDocument } from "../admin/document.js";
import { toastHtml } from "../admin/shell.js";
import { badge, callout, cancelLink, field, hidden, input, item, list, modal, modalLink, panel, postButton } from "../admin/ui.js";
import { esc, flashOf } from "../view.js";
import { MANAGE_SECTIONS } from "./sections.js";

// Řádky z přehledu žádostí potřebují data ve tvaru redakce (`describeRequest`).
const ROW_KEYS = { dvory: "yards", lekari: "doctors", "oteviraci-doba": "places" };

function authorField(name) {
  return field(
    "Kdo to zapisuje",
    `<input class="${input}" name="author" required maxlength="80" autocomplete="name" value="${esc(name)}" placeholder="Jméno a příjmení">`,
    "Uvidíme to jen my.",
  );
}

function factsPanel(spec, row) {
  const rows = spec
    .facts(row)
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="manage-fact"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join("");
  return panel({
    id: "ted",
    title: "Teď na drbně",
    tools: `<a class="btn btn-ghost btn-sm" href="${esc(spec.page)}" target="_blank" rel="noopener">Otevřít web</a>`,
    body: `<dl class="manage-facts">${rows}</dl>`,
  });
}

function changesPanel(spec, row, base) {
  const changes = spec.changes(row);
  if (!changes.length) return "";
  const body = `<ul class="chips-list">${changes
    .map(
      (change) => `<li class="chip-row">
        <span class="chip-when">${esc(change.when)}</span>
        <span class="chip-what">${esc(change.what)}</span>
        ${change.cancel ? modalLink(`${base}?zrusit=${change.id}`, "Zrušit", "btn-ghost btn-danger-text") : ""}
      </li>`,
    )
    .join("")}</ul>`;
  return panel({ id: "zmeny", title: "Zapsané změny", count: changes.length, body });
}

function actionsPanel(spec, base) {
  const buttons = spec.forms
    .map((form) => modalLink(`${base}?okno=${form.key}`, esc(form.label), form.primary ? "btn-primary" : "btn-line"))
    .join("");
  return panel({ id: "zapsat", title: "Co chcete zapsat", body: `<div class="manage-actions">${buttons}</div>` });
}

function requestsPanel(link, row, requests, base) {
  if (!requests.length) return "";
  const data = { [ROW_KEYS[link.section]]: [row] };
  const rows = requests.map((request) => {
    const { text } = describeRequest(link.section, request, data);
    const rejected = request.status === "rejected";
    return item({
      title: text,
      meta: request.author ? `zapsal(a) ${esc(request.author)}` : "",
      badges: `${rejected ? badge("Neschváleno", "bad") : badge("Čeká na schválení", "warn")}${rejected && request.reply ? `<span class="item-sub">${esc(request.reply)}</span>` : ""}`,
      actions: postButton(`${base}/stahnout`, { zadost: request.id }, rejected ? "Smazat" : "Vzít zpět", "btn-ghost btn-danger-text"),
    });
  });
  return panel({ id: "navrhy", title: "Poslané ke kontrole", count: rows.length, body: list(rows, ""), tone: "warn" });
}

function dialogFor(spec, link, row, base, query, author, mail) {
  const form = spec.forms.find((entry) => entry.key === query.window);
  const submit = link.direct ? "Zapsat" : "Poslat ke kontrole";
  if (form) {
    return modal({
      id: "okno",
      title: form.title,
      size: form.wide ? "wide" : "",
      close: base,
      open: true,
      body: form.render(row, {
        action: `${base}/${form.action}`,
        extra: `${mail ? callout(`Z e-mailu nám vyšlo: ${esc(mail.line)}. Upravte, co je potřeba, a uložte.`) : ""}${authorField(author)}`,
        value: mail?.value,
        submit,
        cancel: base,
      }),
    });
  }
  const change = query.cancelId ? spec.changes(row).find((entry) => entry.id === query.cancelId && entry.cancel) : null;
  if (!change) return "";
  return modal({
    id: "okno",
    title: "Zrušit změnu",
    close: base,
    open: true,
    body: `<form class="form confirm" method="post" action="${base}/zrusit">
      <p class="confirm-text">Zrušit ${esc(change.when)}: ${esc(change.what)}?${link.direct ? "" : " Zruší se, až to potvrdíme."}</p>
      ${hidden("id", change.id)}
      ${authorField(author)}
      <div class="form-foot">${cancelLink(base, "Nechat")}<span class="form-foot-gap"></span><button class="btn btn-danger" type="submit">${link.direct ? "Opravdu zrušit" : "Poslat ke kontrole"}</button></div>
    </form>`,
  });
}

export function managePage({ link, row, requests, query, mail, message, author }) {
  const spec = MANAGE_SECTIONS[link.section];
  const base = linkPath(link.token);
  const flash = flashOf(message);
  const how = link.direct
    ? "Co tu zapíšete, je na drbně hned."
    : "Co tu zapíšete, dáme ke kontrole. Na web to půjde, jakmile to potvrdíme, většinou ještě týž den.";
  return adminDocument({
    title: `${row.name} | Kopidlenská drbna`,
    bodyClass: "adm adm-manage",
    body: `<main class="manage" id="obsah">
      <a class="login-brand manage-brand" href="/"><img src="/kozel-maskot.webp" alt=""><span>Kopidlenská <b>drbna</b></span></a>
      <header class="manage-head">
        <p class="manage-kicker">${esc(REQUEST_SECTIONS[link.section].label)}</p>
        <h1>${esc(row.name)}</h1>
        <p class="adm-lede">Tady zapíšete změny, které drbna ukazuje lidem z Kopidlna. ${how}</p>
      </header>
      ${callout("Tenhle odkaz je jen pro vás a funguje bez hesla. Nikomu cizímu ho neposílejte. Název nebo smazání místa vyřídíme my, napište nám.")}
      ${actionsPanel(spec, base)}
      ${requestsPanel(link, row, requests, base)}
      ${changesPanel(spec, row, base)}
      ${factsPanel(spec, row)}
      ${dialogFor(spec, link, row, base, query, author, mail)}
    </main>
    <div class="toasts" aria-live="polite">${toastHtml(flash)}</div>`,
  });
}

// Odkaz, který neexistuje nebo ho redakce zrušila.
export function deadLinkPage() {
  return adminDocument({
    title: "Odkaz neplatí | Kopidlenská drbna",
    bodyClass: "adm adm-login",
    body: `<main class="login-box" id="obsah">
      <a class="login-brand" href="/"><img src="/kozel-maskot.webp" alt=""><span>Kopidlenská <b>drbna</b></span></a>
      <div class="login-card form">
        <h1>Odkaz neplatí</h1>
        <p class="adm-lede">Tenhle odkaz jsme zrušili, nebo v něm chybí kus. Napište nám a pošleme vám nový.</p>
      </div>
      <a class="login-back" href="/">← Zpět na web</a>
    </main>`,
  });
}

// Jednorázový odkaz z e-mailu po uložené změně: odkaz už zanikl, tak se ukáže jen potvrzení.
export function doneLinkPage(requested) {
  return adminDocument({
    title: "Hotovo | Kopidlenská drbna",
    bodyClass: "adm adm-login",
    body: `<main class="login-box" id="obsah">
      <a class="login-brand" href="/"><img src="/kozel-maskot.webp" alt=""><span>Kopidlenská <b>drbna</b></span></a>
      <div class="login-card form">
        <h1>Hotovo</h1>
        <p class="adm-lede">${requested ? "Změnu jsme přijali, na web půjde po naší kontrole." : "Změna je na webu."} Tenhle odkaz byl jednorázový, už neplatí. Až budete chtít něco změnit příště, stačí napsat e-mail.</p>
      </div>
      <a class="login-back" href="/">← Zpět na web</a>
    </main>`,
  });
}
