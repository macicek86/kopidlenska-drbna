// Rubriky na webu: pás hlavních rubrik, podblok s podrubrikami, drobečky a štítek nad zprávou.
import { text as tx } from "./copy.js";
import { esc } from "./html.js";
import { articleInRubric, rubricScope } from "./rubrics.js";

export function rubricHref(slug) {
  return slug ? `/zpravy?rubrika=${encodeURIComponent(slug)}` : "/zpravy";
}

export function newsCount(n) {
  if (n === 1) return "1 zpráva";
  if (n >= 2 && n <= 4) return `${n} zprávy`;
  return `${n} zpráv`;
}

export function rubricCounts(rubrics, articles) {
  return new Map(
    rubrics.map((item) => [item.id, articles.filter((article) => articleInRubric(article, item, rubrics)).length]),
  );
}

// Štítek nad zprávou: „Sport › Fotbal“, nadřazená rubrika tlumeně.
export function rubricKicker(article) {
  const name = String(article?.category ?? "");
  const parent = String(article?.parentName ?? "").trim();
  if (parent && name && parent !== name) {
    return `<p class="kicker"><span class="kicker-up">${esc(parent)}</span><span class="crumb-sep" aria-hidden="true"></span>${esc(name)}</p>`;
  }
  return `<p class="kicker">${esc(name)}</p>`;
}

// Drobečky nad nadpisem zprávy, každý díl vede na svou rubriku.
export function articleCrumbs(article) {
  const name = String(article?.category ?? "");
  const parent = String(article?.parentName ?? "").trim();
  const parts = [];
  if (parent && parent !== name) parts.push(crumb(parent, article.parentSlug));
  if (name) parts.push(crumb(name, article.rubricSlug));
  if (!parts.length) return "";
  return `<nav class="crumbs" aria-label="Rubrika">${parts.join(`<span class="crumb-sep" aria-hidden="true"></span>`)}</nav>`;
}

function crumb(label, slug) {
  return slug ? `<a href="${rubricHref(slug)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
}

// Drobečky nad nadpisem stránky zpráv: Zprávy › Sport (poslední díl je nadpis).
export function newsCrumbs(rubrics, selected, copy) {
  if (!selected) return `<p class="eyebrow">${esc(tx(copy, "news_eyebrow"))}</p>`;
  const parts = [`<a href="/zpravy">${esc(tx(copy, "news_heading"))}</a>`];
  const scope = rubricScope(rubrics, selected);
  if (selected.parentId && scope) parts.push(`<a href="${rubricHref(scope.slug)}">${esc(scope.name)}</a>`);
  return `<nav class="crumbs" aria-label="Kde jste">${parts.join(`<span class="crumb-sep" aria-hidden="true"></span>`)}</nav>`;
}

function current(on) {
  return on ? ` aria-current="page"` : "";
}

// Hlavní rubriky v jednom pásu. Prázdné rubriky schováme, pokud zrovna nejsou vybrané.
export function rubricNav(rubrics, selected, counts, copy) {
  const scope = rubricScope(rubrics, selected);
  const hasKids = (item) => rubrics.some((child) => child.parentId === item.id && counts.get(child.id));
  const tops = rubrics.filter((item) => !item.parentId && (counts.get(item.id) || item.id === scope?.id));
  const tabs = [
    `<a class="rubric-tab${selected ? "" : " is-on"}" href="/zpravy"${current(!selected)}>${esc(tx(copy, "chip_all"))}</a>`,
    ...tops.map((item) => {
      const on = item.id === scope?.id;
      const classes = ["rubric-tab", on ? "is-on" : "", hasKids(item) ? "has-sub" : ""].filter(Boolean).join(" ");
      return `<a class="${classes}" href="${rubricHref(item.slug)}"${current(selected?.id === item.id)}>${esc(item.name)}</a>`;
    }),
  ].join("");
  return `<nav class="rubric-nav" aria-label="Rubriky" data-rubric-nav>
    <div class="rubric-tabs" data-rubric-tabs>${tabs}</div>
    ${subTray(rubrics, selected, scope, counts, copy)}
  </nav>`;
}

// Podrubriky jen pro vybranou hlavní rubriku, v podbloku připojeném pod ni.
function subTray(rubrics, selected, scope, counts, copy) {
  if (!scope) return "";
  const children = rubrics.filter(
    (item) => item.parentId === scope.id && (counts.get(item.id) || item.id === selected?.id),
  );
  if (!children.length) return "";
  const option = (item, label) => {
    const on = selected?.id === item.id;
    return `<a class="sub-chip${on ? " is-on" : ""}" href="${rubricHref(item.slug)}"${current(on)}>${esc(label)}<span class="sub-count">${counts.get(item.id) ?? 0}</span></a>`;
  };
  return `<div class="rubric-sub" data-rubric-sub>
      <p class="rubric-sub-label">${esc(scope.name)}<span class="crumb-sep" aria-hidden="true"></span></p>
      <div class="rubric-sub-list">${[option(scope, tx(copy, "chip_sub_all")), ...children.map((item) => option(item, item.name))].join("")}</div>
    </div>`;
}
