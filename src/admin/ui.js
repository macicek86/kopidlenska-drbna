import { esc } from "../view.js";

export const input = "control";

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-5h4v5"/>',
  news: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7 9h10M7 12.5h10M7 16h6"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pen: '<path d="M4.5 19.5h4l10.5-10.5-4-4L4.5 15.5z"/><path d="m13 7 4 4"/>',
  text: '<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
  bin: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  recycle: '<path d="M7 19H4.5l3.2-5.5"/><path d="M17 19h2.5l-3.2-5.5"/><path d="M9.3 5.5 12 3l2.7 2.5"/><path d="M7.7 13.5 12 5.8l4.3 7.7"/><path d="M7 19h10"/>',
  cross: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 6"/><path d="M17.5 14.2a5.5 5.5 0 0 1 3 5.3"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  logout: '<path d="M14 4.5h4.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h9"/>',
  external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8"/><path d="M3.5 13.5v5h17v-5h-5a3.5 3.5 0 0 1-7 0z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><path d="m12 8 3.3 2.4-1.3 3.9h-4l-1.3-3.9z"/><path d="M12 8V3.5M15.3 10.4l4.2-1.5M14 14.3l2.6 3.6M10 14.3l-2.6 3.6M8.7 10.4 4.5 8.9"/>',
};

export function icon(name) {
  const body = ICONS[name] ?? "";
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function field(label, control, hint = "") {
  return `<label class="field"><span>${label}</span>${control}${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
}

export function check(name, value, checked, label, hint = "") {
  return `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}"${checked ? " checked" : ""}> <span>${label}</span></label>${
    hint ? `<span class="hint check-hint">${hint}</span>` : ""
  }`;
}

export function hidden(name, value) {
  if (value === undefined || value === null || value === "") return "";
  return `<input type="hidden" name="${name}" value="${esc(value)}">`;
}

export function pageHead(title, lede = "", actions = "") {
  return `<header class="adm-head">
    <div class="adm-head-text">
      <h1>${esc(title)}</h1>
      ${lede ? `<p class="adm-lede">${lede}</p>` : ""}
    </div>
    ${actions ? `<div class="adm-head-actions">${actions}</div>` : ""}
  </header>`;
}

export function badge(text, tone = "") {
  if (!text) return "";
  return `<span class="badge${tone ? ` badge-${tone}` : ""}">${esc(text)}</span>`;
}

// Odkaz, který s JS otevře svůj obsah v modálním okně a bez JS normálně načte stránku.
export function modalLink(href, label, kind = "btn-line", extra = "") {
  return `<a class="btn btn-sm ${kind}" href="${href}" data-modal${extra ? ` ${extra}` : ""}>${label}</a>`;
}

// Tlačítko na okno, které už je ve stránce schované. Bez JS vede na adresu, kde je otevřené.
export function openButton(id, href, label, kind = "btn-primary") {
  return `<a class="btn ${kind}" href="${href}" data-open="${id}">${kind === "btn-primary" ? icon("plus") : ""}<span>${label}</span></a>`;
}

export function postButton(action, fields, label, kind = "btn-line") {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${esc(value)}">`)
    .join("");
  return `<form class="inline-form" method="post" action="${action}">${inputs}<button class="btn btn-sm ${kind}" type="submit">${label}</button></form>`;
}

export function item({ title, meta = "", badges = "", actions = "", extra = "", search = "", tone = "" }) {
  const text = search || `${title} ${meta}`;
  return `<li class="item${tone ? ` item-${tone}` : ""}" data-search="${esc(String(text).toLowerCase())}">
    <div class="item-main">
      <h3>${esc(title)}</h3>
      ${meta ? `<p class="item-meta">${meta}</p>` : ""}
      ${badges ? `<p class="item-badges">${badges}</p>` : ""}
    </div>
    ${actions ? `<div class="item-actions">${actions}</div>` : ""}
    ${extra ? `<div class="item-extra">${extra}</div>` : ""}
  </li>`;
}

export function empty(text) {
  return `<p class="empty">${text}</p>`;
}

export function panel({ title, count, body, filter = "", tools = "", id = "", tone = "" }) {
  const listId = id || "seznam";
  const search = filter
    ? `<label class="filter">${icon("search")}<input type="search" placeholder="${esc(filter)}" data-filter="${listId}" aria-label="${esc(filter)}"></label>`
    : "";
  return `<section class="panel${tone ? ` panel-${tone}` : ""}" id="${listId}">
    <header class="panel-head">
      <h2>${esc(title)}${count !== undefined ? ` <span class="panel-count">${count}</span>` : ""}</h2>
      ${search || tools ? `<div class="panel-tools">${tools}${search}</div>` : ""}
    </header>
    ${body}
    ${filter ? `<p class="empty" data-filter-empty hidden>Nic tomu neodpovídá.</p>` : ""}
  </section>`;
}

export function list(items, emptyText) {
  return items.length ? `<ul class="items">${items.join("")}</ul>` : empty(emptyText);
}

/**
 * Modální okno. `open` znamená, že ho stránka otevře hned (bez JS je vidět v toku stránky).
 * `close` je adresa, kam vede zavření, když nejde JS.
 */
export function modal({ id = "okno", title, body, close, open = false, size = "" }) {
  return `<dialog class="modal${size ? ` modal-${size}` : ""}" id="${id}" aria-labelledby="${id}-title" data-close="${esc(close)}"${
    open ? " data-autoopen open" : ""
  }>
    <div class="modal-head">
      <h2 id="${id}-title">${esc(title)}</h2>
      <a class="modal-x" href="${esc(close)}" data-dismiss aria-label="Zavřít">${icon("x")}</a>
    </div>
    <div class="modal-body">${body}</div>
  </dialog>`;
}

export function formFoot(submit, extra = "") {
  return `<div class="form-foot">${extra}<span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">${submit}</button></div>`;
}

export function cancelLink(close, label = "Zrušit") {
  return `<a class="btn btn-ghost" href="${esc(close)}" data-dismiss>${label}</a>`;
}

export function confirmForm({ action, id, text, submit, close, fields = {} }) {
  const extra = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${esc(value)}">`)
    .join("");
  return `<form class="form confirm" method="post" action="${action}">
    <p class="confirm-text">${text}</p>
    <input type="hidden" name="id" value="${id}">
    <input type="hidden" name="confirm" value="1">
    ${extra}
    <div class="form-foot">${cancelLink(close, "Nechat")}<span class="form-foot-gap"></span><button class="btn btn-danger" type="submit">${submit}</button></div>
  </form>`;
}

export function callout(text, tone = "info") {
  if (!text) return "";
  return `<div class="callout callout-${tone}">${text}</div>`;
}
