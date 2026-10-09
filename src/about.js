// Stránka O nás: poslání, provozovatel a pozvání k účasti. Texty jsou HTML z Textů webu (čistí je renderArticleHtml).
import { text as tx } from "./copy.js";
import { esc } from "./html.js";
import { renderArticleHtml } from "./rich.js";
import { layout } from "./view.js";

// Prázdný řádek dělí odstavce, jednoduchý konec řádku zůstane uvnitř odstavce.
export function paragraphs(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function card(className, title, html) {
  return `<section class="about-card ${className}">
            <h2>${esc(title)}</h2>
            <div class="about-rich">${renderArticleHtml(html)}</div>
          </section>`;
}

export function aboutPage(data, ctx) {
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "nav_about")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "about_description"),
    body: `
      <section class="about">
        <div class="about-hero">
          <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "about_alt"))}">
          <div class="about-intro">
            <p class="eyebrow">${esc(tx(ctx.copy, "about_eyebrow"))}</p>
            <h1>${esc(tx(ctx.copy, "about_heading"))}</h1>
            <div class="about-rich about-mission">${renderArticleHtml(tx(ctx.copy, "about_body"))}</div>
          </div>
        </div>
        <div class="about-cards">
          ${card("about-operator", tx(ctx.copy, "about_operator_title"), tx(ctx.copy, "about_operator"))}
          ${card("about-join", tx(ctx.copy, "about_join_title"), tx(ctx.copy, "about_join"))}
        </div>
        <p class="about-deletion"><a href="/smazani-dat">${esc(tx(ctx.copy, "about_deletion"))}</a></p>
      </section>`,
  });
}
