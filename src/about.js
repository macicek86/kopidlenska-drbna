// Stránka O nás: volný text z Textů webu, kontakt na redakci a rozcestník.
import { text as tx } from "./copy.js";
import { esc } from "./html.js";
import { layout } from "./view.js";

// Prázdný řádek dělí odstavce, jednoduchý konec řádku zůstane uvnitř odstavce.
export function paragraphs(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function aboutPage(data, ctx) {
  const [lede = "", ...rest] = paragraphs(tx(ctx.copy, "about_body"));
  const text = [
    lede && `<p class="lede">${esc(lede)}</p>`,
    ...rest.map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`),
    data.contactNote && `<p class="about-contact">${esc(data.contactNote)}</p>`,
  ]
    .filter(Boolean)
    .join("\n          ");
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "nav_about")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "about_description"),
    body: `
      <section class="about">
        <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "about_alt"))}">
        <div class="about-text">
          <p class="eyebrow">${esc(tx(ctx.copy, "about_eyebrow"))}</p>
          <h1>${esc(tx(ctx.copy, "about_heading"))}</h1>
          ${text}
          <div class="row links">
            <a href="/popelnice">${esc(tx(ctx.copy, "about_bins_link"))}</a>
            <a href="/sberne-dvory">${esc(tx(ctx.copy, "about_yards_link"))}</a>
            <a href="/lekari">${esc(tx(ctx.copy, "about_doctors_link"))}</a>
            <a href="/oteviraci-doba">${esc(tx(ctx.copy, "about_places_link"))}</a>
            <a href="/odstavky">${esc(tx(ctx.copy, "about_outages_link"))}</a>
            <a href="/reklamy">${esc(tx(ctx.copy, "about_ads_link"))}</a>
          </div>
        </div>
      </section>`,
  });
}
