// Redakce: historie změn (jen hlavní redaktor). Kdo, kdy a co; u úprav okno se starými a novými hodnotami.
import { htmlText } from "../chat/prompt.js";
import { KEEP_DAYS } from "../audit-db.js";
import { SCHOOL_LIST } from "../skola/sources.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, field, input, list, item, modal, modalLink, pageHead, panel } from "./ui.js";

const BASE = "/redakce/historie";

export const SECTION_LABELS = {
  prihlaseni: "Přihlášení",
  zpravy: "Zprávy",
  rubriky: "Rubriky",
  akce: "Akce",
  munipolis: "Munipolis",
  fotbal: "Fotbal",
  denik: "Deník",
  ...Object.fromEntries(SCHOOL_LIST.map((source) => [source.tag, source.page])),
  obrazky: "Knihovna obrázků",
  reklamy: "Reklamy",
  svoz: "Popelnice",
  dvory: "Sběrné dvory",
  lekari: "Lékaři",
  "oteviraci-doba": "Otevírací doba",
  odstavky: "Odstávky",
  drbena: "Koza Drběna",
  chat: "Chat s Drběnou",
  texty: "Texty webu",
  lide: "Lidé",
  ucet: "Můj účet",
  vzkazy: "Vzkazy",
};

// Názvy tabulek a sloupců v okně se změnami. Co tu není, ukáže se tak, jak je v databázi.
const TABLE_LABELS = {
  articles: "Zpráva",
  proposals: "Návrh zprávy",
  ads: "Reklama",
  ad_proposals: "Návrh reklamy",
  events: "Akce",
  rubrics: "Rubrika",
  users: "Účet",
  yards: "Sběrný dvůr",
  yard_closures: "Mimořádné uzavření",
  doctors: "Lékař",
  doctor_changes: "Změna ordinačních hodin",
  places: "Místo",
  place_changes: "Změna otevírací doby",
  outage_areas: "Obec odstávek",
  notices: "Oznámení",
  road_closures: "Uzavírka",
  stock_images: "Fotka v knihovně",
  stock_topics: "Téma knihovny",
  chat_messages: "Vzkaz",
};

const FIELD_LABELS = {
  title: "Nadpis",
  excerpt: "Perex",
  body: "Text",
  category: "Rubrika",
  rubric_id: "Rubrika (číslo)",
  published: "Zveřejněno",
  created_at: "Datum",
  name: "Název",
  alias: "Přezdívka",
  email: "E-mail",
  login: "Přihlašovací jméno",
  role: "Role",
  active: "Aktivní",
  hours: "Hodiny",
  note: "Poznámka",
  reason: "Důvod",
  starts_on: "Od",
  ends_on: "Do",
  kind: "Druh",
  place: "Místo",
  phone: "Telefon",
  specialty: "Obor",
  accepts: "Co bere",
  offers: "Co tu najdete",
  sort_order: "Pořadí",
  enabled: "Zapnuto",
  link: "Odkaz",
  image_key: "Fotka",
  image_focus: "Výřez fotky",
  image_caption: "Popisek fotky",
  attachments: "Přílohy",
  status: "Stav",
  author_name: "Autor",
  signed_drbena: "Podpis Koza Drběna",
  summary: "Shrnutí",
  text: "Text",
  contact: "Kontakt",
  payload: "Navržená změna",
  reply: "Odpověď",
  caption: "Popisek",
  hint: "Nápověda",
  slug: "Adresa",
};

function stamp(iso) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function positive(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

// Filtr a stránkování z adresy.
export function auditQuery(url) {
  return {
    userId: positive(url.searchParams.get("kdo")),
    section: String(url.searchParams.get("sekce") ?? "").slice(0, 40),
    before: positive(url.searchParams.get("pred")),
    entryId: positive(url.searchParams.get("zaznam")),
  };
}

function queryString(query, extra = {}) {
  const params = new URLSearchParams();
  if (query.userId) params.set("kdo", String(query.userId));
  if (query.section) params.set("sekce", query.section);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, String(value));
  const text = params.toString();
  return text ? `${BASE}?${text}` : BASE;
}

