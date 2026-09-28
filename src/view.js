import { CATEGORIES } from "./db.js";
import { COPY, text as tx } from "./copy.js";
import { countdownLabel, formatDayMonth, formatLong, formatShort, ruleLabel, weekdayName } from "./format.js";

const CATEGORY_KEY = {
  Zprávy: "cat_zpravy",
  Komunita: "cat_komunita",
  Kultura: "cat_kultura",
  Praktické: "cat_prakticke",
  Sport: "cat_sport",
};

function externalHref(copy) {
  const value = tx(copy, "popelnice_url").trim();
  return /^https?:\/\//i.test(value) ? value : "https://popelnice.kopidlenskadrbna.org/";
}

function catLabel(copy, category) {
  const key = CATEGORY_KEY[category];
  return key ? tx(copy, key) : category;
}

const NAV = [
  ["/zpravy", "nav_news"],
  ["/akce", "nav_events"],
  ["/popelnice", "nav_bins"],
  ["/o-nas", "nav_about"],
];

const AMP = "\u0026amp;";
const LT = "\u0026lt;";
const GT = "\u0026gt;";
const QUOT = "\u0026quot;";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT);
}

function mediaUrl(key) {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function paragraphs(body) {
  return body
    .split(/\n\n+/)
    .filter(Boolean)
    .map((paragraph) => `<p>${esc(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

function active(path, href) {
  return path === href || path.startsWith(`${href}/`) ? " is-on" : "";
}

export function layout({ title, description, path, minimal, mainOrigin, body, script = "", copy = {} }) {
  const brandHref = minimal ? "/popelnice" : "/";
  const brandImg = minimal ? "/kozel-popelar.webp" : "/kozel-maskot.webp";
  const links = NAV.map(
    ([href, key]) =>
      `<a class="nav-link${active(path, href)}" href="${href}">${esc(tx(copy, key))}</a>`,
  ).join("");
  const headerNav = minimal
    ? `<a class="btn btn-line" href="${esc(mainOrigin)}">${esc(tx(copy, "link_whole"))}</a>`
    : `<nav class="nav" aria-label="Hlavní">${links}</nav>
       <details class="mobile-nav">
         <summary>${esc(tx(copy, "menu_label"))}</summary>
         <nav aria-label="Mobilní">${links}</nav>
       </details>`;
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,560;9..144,650&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/site.css">
</head>
<body>
  <div class="wrap">
    <a class="skip" href="#obsah">${esc(tx(copy, "skip"))}</a>
    <header class="top">
      <a class="brand" href="${brandHref}">
        <img src="${brandImg}" alt="">
        <span>${esc(tx(copy, "brand_line"))}<span>${esc(tx(copy, "brand_accent"))}</span></span>
      </a>
      ${headerNav}
    </header>
    <main id="obsah">${body}</main>
    <footer>
      <p>${esc(tx(copy, "footer_copy"))}</p>
      <p class="fine">${esc(tx(copy, "footer_fine"))}</p>
      ${minimal ? "" : `<a href="/redakce">${esc(tx(copy, "footer_admin"))}</a>`}
    </footer>
  </div>
  ${script}
</body>
</html>`;
}

function note(message, kind) {
  if (!message) return "";
  return `<p class="note ${kind === "ok" ? "note-ok" : "note-bad"}" role="status">${esc(message)}</p>`;
}

function flashOf(message) {
  if (message && typeof message === "object") {
    return { text: String(message.text ?? ""), kind: message.kind === "bad" ? "bad" : "ok" };
  }
  return { text: String(message ?? ""), kind: "ok" };
}

function signedWhen(article, when) {
  return article.authorName ? `${when} · ${article.authorName}` : when;
}

function articleMeta(article) {
  const base = signedWhen(article, formatLong(article.createdOn));
  const mark = article.redacted ? ` · <span class="redigovano">Redigováno</span>` : "";
  return `<p class="meta">${esc(base)}${mark}</p>`;
}

export function homePage(data, ctx) {
  const lead = data.articles[0];
  const rest = data.articles.slice(1, 4);
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today).slice(0, 3);
  const leadHtml = lead
    ? `<a class="card card-lead" href="/zpravy/${esc(lead.slug)}">
        ${lead.imageKey ? `<img class="cover" src="${mediaUrl(lead.imageKey)}" alt="">` : ""}
        <p class="kicker">${esc(catLabel(ctx.copy, lead.category))}</p>
        <h3>${esc(lead.title)}</h3>
        <p class="muted">${esc(lead.excerpt)}</p>
        <p class="meta">${esc(signedWhen(lead, formatDayMonth(lead.createdOn)))}</p>
      </a>`
    : `<p class="card muted">${esc(tx(ctx.copy, "empty_articles"))}</p>`;
  const restHtml = rest
    .map(
      (article) => `<a class="card card-side" href="/zpravy/${esc(article.slug)}">
        <p class="kicker">${esc(catLabel(ctx.copy, article.category))}</p>
        <h3>${esc(article.title)}</h3>
      </a>`,
    )
    .join("");
  const eventsHtml = upcoming.length
    ? `<div class="cards-3">${upcoming
        .map(
          (event) => `<article class="card">
            <p class="kicker">${esc(formatLong(event.startsOn))}</p>
            <h3>${esc(event.title)}</h3>
            <p class="muted">${esc(event.place)}${event.startsTime ? ` · ${esc(event.startsTime)}` : ""}</p>
          </article>`,
        )
        .join("")}</div>`
    : `<p class="card dashed muted">${esc(tx(ctx.copy, "empty_events"))}</p>`;

  return layout({
    ...ctx,
    title: tx(ctx.copy, "site_name"),
    description: tx(ctx.copy, "home_description"),
    body: `
      <section class="hero">
        <div class="mascot">
          <span class="sun" aria-hidden="true"></span>
          <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>
          <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "hero_alt"))}">
        </div>
        <div>
          <p class="pill">${esc(tx(ctx.copy, "hero_pill"))}</p>
          <h1>${esc(tx(ctx.copy, "hero_title"))}<span>${esc(tx(ctx.copy, "hero_accent"))}</span></h1>
          <p class="lede">${esc(tx(ctx.copy, "hero_lede"))}</p>
          <div class="card waste-teaser">
            <p class="eyebrow">${esc(tx(ctx.copy, "home_waste_eyebrow"))}</p>
            <p class="date">${esc(formatLong(data.waste.nextDate))}</p>
            <p class="count">${esc(countdownLabel(data.waste.daysUntil, ctx.copy))}</p>
            <div class="row">
              <a class="btn btn-primary" href="/popelnice">${esc(tx(ctx.copy, "home_waste_button"))}</a>
              <a class="btn btn-line" href="${esc(externalHref(ctx.copy))}" target="_blank" rel="noreferrer">${esc(tx(ctx.copy, "popelnice_label"))}</a>
            </div>
          </div>
        </div>
      </section>
      <section class="block">
        <div class="section-head"><h2>${esc(tx(ctx.copy, "home_news_heading"))}</h2><a href="/zpravy">${esc(tx(ctx.copy, "home_news_all"))}</a></div>
        <div class="news-grid">${leadHtml}<div class="stack">${restHtml}</div></div>
      </section>
      <section class="block">
        <div class="section-head"><h2>${esc(tx(ctx.copy, "home_events_heading"))}</h2><a href="/akce">${esc(tx(ctx.copy, "home_events_all"))}</a></div>
        ${eventsHtml}
      </section>`,
  });
}

export function newsPage(data, ctx, rubrika) {
  const filter = rubrika && CATEGORIES.includes(rubrika) ? rubrika : "Vše";
  const visible = filter === "Vše" ? data.articles : data.articles.filter((article) => article.category === filter);
  const chips = ["Vše", ...CATEGORIES]
    .map((category) => {
      const href = category === "Vše" ? "/zpravy" : `/zpravy?rubrika=${encodeURIComponent(category)}`;
      const label = category === "Vše" ? tx(ctx.copy, "chip_all") : catLabel(ctx.copy, category);
      return `<a class="chip${filter === category ? " is-on" : ""}" href="${href}">${esc(label)}</a>`;
    })
    .join("");
  const list = visible.length
    ? visible
        .map(
          (article) => `<a class="card story" href="/zpravy/${esc(article.slug)}">
            ${article.imageKey ? `<img class="cover" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
            <p class="kicker">${esc(catLabel(ctx.copy, article.category))}</p>
            <h2>${esc(article.title)}</h2>
            <p class="muted">${esc(article.excerpt)}</p>
            <p class="meta">${esc(signedWhen(article, formatDayMonth(article.createdOn)))}</p>
          </a>`,
        )
        .join("")
    : `<p class="muted">${esc(tx(ctx.copy, "news_empty"))}</p>`;
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "news_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "news_description"),
    body: `<p class="eyebrow">${esc(tx(ctx.copy, "news_eyebrow"))}</p><h1>${esc(tx(ctx.copy, "news_heading"))}</h1><div class="chips">${chips}</div><div class="stack">${list}</div>`,
  });
}

export function articlePage(article, ctx) {
  return layout({
    ...ctx,
    title: `${article.title} | ${tx(ctx.copy, "site_name")}`,
    description: article.excerpt,
    body: `
      <a class="back" href="/zpravy">${esc(tx(ctx.copy, "article_back"))}</a>
      <p class="eyebrow">${esc(catLabel(ctx.copy, article.category))}</p>
      <h1 class="article-title">${esc(article.title)}</h1>
      ${articleMeta(article)}
      ${article.imageKey ? `<img class="article-photo" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
      <div class="prose">${paragraphs(article.body)}</div>`,
  });
}

export function missingPage(ctx) {
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "missing_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "missing_description"),
    body: `<h1>${esc(tx(ctx.copy, "missing_heading"))}</h1><a class="back" href="/zpravy">${esc(tx(ctx.copy, "article_back"))}</a>`,
  });
}

