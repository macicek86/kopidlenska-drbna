// Stránka /odber: všechny feedy na jednom místě (zprávy i po rubrikách, akce do kalendáře, změny hodin, odstávky).
import { text as tx } from "../copy.js";
import { esc } from "../html.js";
import { layout, siteOrigin } from "../view.js";
import { feedOn } from "./settings.js";

// Adresa kalendáře pro aplikace: webcal:// otevře kalendář v iPhonu, na Macu a v Outlooku rovnou k odběru.
export function webcalUrl(base, path) {
  return `${base.replace(/^https?:/, "webcal:")}${path}`;
}

export function googleCalendarUrl(base, path) {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(base, path))}`;
}

function feedRow(base, path, title, note) {
  const url = `${base}${path}`;
  return `<li class="feed-row">
      <div>
        <h3><a href="${esc(path)}">${esc(title)}</a></h3>
        ${note ? `<p class="muted">${esc(note)}</p>` : ""}
        <p class="feed-url"><code>${esc(url)}</code></p>
      </div>
    </li>`;
}

// Rubriky: hlavní a pod ní podrubriky, prázdné se nenabízejí.
function rubricRows(base, rubrics) {
  const used = rubrics.filter((item) => item.articleCount || rubrics.some((child) => child.parentId === item.id && child.articleCount));
  const tops = used.filter((item) => !item.parentId);
  const row = (item, label) => `<li><a href="/feed.xml?rubrika=${esc(encodeURIComponent(item.slug))}">${esc(label)}</a></li>`;
  return tops
    .map((top) => {
      const kids = used.filter((item) => item.parentId === top.id && item.articleCount);
      return `${row(top, top.name)}${kids.map((kid) => row(kid, `${top.name} › ${kid.name}`)).join("")}`;
    })
    .join("");
}

// Zprávy, akce, změny hodin a odstávky do čtečky.
const READER_FEEDS = [
  ["/feed.xml", "Všechny zprávy", "Celé zprávy i s fotkou, jak vyjdou na drbně."],
  ["/akce/feed.xml", "Nové akce", "Když v kalendáři přibude akce."],
  ["/oteviraci-doba/feed.xml", "Změny otevírací doby", "Úřad, knihovna a další místa, lékaři a sběrné dvory: kdy mají zavřeno nebo jinak."],
  ["/odstavky/feed.xml", "Odstávky a uzavírky", "Kdy nepoteče voda, nepůjde proud nebo bude zavřená silnice."],
];

// Ukáže jen to, co redakce nechala zapnuté (ctx.feedOn).
export function feedsPage(rubrics, ctx) {
  const base = siteOrigin(ctx.origin, ctx.mainOrigin);
  const on = (href) => feedOn(ctx.feedOn, href);
  const rubricList = on("/feed.xml?rubrika=") ? rubricRows(base, rubrics) : "";
  const readers = READER_FEEDS.filter(([path]) => on(path));
  const calendar = on("/akce.ics")
    ? `<section class="block">
        <h2>Akce do kalendáře</h2>
        <div class="card feed-calendar">
          <p>Všechny akce z kalendáře drbny se vám objeví v kalendáři v telefonu. Když redakce akci změní nebo přidá novou, kalendář si to sám načte.</p>
          <div class="row">
            <a class="btn btn-primary" href="${esc(googleCalendarUrl(base, "/akce.ics"))}" target="_blank" rel="noopener">Google Kalendář</a>
            <a class="btn btn-line" href="${esc(webcalUrl(base, "/akce.ics"))}">iPhone, Mac a Outlook</a>
          </div>
          <p class="fine">Jiná aplikace: přidejte kalendář podle adresy <code>${esc(`${base}/akce.ics`)}</code></p>
        </div>
      </section>`
    : "";
  const reader =
    readers.length || rubricList
      ? `<section class="block">
        <h2>Do čtečky (RSS)</h2>
        <p class="muted">Adresu vložte do čtečky, třeba Feedly nebo Inoreader. Novinky vám pak přijdou samy.</p>
        ${readers.length ? `<ul class="plain feed-list">${readers.map(([path, title, note]) => feedRow(base, path, title, note)).join("")}</ul>` : ""}
        ${
          rubricList
            ? `<h3>Jen jedna rubrika</h3>
        <p class="muted">Zprávy jen z vybrané rubriky:</p>
        <ul class="feed-rubrics">${rubricList}</ul>`
            : ""
        }
      </section>`
      : "";
  const hoursData = on("/oteviraci-doba.json")
    ? `Otevírací doba míst, lékařů a sběrných dvorů jako data: <a href="/oteviraci-doba.json">/oteviraci-doba.json</a>. `
    : "";
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "feeds_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "feeds_description"),
    feeds: READER_FEEDS.filter(([path]) => path !== "/feed.xml").map(([path, title]) => [path, title]),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "feeds_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "feeds_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "feeds_lede"))}</p>
      ${calendar}
      ${reader}
      <section class="block">
        <h2>Pro weby a aplikace</h2>
        <p class="muted">${hoursData}Odstávky elektřiny: <a href="/odstavky.json">/odstavky.json</a>.</p>
      </section>`,
  });
}
