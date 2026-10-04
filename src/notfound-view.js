import { esc } from "./html.js";
import { text as tx } from "./copy.js";
import { adPanel, askLine, layout } from "./view.js";

// Rozcestník: kam lidé chodí nejčastěji.
const LINKS = [
  ["/zpravy", "nav_news"],
  ["/akce", "nav_events"],
  ["/popelnice", "nav_bins"],
  ["/odstavky", "nav_outages"],
  ["/oteviraci-doba", "nav_places"],
  ["/lekari", "nav_doctors"],
  ["/sberne-dvory", "nav_yards"],
];

// Stránka 404. heading: jiný nadpis (chybějící zpráva), ad: reklama pod rozcestníkem.
export function notFoundPage(ctx, { heading, ad } = {}) {
  const title = heading || tx(ctx.copy, "notfound_heading");
  const home = ctx.minimal ? ctx.mainOrigin || "/" : "/";
  const links = ctx.minimal
    ? ""
    : `<section class="card notfound-more">
        <h2>${esc(tx(ctx.copy, "notfound_more"))}</h2>
        <ul class="notfound-links">${LINKS.map(([href, key]) => `<li><a href="${href}">${esc(tx(ctx.copy, key))}</a></li>`).join("")}</ul>
        ${askLine(ctx, "notfound", "Hledám na drbně: ")}
      </section>`;
  return layout({
    ...ctx,
    noindex: true,
    title: `${tx(ctx.copy, "notfound_title")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "notfound_text"),
    body: `
      <section class="card notfound-hero">
        <div class="notfound-copy">
          <p class="pill">${esc(tx(ctx.copy, "notfound_pill"))}</p>
          <h1>${esc(title)}</h1>
          <p class="notfound-text">${esc(tx(ctx.copy, "notfound_text"))}</p>
          <a class="btn btn-primary" href="${esc(home)}">${esc(tx(ctx.copy, "notfound_home"))}</a>
        </div>
        <div class="notfound-drbena">
          <img src="/drbena-404.webp" width="640" height="630" alt="${esc(tx(ctx.copy, "notfound_alt"))}">
        </div>
      </section>
      ${links}
      ${ad && !ctx.minimal ? `<div class="ad-slot">${adPanel(ad, ctx.copy)}</div>` : ""}`,
  });
}