// Hodnota do okna: HTML zprávy jako čistý text, JSON hezky odsazený.
export function shownValue(value) {
  if (value == null || value === "") return "";
  const text = String(value);
  if (/<\/?(?:p|div|br|strong|em|a|ul|ol|li|h\d)\b/i.test(text)) return htmlText(text).trim();
  if (/^[[{]/.test(text.trim())) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

function valueCell(value) {
  const text = shownValue(value);
  return text ? `<pre class="audit-value">${esc(text)}</pre>` : `<span class="audit-none">—</span>`;
}

function changeHtml(change) {
  const what = TABLE_LABELS[change.label] ?? change.label;
  const head = `${badge(change.kind, change.kind === "smazáno" ? "bad" : change.kind === "nové" ? "ok" : "info")} <b>${esc(what)}</b>${
    change.title ? ` „${esc(change.title)}“` : ""
  }`;
  const rows = Object.entries(change.fields ?? {})
    .map(([key, [old, next]]) => `<tr><th scope="row">${esc(FIELD_LABELS[key] ?? key)}</th><td data-label="Předtím">${valueCell(old)}</td><td data-label="Potom">${valueCell(next)}</td></tr>`)
    .join("");
  return `<section class="audit-change">
    <h3>${head}</h3>
    ${rows ? `<div class="table-wrap"><table class="table audit-table"><thead><tr><th>Pole</th><th>Předtím</th><th>Potom</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
  </section>`;
}

function entryDialog(entry, close) {
  return modal({
    id: "zaznam",
    title: entry.action,
    close,
    open: true,
    size: "wide",
    body: `<p class="item-meta">${esc(stamp(entry.at))} · ${esc(entry.userName || "neznámý")} · ${esc(SECTION_LABELS[entry.section] ?? entry.section)}</p>
      ${entry.changes.map(changeHtml).join("") || "<p>Bez uložených hodnot.</p>"}`,
  });
}

function entryItem(entry, query) {
  const who = entry.userName || "neznámý";
  const meta = [esc(stamp(entry.at)), esc(who), esc(SECTION_LABELS[entry.section] ?? entry.section)].join(" · ");
  const failed = entry.section === "prihlaseni" && !entry.userId;
  return item({
    title: entry.title ? `${entry.action} „${entry.title}“` : entry.action,
    meta,
    badges: failed ? badge("Nepovedené přihlášení", "bad") : "",
    actions: entry.hasChanges ? modalLink(queryString(query, { pred: query.before, zaznam: entry.id }), "Co se změnilo") : "",
    tone: failed ? "warn" : "",
    search: `${entry.action} ${entry.title} ${who}`,
  });
}

function filterForm(audit, query) {
  const people = [`<option value="">Všichni</option>`]
    .concat(audit.people.map((person) => `<option value="${person.id}"${person.id === query.userId ? " selected" : ""}>${esc(person.name)}</option>`))
    .join("");
  const sections = [`<option value="">Všechny</option>`]
    .concat(
      audit.sections.map(
        (section) => `<option value="${esc(section)}"${section === query.section ? " selected" : ""}>${esc(SECTION_LABELS[section] ?? section)}</option>`,
      ),
    )
    .join("");
  return `<form class="audit-filter" method="get" action="${BASE}">
    ${field("Kdo", `<select class="${input}" name="kdo">${people}</select>`)}
    ${field("Sekce", `<select class="${input}" name="sekce">${sections}</select>`)}
    <button class="btn btn-line" type="submit">Vybrat</button>
  </form>`;
}

export function adminAudit(ctx, data, message, query = {}) {
  const audit = data.audit ?? { entries: [], more: false, people: [], sections: [], entry: null };
  const close = queryString(query, { pred: query.before });
  const last = audit.entries.at(-1);
  const pager = [
    query.before ? `<a class="btn btn-line" href="${queryString(query)}">Nejnovější</a>` : "",
    audit.more && last ? `<a class="btn btn-line" href="${queryString(query, { pred: last.id })}">Starší</a>` : "",
  ].join("");
  const body = `${pageHead(
    "Historie změn",
    `Kdo co v redakci změnil a kdy, přihlášení i nepovedené pokusy. U úprav jsou vidět staré a nové hodnoty. Záznamy starší než ${KEEP_DAYS} dní se samy smažou.`,
  )}
    ${panel({
      title: "Záznamy",
      id: "zaznamy",
      tools: filterForm(audit, query),
      body: `${list(audit.entries.map((entry) => entryItem(entry, query)), "Zatím tu nic není.")}${pager ? `<p class="audit-pager">${pager}</p>` : ""}`,
    })}
    ${audit.entry ? entryDialog(audit.entry, close) : ""}`;
  return adminShell(ctx, data, "historie", message, body, { title: "Historie změn" });
}