function eventList(title, items, empty) {
  const body = items.length
    ? `<div class="stack">${items
        .map(
          (event) => `<article class="card">
            <p class="kicker">${esc(formatLong(event.startsOn))}${event.startsTime ? ` · ${esc(event.startsTime)}` : ""}</p>
            <h3>${esc(event.title)}</h3>
            <p class="meta">${esc(event.place)}</p>
            ${event.description ? `<p class="muted">${esc(event.description)}</p>` : ""}
          </article>`,
        )
        .join("")}</div>`
    : `<p class="muted">${esc(empty)}</p>`;
  return `<section class="block"><h2>${esc(title)}</h2>${body}</section>`;
}

export function eventsPage(data, ctx) {
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today);
  const past = data.events.filter((event) => event.startsOn < data.waste.today).reverse();
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "events_heading")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "events_description"),
    body: `
      <p class="eyebrow">${esc(tx(ctx.copy, "events_eyebrow"))}</p>
      <h1>${esc(tx(ctx.copy, "events_heading"))}</h1>
      <p class="lede">${esc(tx(ctx.copy, "events_lede"))}</p>
      ${eventList(tx(ctx.copy, "events_upcoming"), upcoming, tx(ctx.copy, "events_upcoming_empty"))}
      ${past.length ? eventList(tx(ctx.copy, "events_past"), past, "") : ""}`,
  });
}

