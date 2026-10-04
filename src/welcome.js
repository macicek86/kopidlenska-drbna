// Uvítací okno s Drběnou: ukáže se jednou, při první návštěvě webu (public/welcome.js, styly public/welcome.css).
// Je v <template>, ať jeho text vyhledávače neberou jako obsah každé stránky a obrázek se stáhne, až když je potřeba.
import { text as tx, WELCOME_VERSION } from "./copy.js";
import { esc } from "./html.js";
import { escTie } from "./typo.js";

// Prázdný řádek dělí odstavce (stejně jako na stránce O nás).
function paragraphs(value) {
  return String(value).replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}

// Odstavec, jehož všechny řádky začínají pomlčkou, je výčet.
function block(part) {
  const lines = part.split("\n").map((line) => line.trim());
  if (lines.every((line) => /^[-•]\s*/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${escTie(line.replace(/^[-•]\s*/, ""))}</li>`).join("")}</ul>`;
  }
  return `<p>${lines.map(escTie).join("<br>")}</p>`;
}

export function welcomeTemplate(copy, chat) {
  const body = tx(copy, "welcome_body").trim();
  if (body === "-") return "";
  return `<template data-welcome="${esc(copy?.[WELCOME_VERSION] || "1")}">
    <dialog class="welcome" aria-labelledby="uvitani-nadpis" tabindex="-1">
      <div class="welcome-box">
        <div class="welcome-side"><img src="/drbena-uvitani.webp" width="459" height="640" alt="${esc(tx(copy, "welcome_alt"))}"></div>
        <div class="welcome-text">
          <h2 id="uvitani-nadpis">${escTie(tx(copy, "welcome_heading"))}</h2>
          ${paragraphs(body).map(block).join("\n          ")}
          ${chat ? `<p>${escTie(tx(copy, "welcome_chat"))}</p>` : ""}
          <p class="welcome-team">${escTie(tx(copy, "welcome_team"))} <a href="/o-nas">${esc(tx(copy, "welcome_team_link"))}</a></p>
          <p class="welcome-beta">${escTie(tx(copy, "welcome_beta"))}</p>
          <div class="welcome-actions">
            <button type="button" class="btn btn-primary" data-welcome-close>${esc(tx(copy, "welcome_ok"))}</button>
            ${chat ? `<button type="button" class="btn btn-line" data-welcome-close data-chat-open="">${esc(tx(copy, "welcome_ask"))}</button>` : ""}
          </div>
        </div>
        <button type="button" class="welcome-x" data-welcome-close aria-label="Zavřít">×</button>
      </div>
    </dialog>
  </template>`;
}
