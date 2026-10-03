// Odstávky na webu: elektřina z widgetu ČEZ a voda z oznámení města.
import { text as tx } from "./copy.js";
import { esc } from "./html.js";
import { askLine, layout } from "./view.js";

const TEASER_PLACES_CHARS = 45;

function placesWord(count) {
  if (count === 1) return "místo";
  if (count >= 2 && count <= 4) return "místa";
  return "míst";
}

// Na titulku jen pár míst bez upřesnění v závorkách, kolik se vejde na řádek, a kolik dalších.
// Jinak by první ulice vypadala jako jediná, kde se odstávka chystá.
export function teaserPlaces(item) {
  const labels = item.placeLabels ?? [];
  const total = labels.length + (item.morePlaces ?? 0);
  const shown = [];
  let length = 0;
  for (const label of labels) {
    const short = label.replace(/\s*\([^)]*\)/g, "").trim() || label;
    if (shown.length && length + short.length + 2 > TEASER_PLACES_CHARS) break;
    shown.push(short);
    length += short.length + 2;
  }
  const rest = total - shown.length;
  if (!rest) return shown.join(", ");
  return `${shown.join(", ")} a ${rest === 1 ? "ještě 1" : `${rest >= 5 ? "dalších" : "další"} ${rest}`} ${placesWord(rest)}`;
}

function teaserLine({ kind, name, state, when, where }) {
  return `<li class="${kind}">
    <p class="yard-home-name">${esc(name)}</p>
    <p class="yard-home-state">${esc(state)}</p>
    <p class="yard-home-detail">${esc(when)}</p>
    ${where ? `<p class="yard-home-detail">${esc(where)}</p>` : ""}
  </li>`;
}

export function outagesTeaser(data, ctx) {
  const soon = (item) => item.phase === "now" || item.phase === "soon";
  const water = (data.water ?? []).filter(soon).map((item) => ({
    kind: item.phase === "now" ? "is-closure" : "is-later",
    name: item.title,
    state: item.state,
    when: item.when,
    where: teaserPlaces(item),
  }));
  const power = (data.outages?.items ?? []).filter(soon).map((item) => ({
    kind: item.phase === "now" ? "is-closure" : "is-later",
    name: item.areaName,
    state: item.state,
    when: item.when,
    where: teaserPlaces(item),
  }));
  const items = [...water, ...power].slice(0, 3);
  if (!items.length) return "";
  return `<div class="card waste-teaser">
    <p class="eyebrow">${esc(tx(ctx.copy, "home_outages_button"))}</p>
    <ul class="yard-home">${items.map(teaserLine).join("")}</ul>
    <div class="row"><a class="btn btn-primary" href="/odstavky">${esc(tx(ctx.copy, "home_outages_button"))}</a></div>
  </div>`;
}

function placeList(item) {
  const places = (item.placeLabels ?? []).map((label) => `<li>${esc(label)}</li>`).join("");
  const more = item.morePlaces ? `<p class="muted outage-more">A dalších ${esc(item.morePlaces)} míst.</p>` : "";
  return `${places ? `<ul class="outage-places">${places}</ul>` : ""}${more}`;
}

export function outageCard(item, { showArea, copy }) {
  const parcels = item.parcelLine ? `<p class="meta">${esc(item.parcelLine)}</p>` : "";
  const pdf = item.announcementUrl
    ? `<p><a href="${esc(item.announcementUrl)}" target="_blank" rel="noopener noreferrer">${esc(tx(copy, "outages_announcement"))}</a></p>`
    : "";
  return `<article class="card yard">
    ${showArea ? `<p class="kicker">${esc(item.areaName)}</p>` : ""}
    <p class="outage-state is-${esc(item.phase)}">${esc(item.state)}</p>
    <p class="outage-when">${esc(item.when)}</p>
    ${placeList(item)}
    ${parcels}
    ${pdf}
  </article>`;
}

export function noticeCard(item, { copy }) {
  const source = item.sourceUrl
    ? `<p><a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(tx(copy, "water_source"))}</a></p>`
    : "";
  return `<article class="card yard">
    <p class="kicker">${esc(item.title)}</p>
    <p class="outage-state is-${esc(item.phase)}">${esc(item.state)}</p>
    <p class="outage-when">${esc(item.when)}</p>
    ${placeList(item)}
    ${item.note ? `<p class="meta">${esc(item.note)}</p>` : ""}
    ${source}
  </article>`;
}

export function outageEmpty(board, copy) {
  if (!board.areas.length) return tx(copy, "outages_none_watched");
  if (!board.fetchedAt) return tx(copy, "outages_waiting");
  return tx(copy, "outages_empty");
}

function waterSection(water, copy) {
  const body = water.length
    ? `<div class="stack">${water.map((item) => noticeCard(item, { copy })).join("")}</div>`
    : `<p class="card dashed muted">${esc(tx(copy, "water_empty"))}</p>`;
  return `<section class="block">
    <h2>${esc(tx(copy, "water_heading"))}</h2>
    ${body}
    <p class="fine">${esc(tx(copy, "water_note"))}</p>
  </section>`;
}

function powerSection(board, copy) {
  const showArea = board.areas.length > 1;
  const group = (heading, items) =>
    items.length
      ? `<h3>${esc(heading)}</h3><div class="stack">${items
          .map((item) => outageCard(item, { showArea, copy }))
          .join("")}</div>`
      : "";
  const current = board.items.filter((item) => item.phase === "now");
  const planned = board.items.filter((item) => item.phase !== "now");
  const list = board.items.length
    ? `${group(tx(copy, "outages_current"), current)}${group(tx(copy, "outages_planned"), planned)}`
    : `<p class="card dashed muted">${esc(outageEmpty(board, copy))}</p>`;
  return `<section class="block">
    <h2>${esc(tx(copy, "power_heading"))}</h2>
    ${board.note ? `<p class="banner">${esc(board.note)}</p>` : ""}
    ${list}
    <p class="fine">${board.checked ? `${esc(board.checked)} ` : ""}${esc(tx(copy, "outages_disclaimer"))} <a href="https://www.bezstavy.cz/" target="_blank" rel="noopener noreferrer">${esc(tx(copy, "outages_source"))}</a>.</p>
  </section>`;
}

export function outagesPage(data, ctx) {
  const board = data.outages ?? { items: [], areas: [], fetchedAt: null, status: "", note: "", checked: "" };
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "outages_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "outages_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "outages_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "outages_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "outages_lede"))}</p>
      ${askLine(ctx, "outages", "Chybí tu odstávka: ")}
      ${waterSection(data.water ?? [], ctx.copy)}
      ${powerSection(board, ctx.copy)}`,
  });
}