export function binsPage(waste, ctx, { showExternal, standaloneTitle }) {
  const dates = waste.upcoming
    .map(
      (iso) => `<article class="date-tile"><strong>${esc(formatShort(iso))}</strong><span>${esc(formatLong(iso))}</span></article>`,
    )
    .join("");
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, standaloneTitle ? "bins_standalone" : "bins_title")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "bins_description"),
    minimal: ctx.minimal,
    body: `
      <section class="bins">
        <div class="card bin-copy">
          <p class="pill">${esc(tx(ctx.copy, "bins_pill"))}</p>
          <h1>${esc(formatLong(waste.nextDate))}</h1>
          <p class="count">${esc(countdownLabel(waste.daysUntil, ctx.copy))}</p>
          <p class="muted">${esc(waste.note)}</p>
          <p class="rule">${esc(ruleLabel(waste))}</p>
          <div class="row">
            <span class="chip">${esc(waste.holidayNote)}</span>
            <span class="chip">${esc(tx(ctx.copy, "bins_kind"))}</span>
          </div>
          ${
            showExternal
              ? `<a class="back" href="${esc(externalHref(ctx.copy))}" target="_blank" rel="noreferrer">${esc(tx(ctx.copy, "popelnice_label"))}</a>`
              : ""
          }
        </div>
        <div class="bin-photo"><img src="/kozel-popelar.webp" alt="${esc(tx(ctx.copy, "bins_alt"))}"></div>
      </section>
      <section class="card block">
        <h2>${esc(tx(ctx.copy, "bins_more"))}</h2>
        <div class="dates">${dates}</div>
      </section>`,
  });
}

export function aboutPage(data, ctx) {
  return layout({
    ...ctx,
    title: `${tx(ctx.copy, "nav_about")} | ${tx(ctx.copy, "site_name")}`,
    description: tx(ctx.copy, "about_description"),
    body: `
      <section class="about">
        <img src="/kozel-maskot.webp" alt="${esc(tx(ctx.copy, "about_alt"))}">
        <div>
          <p class="eyebrow">${esc(tx(ctx.copy, "about_eyebrow"))}</p>
          <h1>${esc(tx(ctx.copy, "about_heading"))}</h1>
          <p class="lede">${esc(tx(ctx.copy, "about_lede"))}</p>
          <p>${esc(tx(ctx.copy, "about_disclaimer"))}</p>
          <p>${esc(data.contactNote)}</p>
          <div class="row links">
            <a href="/popelnice">${esc(tx(ctx.copy, "about_bins_link"))}</a>
            <a href="${esc(externalHref(ctx.copy))}" target="_blank" rel="noreferrer">${esc(tx(ctx.copy, "popelnice_label"))}</a>
          </div>
        </div>
      </section>`,
  });
}

