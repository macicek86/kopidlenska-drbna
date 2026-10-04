// Přihlašovací stránky redakce: e-mail, kód z e-mailu a odkaz z e-mailu (src/login.js).
import { esc } from "../view.js";
import { adminDocument } from "./document.js";
import { field, input } from "./ui.js";

const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function page(body, scripts = "") {
  return adminDocument({
    title: "Redakce | Kopidlenská drbna",
    bodyClass: "adm adm-login",
    scripts,
    body: `<main class="login-box" id="obsah">
      <a class="login-brand" href="/"><img src="/kozel-maskot.webp" alt=""><span>Kopidlenská <b>drbna</b></span></a>
      ${body}
      <a class="login-back" href="/">← Zpět na web</a>
    </main>`,
  });
}

function errorBox(flash) {
  return flash.text ? `<div class="callout callout-${flash.kind === "bad" ? "bad" : "info"}" role="alert">${esc(flash.text)}</div>` : "";
}

function emailForm(next, login, flash) {
  const setup = login.setupNeeded
    ? `<div class="callout callout-warn">Zatím žádný účet nemá e-mail, takže se nikdo nepřihlásí. Hlavnímu redaktorovi ho nastavte v databázi:
        <code>npx wrangler d1 execute kopidlenska-drbna --remote --command "update users set email = 'vas@email.cz' where role = 'hlavni'"</code></div>`
    : "";
  const widget = login.siteKey
    ? `<div class="cf-turnstile login-turnstile" data-sitekey="${esc(login.siteKey)}" data-language="cs" data-appearance="interaction-only" data-size="flexible"></div>`
    : "";
  return `<form class="login-card form" method="post" action="/redakce/prihlasit">
    <h1>Redakce</h1>
    <p class="adm-lede">Zadejte e-mail, se kterým vás redakce zná. Pošleme na něj kód pro přihlášení.</p>
    ${setup}
    ${errorBox(flash)}
    <input type="hidden" name="next" value="${esc(next)}">
    ${field("E-mail", `<input class="${input}" type="email" name="email" autocomplete="email" autocapitalize="none" inputmode="email" required autofocus>`)}
    ${widget}
    <button class="btn btn-primary btn-block" type="submit" data-busy="Posílám…">Poslat kód</button>
  </form>`;
}

function codeForm(next, login, flash) {
  const echo = login.echo
    ? `<div class="callout callout-info">Místní náhled, e-mail nikam nejde. Kód je <b data-login-code>${esc(login.echo)}</b>.</div>`
    : "";
  return `<form class="login-card form" method="post" action="/redakce/overit">
    <h1>Zadejte kód</h1>
    <p class="adm-lede">Pokud <b>${esc(login.pending.email)}</b> patří do redakce, právě na něj přišel šestimístný kód. Platí 10 minut. Když nepřišel, mrkněte i do spamu.</p>
    ${echo}
    ${errorBox(flash)}
    <input type="hidden" name="next" value="${esc(next)}">
    ${field("Kód z e-mailu", `<input class="${input} login-code" name="kod" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus>`)}
    <button class="btn btn-primary btn-block" type="submit" data-busy="Ověřuji…">Přihlásit</button>
    <a class="btn btn-ghost btn-block" href="/redakce/jiny-email">Poslat nový kód nebo zadat jiný e-mail</a>
  </form>`;
}

// Přihlašovací stránka místo redakce. `ctx.path` je stránka, kam se po přihlášení vrátit.
export function loginPage(ctx, data, flash) {
  const login = data.login ?? {};
  const next = ctx.path ?? "/redakce/prehled";
  if (login.pending) return page(codeForm(next, login, flash));
  const scripts = login.siteKey ? `<script src="${TURNSTILE}" async defer></script>` : "";
  return page(emailForm(next, login, flash), scripts);
}

// Odkaz z e-mailu: tlačítko, ne přihlášení rovnou, ať odkaz nespotřebuje kontrola odkazů v poště.
export function linkPage({ token, live }) {
  if (!live) {
    return page(`<div class="login-card form">
      <h1>Odkaz už neplatí</h1>
      <p class="adm-lede">Odkaz z e-mailu platí 10 minut a jen jednou. Nechte si poslat nový kód.</p>
      <a class="btn btn-primary btn-block" href="/redakce/prehled">Přihlásit se</a>
    </div>`);
  }
  return page(`<form class="login-card form" method="post" action="/redakce/vstup">
    <h1>Redakce</h1>
    <p class="adm-lede">Přihlásit se do redakce v tomhle prohlížeči?</p>
    <input type="hidden" name="token" value="${esc(token)}">
    <button class="btn btn-primary btn-block" type="submit" data-busy="Přihlašuji…">Přihlásit</button>
  </form>`);
}
