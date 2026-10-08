// Upozornění na webu: zvoneček v hlavičce a jednorázová nabídka dole na stránce.
// Ukazují se jen se zapnutými upozorněními (redakce i klíče VAPID). Co prohlížeč umí a jestli už odebírá,
// řeší public/push-bell.js: zvoneček schová, kde upozornění nejdou, a vyplní ho, když jsou zapnutá.
import { text as tx } from "../copy.js";
import { esc } from "../html.js";
import { PUSH_PAGE } from "./routes.js";

const BELL_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Z"/><path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0"/></svg>`;

// Je co nabízet? `push` je { enabled, topics } z redakce, null mimo veřejný web.
export function pushOffered(push) {
  return Boolean(push?.enabled);
}

export function pushBell(copy, path) {
  const label = tx(copy, "push_bell");
  const on = path === PUSH_PAGE ? " is-current" : "";
  return `<a class="push-bell${on}" href="${PUSH_PAGE}" title="${esc(label)}" aria-label="${esc(label)}" data-push-bell>${BELL_ICON}</a>`;
}

// Na počítači okénko vlevo dole, na mobilu bublina, kterou říká Drběna z tlačítka chatu vpravo dole
// (bez chatu stojí Drběna pod bublinou sama, public/push-bell.js přidá `with-goat`).
// V <template>, ať ji vyhledávače neberou jako text stránky.
export function pushOffer(copy) {
  return `<template data-push-offer>
    <aside class="push-offer" aria-label="${esc(tx(copy, "push_bell"))}">
      <span class="push-offer-icon">${BELL_ICON}</span>
      <p>${esc(tx(copy, "push_offer_text"))}</p>
      <div class="push-offer-actions">
        <a class="btn btn-primary" href="${PUSH_PAGE}" data-push-offer-yes>${esc(tx(copy, "push_offer_yes"))}</a>
        <button class="btn btn-line" type="button" data-push-offer-no>${esc(tx(copy, "push_offer_no"))}</button>
      </div>
      <img class="push-offer-goat" src="/drbena-chat.webp" alt="">
    </aside>
  </template>`;
}