function photoControl(editing) {
  const preview = editing?.imageKey
    ? `<img class="thumb" src="${mediaUrl(editing.imageKey)}" alt="">`
    : `<span class="hint">Před odesláním se v prohlížeči zmenší a uloží jako WEBP. Delší strana nejvýš 1600 px.</span>`;
  return `<input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">${preview}`;
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

const input = "control";

function adminShell(ctx, data, tab, message, inner) {
  const flash = flashOf(message);
  if (!data.signedIn) {
    return layout({
      ...ctx,
      path: "/redakce",
      title: "Redakce | Kopidlenská drbna",
      description: "Přihlášení do redakce Kopidlenské drbny.",
      body: `
        <section class="card login">
          <p class="eyebrow">Administrace</p>
          <h1>Redakce</h1>
          <p class="muted">Hlavní redaktor a přispěvatelé. Návštěvníci obsah jen čtou.</p>
          ${
            data.showDefaultPassword
              ? `<p class="banner">Výchozí přihlášení je jméno redakce a heslo Drbna2026. Po vstupu si ho změňte.</p>`
              : ""
          }
          <form method="post" action="/redakce/prihlasit">
            ${field("Přihlašovací jméno", `<input class="${input}" name="login" autocomplete="username" autocapitalize="none" required>`)}
            ${field("Heslo", `<input class="${input}" type="password" name="password" autocomplete="current-password" required>`)}
            <button class="btn btn-primary" type="submit">Vstoupit</button>
            ${note(flash.text, "bad")}
          </form>
        </section>`,
    });
  }

  const chief = data.user?.role === "hlavni";
  const waiting = (data.proposals ?? []).filter((item) => item.status === "pending").length;
  const newsLabel = chief && waiting ? `Zprávy (${waiting})` : "Zprávy";
  const tabs = chief
    ? [
        ["/redakce/zpravy", "zpravy", newsLabel],
        ["/redakce/akce", "akce", "Akce"],
        ["/redakce/texty", "texty", "Texty"],
        ["/redakce/svoz", "svoz", "Popelnice a kontakt"],
        ["/redakce/lide", "lide", "Lidé"],
        ["/redakce/heslo", "heslo", "Heslo"],
      ]
    : [
        ["/redakce/zpravy", "zpravy", "Zprávy"],
        ["/redakce/heslo", "heslo", "Heslo"],
      ];
  const tabHtml = tabs
    .map(
      ([href, id, label]) =>
        `<a class="btn ${tab === id ? "btn-ink" : "btn-line"}" href="${href}">${label}</a>`,
    )
    .join("");
  const who = chief ? "hlavní redaktor" : "přispěvatel";
  return layout({
    ...ctx,
    path: "/redakce",
    title: "Redakce | Kopidlenská drbna",
    description: "Redakce Kopidlenské drbny.",
    script: `<script src="/editor.js" defer></script>`,
    body: `
      <div class="admin-head">
        <div>
          <p class="eyebrow">Administrace</p>
          <h1>Redakce</h1>
          <p class="muted">${esc(data.user?.name ?? "")} · ${who}</p>
        </div>
        <form method="post" action="/redakce/odhlasit"><button class="btn btn-line" type="submit">Odhlásit</button></form>
      </div>
      ${
        chief && data.showDefaultPassword
          ? `<p class="banner">Pořád platí výchozí heslo. V záložce Heslo si nastavte vlastní.</p>`
          : ""
      }
      <div class="row">${tabHtml}</div>
      ${note(flash.text, flash.kind)}
      ${inner}`,
  });
}

function categoryOptions(ctx, selected) {
  return CATEGORIES.map(
    (category) =>
      `<option value="${esc(category)}"${selected === category ? " selected" : ""}>${esc(catLabel(ctx.copy, category))}</option>`,
  ).join("");
}

function articleFields(ctx, source) {
  const selected = source?.category ?? "Zprávy";
  return `
    ${field("Nadpis", `<input class="${input}" name="title" required maxlength="160" value="${esc(source?.title ?? "")}">`)}
    ${field("Perex", `<textarea class="${input}" name="excerpt" required maxlength="320" rows="3">${esc(source?.excerpt ?? "")}</textarea>`)}
    ${field("Text", `<textarea class="${input}" name="body" required maxlength="12000" rows="8">${esc(source?.body ?? "")}</textarea>`)}
    ${field("Rubrika", `<select class="${input}" name="category">${categoryOptions(ctx, selected)}</select>`)}
    ${field("Fotka", photoControl(source))}`;
}

function proposalKind(item) {
  return item.articleId ? "Návrh úpravy" : "Nový příspěvek";
}

function chiefArticles(ctx, data, message, query) {
  const proposal = data.proposals.find((item) => item.id === query.proposalId) ?? null;
  const editing = proposal ? null : (data.articles.find((item) => item.id === query.editingId) ?? null);
  const queue = data.proposals
    .map(
      (item) => `<li class="card">
        <p class="kicker">${proposalKind(item)} · ${esc(item.authorName)}</p>
        <h3>${esc(item.title)}</h3>
        <p class="muted">${esc(item.excerpt)}</p>
        ${item.articleTitle ? `<p class="meta">Ke zprávě: ${esc(item.articleTitle)}</p>` : ""}
        <div class="row"><a class="btn btn-line" href="/redakce/zpravy?navrh=${item.id}">Otevřít</a></div>
      </li>`,
    )
    .join("");
  const list = data.articles
    .map((item) => {
      const confirm =
        query.confirmId === item.id
          ? `<form method="post" action="/redakce/zpravy/smazat">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Opravdu smazat</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/zpravy">Nechat</a>`
          : `<a class="btn btn-ghost" href="/redakce/zpravy?smazat=${item.id}">Smazat</a>`;
      return `<li class="card">
        <p class="kicker">${esc(catLabel(ctx.copy, item.category))}${item.authorName ? ` · ${esc(item.authorName)}` : ""}${item.published ? "" : " · skrytá"}${item.redacted ? " · redigováno" : ""}</p>
        <h3>${esc(item.title)}</h3>
        <div class="row">
          <a class="btn btn-line" href="/redakce/zpravy?id=${item.id}">Upravit</a>
          ${confirm}
        </div>
      </li>`;
    })
    .join("");
  const form = proposal
    ? `<div class="stack"><form class="card form" method="post" action="/redakce/zpravy/schvalit" enctype="multipart/form-data">
        <h2>${proposal.articleId ? "Schválit úpravu" : "Schválit příspěvek"}</h2>
        <p class="muted">Autor na webu: ${esc(proposal.authorName)}. Text můžete před schválením upravit, typicky češtinu. Ven se neukáže, co se měnilo. Když se znění liší od návrhu, u autora bude nanejvýš slovo Redigováno.</p>
        ${proposal.articleTitle ? `<p class="meta">Ke zprávě: ${esc(proposal.articleTitle)}</p>` : ""}
        <input type="hidden" name="id" value="${proposal.id}">
        ${articleFields(ctx, proposal)}
        <div class="row">
          <button class="btn btn-primary" type="submit">Schválit a zveřejnit</button>
          <a class="btn btn-ghost" href="/redakce/zpravy">Zpět</a>
        </div>
      </form>
      <form class="card form" method="post" action="/redakce/zpravy/vratit">
        <input type="hidden" name="id" value="${proposal.id}">
        ${field("Poznámka pro autora", `<textarea class="${input}" name="note" maxlength="400" rows="3" placeholder="Co má dopracovat. Může zůstat prázdné."></textarea>`)}
        <button class="btn btn-line" type="submit">Vrátit</button>
      </form></div>`
    : `<form class="card form" method="post" action="/redakce/zpravy/ulozit" enctype="multipart/form-data">
        <h2>${editing ? "Upravit zprávu" : "Nová zpráva"}</h2>
        <p class="muted">${
          !editing
            ? `Jde na web hned a podepíše se jménem ${esc(data.user?.name ?? "Redakce")}.`
            : editing.authorName && editing.authorId !== data.user?.id
              ? `Autor zůstává ${esc(editing.authorName)}. Když změníte text, na webu se objeví nanejvýš slovo Redigováno.`
              : "Úprava jde na web hned."
        }</p>
        ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
        ${articleFields(ctx, editing)}
        <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
        <div class="row">
          <button class="btn btn-primary" type="submit">Uložit</button>
          ${editing ? `<a class="btn btn-ghost" href="/redakce/zpravy">Nová</a>` : ""}
        </div>
      </form>`;
  const queueHtml = queue
    ? `<section class="block"><h2>Ke schválení</h2><ul class="stack plain">${queue}</ul></section>`
    : "";
  return adminShell(
    ctx,
    data,
    "zpravy",
    message,
    `${queueHtml}<div class="split">${form}<ul class="stack plain">${list}</ul></div>`,
  );
}

function contributorArticles(ctx, data, message, query) {
  const opened = data.proposals.find((item) => item.id === query.proposalId) ?? null;
  const target = data.articles.find((item) => item.id === query.targetId) ?? null;
  const existingForTarget = target
    ? (data.proposals.find((item) => item.articleId === target.id) ?? null)
    : null;
  const proposal = opened ?? existingForTarget;
  const source = proposal ?? target;
  const linked = data.articles.find((item) => item.id === (proposal?.articleId ?? target?.id)) ?? null;
  const editingArticle = Boolean(proposal?.articleId || target);
  const mine = Boolean(linked && linked.authorId === data.user?.id);
  const heading = !editingArticle
    ? proposal
      ? "Váš příspěvek"
      : "Nový příspěvek"
    : mine
      ? "Úprava vaší zprávy"
      : "Návrh úpravy";
  const help = !editingArticle
    ? `Na web to přijde, až to schválí hlavní redaktor. Do té doby to tu můžete měnit. Podepíše se jménem ${esc(data.user?.name ?? "")}.`
    : mine
      ? "Veřejné znění se nezmění, dokud úpravu neschválí hlavní redaktor."
      : "Cizí zprávu nejde přepsat přímo. Tohle je návrh a rozhodne o něm hlavní redaktor. Autor zůstane ten původní.";
  const formSource = source ? { ...source, imageKey: source.imageKey || linked?.imageKey || null } : null;
  const returned = proposal?.status === "rejected" && proposal.note
    ? `<p class="banner">${esc(proposal.note)}</p>`
    : proposal?.status === "rejected"
      ? `<p class="banner">Hlavní redaktor návrh vrátil. Upravte ho a pošlete znovu.</p>`
      : "";
  const form = `<form class="card form" method="post" action="/redakce/zpravy/navrh" enctype="multipart/form-data">
    <h2>${heading}</h2>
    <p class="muted">${help}</p>
    ${returned}
    ${proposal ? `<input type="hidden" name="id" value="${proposal.id}">` : ""}
    ${target && !proposal ? `<input type="hidden" name="clanek" value="${target.id}">` : ""}
    ${proposal?.articleId ? `<input type="hidden" name="clanek" value="${proposal.articleId}">` : ""}
    ${articleFields(ctx, formSource)}
    <div class="row">
      <button class="btn btn-primary" type="submit">${proposal ? "Uložit návrh" : target ? "Poslat návrh" : "Poslat ke schválení"}</button>
      ${proposal || target ? `<a class="btn btn-ghost" href="/redakce/zpravy">Nový</a>` : ""}
    </div>
  </form>`;
  const own = data.proposals
    .map((item) => {
      const confirm =
        query.withdrawId === item.id
          ? `<form method="post" action="/redakce/zpravy/stahnout">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Opravdu stáhnout</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/zpravy">Nechat</a>`
          : `<a class="btn btn-ghost" href="/redakce/zpravy?stahnout=${item.id}">Stáhnout</a>`;
      const state = item.status === "rejected" ? "Vráceno" : "Čeká na schválení";
      return `<li class="card">
        <p class="kicker">${proposalKind(item)} · ${state}</p>
        <h3>${esc(item.title)}</h3>
        ${item.note ? `<p class="muted">${esc(item.note)}</p>` : ""}
        <div class="row">
          <a class="btn btn-line" href="/redakce/zpravy?navrh=${item.id}">Upravit</a>
          ${confirm}
        </div>
      </li>`;
    })
    .join("");
  const published = data.articles
    .map((item) => {
      const mine = item.authorId === data.user?.id;
      const open = data.proposals.find((proposal) => proposal.articleId === item.id);
      const href = open ? `/redakce/zpravy?navrh=${open.id}` : `/redakce/zpravy?clanek=${item.id}`;
      return `<li class="card">
        <p class="kicker">${esc(catLabel(ctx.copy, item.category))}${item.authorName ? ` · ${esc(item.authorName)}` : ""}${mine ? " · vaše" : ""}</p>
        <h3>${esc(item.title)}</h3>
        <div class="row"><a class="btn btn-line" href="${href}">${mine ? "Upravit" : "Navrhnout úpravu"}</a></div>
      </li>`;
    })
    .join("");
  const side = `
    <section class="block"><h2>Vaše návrhy</h2>${own ? `<ul class="stack plain">${own}</ul>` : `<p class="card dashed muted">Zatím tu nic nečeká.</p>`}</section>
    <section class="block"><h2>Zprávy na webu</h2><ul class="stack plain">${published}</ul></section>`;
  return adminShell(ctx, data, "zpravy", message, `<div class="split">${form}<div class="stack">${side}</div></div>`);
}

export function adminArticles(ctx, data, message, query = {}) {
  if (data.user?.role === "hlavni") return chiefArticles(ctx, data, message, query);
  return contributorArticles(ctx, data, message, query);
}

export function adminPeople(ctx, data, message, disableId) {
  const list = data.users
    .map((person) => {
      const role = person.role === "hlavni" ? "hlavní redaktor" : "přispěvatel";
      const state = person.active ? "" : " · vypnutý";
      let controls = "";
      if (person.role !== "hlavni") {
        controls = person.active
          ? disableId === person.id
            ? `<form method="post" action="/redakce/lide/stav">
                <input type="hidden" name="id" value="${person.id}">
                <input type="hidden" name="active" value="0">
                <button class="btn btn-primary" type="submit">Opravdu vypnout</button>
              </form>
              <a class="btn btn-ghost" href="/redakce/lide">Nechat</a>`
            : `<a class="btn btn-ghost" href="/redakce/lide?vypnout=${person.id}">Vypnout</a>`
          : `<form method="post" action="/redakce/lide/stav">
              <input type="hidden" name="id" value="${person.id}">
              <input type="hidden" name="active" value="1">
              <button class="btn btn-line" type="submit">Zapnout</button>
            </form>`;
      }
      const password =
        person.role === "hlavni"
          ? ""
          : `<form class="form" method="post" action="/redakce/lide/heslo">
              <input type="hidden" name="id" value="${person.id}">
              ${field("Nové heslo", `<input class="${input}" type="password" name="next" minlength="8" required autocomplete="new-password">`)}
              <button class="btn btn-line" type="submit">Nastavit heslo</button>
            </form>`;
      return `<li class="card">
        <p class="kicker">${role}${state}</p>
        <h3>${esc(person.name)}</h3>
        <p class="muted">${esc(person.login)}</p>
        <div class="row">${controls}</div>
        ${password}
      </li>`;
    })
    .join("");
  const form = `<form class="card form" method="post" action="/redakce/lide/ulozit">
    <h2>Nový přispěvatel</h2>
    <p class="muted">Přispěvatel píše své zprávy a může navrhnout úpravu jiných. Na web se dostanou, až je schválíte. Cizí text přímo nezmění.</p>
    ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" autocomplete="off">`)}
    ${field("Přihlašovací jméno", `<input class="${input}" name="login" required minlength="3" maxlength="32" autocapitalize="none" autocomplete="off">`)}
    <span class="hint">Malá písmena a číslice, bez mezer. Třeba jana.</span>
    ${field("Heslo", `<input class="${input}" type="password" name="password" required minlength="8" autocomplete="new-password">`)}
    <button class="btn btn-primary" type="submit">Přidat</button>
  </form>`;
  return adminShell(ctx, data, "lide", message, `<div class="split">${form}<ul class="stack plain">${list}</ul></div>`);
}

export function adminTexts(ctx, data, message) {
  const groups = [];
  for (const item of COPY) {
    const last = groups.at(-1);
    if (!last || last.name !== item.group) groups.push({ name: item.group, items: [item] });
    else last.items.push(item);
  }
  const blocks = groups
    .map((group) => {
      const fields = group.items
        .map((item) => {
          const value = tx(ctx.copy, item.key);
          const control = item.long
            ? `<textarea class="${input}" name="${item.key}" rows="3" maxlength="${item.max}" required>${esc(value)}</textarea>`
            : `<input class="${input}" name="${item.key}" maxlength="${item.max}" required value="${esc(value)}">`;
          return field(item.label, control);
        })
        .join("");
      return `<h2>${esc(group.name)}</h2>${fields}`;
    })
    .join("");
  const form = `<form class="card form" method="post" action="/redakce/texty/ulozit">
    <h2>Texty webu</h2>
    <p class="muted">Tady se mění nápisy, titulky a odstavce na veřejných stránkách. Samotné zprávy jsou v záložce Zprávy, pozvánky v Akcích. Kontakt na redakci, vysvětlení svozu a poznámka ke svátkům zůstávají u Popelnic. Ve větách odpočtu nechte {n} tam, kde má být počet dní.</p>
    ${blocks}
    <button class="btn btn-primary" type="submit">Uložit texty</button>
  </form>`;
  return adminShell(ctx, data, "texty", message, form);
}

export function adminEvents(ctx, data, message, editingId, confirmId) {
  const editing = data.events.find((item) => item.id === editingId) ?? null;
  const list = data.events.length
    ? data.events
        .map((item) => {
          const confirm =
            confirmId === item.id
              ? `<form method="post" action="/redakce/akce/smazat">
                  <input type="hidden" name="id" value="${item.id}">
                  <input type="hidden" name="confirm" value="1">
                  <button class="btn btn-primary" type="submit">Opravdu smazat</button>
                </form>
                <a class="btn btn-ghost" href="/redakce/akce">Nechat</a>`
              : `<a class="btn btn-ghost" href="/redakce/akce?smazat=${item.id}">Smazat</a>`;
          return `<li class="card">
            <p class="kicker">${esc(formatLong(item.startsOn))}${item.published ? "" : " · skrytá"}</p>
            <h3>${esc(item.title)}</h3>
            <p class="muted">${esc(item.place)}</p>
            <div class="row">
              <a class="btn btn-line" href="/redakce/akce?id=${item.id}">Upravit</a>
              ${confirm}
            </div>
          </li>`;
        })
        .join("")
    : `<li class="card dashed muted">Zatím žádná akce. Přidejte první pozvánku vlevo.</li>`;
  const form = `<form class="card form" method="post" action="/redakce/akce/ulozit">
    <h2>${editing ? "Upravit akci" : "Nová akce"}</h2>
    ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
    ${field("Název", `<input class="${input}" name="title" required maxlength="160" value="${esc(editing?.title ?? "")}">`)}
    ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}">`)}
    <div class="pair">
      ${field("Datum", `<input class="${input}" type="date" name="startsOn" required value="${esc(editing?.startsOn ?? "")}">`)}
      ${field("Čas", `<input class="${input}" type="time" name="startsTime" value="${esc(editing?.startsTime ?? "")}">`)}
    </div>
    ${field("Popis", `<textarea class="${input}" name="description" maxlength="4000" rows="4">${esc(editing?.description ?? "")}</textarea>`)}
    <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
    <div class="row">
      <button class="btn btn-primary" type="submit">Uložit</button>
      ${editing ? `<a class="btn btn-ghost" href="/redakce/akce">Nová</a>` : ""}
    </div>
  </form>`;
  return adminShell(ctx, data, "akce", message, `<div class="split">${form}<ul class="stack plain">${list}</ul></div>`);
}

export function adminSite(ctx, data, message) {
  const waste = data.waste;
  const days = [1, 2, 3, 4, 5, 6, 0]
    .map(
      (day) =>
        `<option value="${day}"${waste.weekday === day ? " selected" : ""}>${weekdayName(day)}</option>`,
    )
    .join("");
  const form = `<form class="card form narrow" method="post" action="/redakce/svoz/ulozit">
    <h2>Popelnice a kontakt</h2>
    <p class="muted">Nejbližší svoz se počítá z tohoto pravidla, stejně jako na popelnice.kopidlenskadrbna.org. Teď vychází na ${esc(formatLong(waste.nextDate))}.</p>
    ${field("Den svozu", `<select class="${input}" name="weekday">${days}</select>`)}
    ${field(
      "Týdny",
      `<select class="${input}" name="weekParity">
        <option value="1"${waste.weekParity === 1 ? " selected" : ""}>Liché kalendářní týdny</option>
        <option value="0"${waste.weekParity === 0 ? " selected" : ""}>Sudé kalendářní týdny</option>
      </select>`,
    )}
    ${field("Opakovat po dnech", `<input class="${input}" type="number" name="stepDays" min="7" max="56" required value="${waste.stepDays}">`)}
    ${field("Vysvětlení na stránce svozu", `<textarea class="${input}" name="wasteNote" rows="4" maxlength="800">${esc(waste.note)}</textarea>`)}
    ${field("Poznámka ke svátkům", `<input class="${input}" name="holidayNote" maxlength="160" value="${esc(waste.holidayNote)}">`)}
    ${field("Kontakt na stránce O nás", `<textarea class="${input}" name="contactNote" rows="3" maxlength="600">${esc(data.contactNote)}</textarea>`)}
    <button class="btn btn-primary" type="submit">Uložit</button>
  </form>`;
  return adminShell(ctx, data, "svoz", message, form);
}

export function adminPassword(ctx, data, message) {
  const form = `<form class="card form narrow" method="post" action="/redakce/jmeno/ulozit">
    <h2>Jméno pod článkem</h2>
    <p class="muted">Tak se podepíšou nové příspěvky. Už zveřejněné zprávy si nechají jméno, se kterým šly ven.</p>
    ${field("Jméno", `<input class="${input}" name="name" required maxlength="60" value="${esc(data.user?.name ?? "")}">`)}
    <button class="btn btn-primary" type="submit">Uložit jméno</button>
  </form>
  <form class="card form narrow" method="post" action="/redakce/heslo/ulozit">
    <h2>Heslo</h2>
    ${field("Současné heslo", `<input class="${input}" type="password" name="current" autocomplete="current-password" required>`)}
    ${field("Nové heslo", `<input class="${input}" type="password" name="next" autocomplete="new-password" minlength="8" required>`)}
    <button class="btn btn-primary" type="submit">Změnit heslo</button>
  </form>`;
  return adminShell(ctx, data, "heslo", message, form);
}

export function brokenPage(message) {
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Kopidlenská drbna</title>
  <body style="font-family:sans-serif;padding:2rem"><h1>Stránka se teď nenačte</h1><p>${esc(message)}</p></body></html>`;
}
