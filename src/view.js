import { CATEGORIES, POPELNICE_URL } from "./db.js";
import { countdownLabel, formatDayMonth, formatLong, formatShort, ruleLabel, weekdayName } from "./format.js";

const NAV = [
  ["/zpravy", "Zprávy"],
  ["/akce", "Akce"],
  ["/popelnice", "Popelnice"],
  ["/o-nas", "O nás"],
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

export function layout({ title, description, path, minimal, mainOrigin, body }) {
  const brandHref = minimal ? "/popelnice" : "/";
  const brandImg = minimal ? "/kozel-popelar.webp" : "/kozel-maskot.webp";
  const links = NAV.map(
    ([href, label]) =>
      `<a class="nav-link${active(path, href)}" href="${href}">${label}</a>`,
  ).join("");
  const headerNav = minimal
    ? `<a class="btn btn-line" href="${esc(mainOrigin)}">Celé noviny</a>`
    : `<nav class="nav" aria-label="Hlavní">${links}</nav>
       <details class="mobile-nav">
         <summary>Menu</summary>
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
    <a class="skip" href="#obsah">Přeskočit na obsah</a>
    <header class="top">
      <a class="brand" href="${brandHref}">
        <img src="${brandImg}" alt="">
        <span>Kopidlenská<span>drbna</span></span>
      </a>
      ${headerNav}
    </header>
    <main id="obsah">${body}</main>
    <footer>
      <p>© 2026 Kopidlenská drbna</p>
      <p class="fine">Neoficiální informační stránka — není provozována Městem Kopidlno.</p>
      ${minimal ? "" : `<a href="/redakce">Redakce</a>`}
    </footer>
  </div>
</body>
</html>`;
}

function note(message, kind) {
  if (!message) return "";
  return `<p class="note ${kind === "ok" ? "note-ok" : "note-bad"}" role="status">${esc(message)}</p>`;
}

export function homePage(data, ctx) {
  const lead = data.articles[0];
  const rest = data.articles.slice(1, 4);
  const upcoming = data.events.filter((event) => event.startsOn >= data.waste.today).slice(0, 3);
  const leadHtml = lead
    ? `<a class="card card-lead" href="/zpravy/${esc(lead.slug)}">
        ${lead.imageKey ? `<img class="cover" src="${mediaUrl(lead.imageKey)}" alt="">` : ""}
        <p class="kicker">${esc(lead.category)}</p>
        <h3>${esc(lead.title)}</h3>
        <p class="muted">${esc(lead.excerpt)}</p>
        <p class="meta">${esc(formatDayMonth(lead.createdOn))}</p>
      </a>`
    : `<p class="card muted">Zatím tu není žádná zpráva.</p>`;
  const restHtml = rest
    .map(
      (article) => `<a class="card card-side" href="/zpravy/${esc(article.slug)}">
        <p class="kicker">${esc(article.category)}</p>
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
    : `<p class="card dashed muted">Zatím tu není zveřejněná pozvánka. Až ji redakce přidá, objeví se tady.</p>`;

  return layout({
    ...ctx,
    title: "Kopidlenská drbna",
    description: "Místní zprávy, pozvánky a svoz popelnic pro Kopidlno a jeho části.",
    body: `
      <section class="hero">
        <div class="mascot">
          <span class="sun" aria-hidden="true"></span>
          <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z"/></svg>
          <img src="/kozel-maskot.webp" alt="Maskot Kopidlenské drbny, černobílý kozel">
        </div>
        <div>
          <p class="pill">Kopidlno a jeho části</p>
          <h1>Kopidlenská<span>drbna</span></h1>
          <p class="lede">Místní zprávy, pozvánky a sousedské novinky z Kopidlna, Drahorazi, Mlýnce, Pševesi a Ledkova. Neúřední, přehledné a odsud.</p>
          <div class="card waste-teaser">
            <p class="eyebrow">Popelnice</p>
            <p class="date">${esc(formatLong(data.waste.nextDate))}</p>
            <p class="count">${esc(countdownLabel(data.waste.daysUntil))}</p>
            <div class="row">
              <a class="btn btn-primary" href="/popelnice">Kdy se sváží</a>
              <a class="btn btn-line" href="${POPELNICE_URL}" target="_blank" rel="noreferrer">popelnice.kopidlenskadrbna.org</a>
            </div>
          </div>
        </div>
      </section>
      <section class="block">
        <div class="section-head"><h2>Zprávy</h2><a href="/zpravy">Všechny</a></div>
        <div class="news-grid">${leadHtml}<div class="stack">${restHtml}</div></div>
      </section>
      <section class="block">
        <div class="section-head"><h2>Akce</h2><a href="/akce">Kalendář</a></div>
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
      return `<a class="chip${filter === category ? " is-on" : ""}" href="${href}">${esc(category)}</a>`;
    })
    .join("");
  const list = visible.length
    ? visible
        .map(
          (article) => `<a class="card story" href="/zpravy/${esc(article.slug)}">
            ${article.imageKey ? `<img class="cover" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
            <p class="kicker">${esc(article.category)}</p>
            <h2>${esc(article.title)}</h2>
            <p class="muted">${esc(article.excerpt)}</p>
            <p class="meta">${esc(formatDayMonth(article.createdOn))}</p>
          </a>`,
        )
        .join("")
    : `<p class="muted">V téhle rubrice zatím nic není.</p>`;
  return layout({
    ...ctx,
    title: "Zprávy | Kopidlenská drbna",
    description: "Místní zprávy z Kopidlna a jeho částí.",
    body: `<p class="eyebrow">Rubrika</p><h1>Zprávy</h1><div class="chips">${chips}</div><div class="stack">${list}</div>`,
  });
}

export function articlePage(article, ctx) {
  return layout({
    ...ctx,
    title: `${article.title} | Kopidlenská drbna`,
    description: article.excerpt,
    body: `
      <a class="back" href="/zpravy">Zpět na zprávy</a>
      <p class="eyebrow">${esc(article.category)}</p>
      <h1 class="article-title">${esc(article.title)}</h1>
      <p class="meta">${esc(formatLong(article.createdOn))}</p>
      ${article.imageKey ? `<img class="article-photo" src="${mediaUrl(article.imageKey)}" alt="">` : ""}
      <div class="prose">${paragraphs(article.body)}</div>`,
  });
}

export function missingPage(ctx) {
  return layout({
    ...ctx,
    title: "Zpráva nenalezena | Kopidlenská drbna",
    description: "Tahle zpráva tu není.",
    body: `<h1>Tahle zpráva tu není</h1><a class="back" href="/zpravy">Zpět na zprávy</a>`,
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
    title: "Akce | Kopidlenská drbna",
    description: "Pozvánky z Kopidlna a okolních částí.",
    body: `
      <p class="eyebrow">Kalendář</p>
      <h1>Akce</h1>
      <p class="lede">Pozvánky z Kopidlna a okolních částí. Co tu není, redakce ještě nepřidala.</p>
      ${eventList("Chystá se", upcoming, "Žádná zveřejněná pozvánka. Až bude, objeví se tady.")}
      ${past.length ? eventList("Už proběhlo", past, "") : ""}`,
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
    title: standaloneTitle ? "Popelnice | Kopidlenská drbna" : "Kdy se sváží | Kopidlenská drbna",
    description: "Nejbližší svoz směsného odpadu v Kopidlně.",
    minimal: ctx.minimal,
    body: `
      <section class="bins">
        <div class="card bin-copy">
          <p class="pill">Nejbližší svoz</p>
          <h1>${esc(formatLong(waste.nextDate))}</h1>
          <p class="count">${esc(countdownLabel(waste.daysUntil))}</p>
          <p class="muted">${esc(waste.note)}</p>
          <p class="rule">${esc(ruleLabel(waste))}</p>
          <div class="row">
            <span class="chip">${esc(waste.holidayNote)}</span>
            <span class="chip">Směsný komunální odpad</span>
          </div>
          ${
            showExternal
              ? `<a class="back" href="${POPELNICE_URL}" target="_blank" rel="noreferrer">popelnice.kopidlenskadrbna.org</a>`
              : ""
          }
        </div>
        <div class="bin-photo"><img src="/kozel-popelar.webp" alt="Kozel v montérkách s popelnicí na kopidlenském náměstí"></div>
      </section>
      <section class="card block">
        <h2>Další termíny</h2>
        <div class="dates">${dates}</div>
      </section>`,
  });
}

export function aboutPage(data, ctx) {
  return layout({
    ...ctx,
    title: "O nás | Kopidlenská drbna",
    description: "Sousedská, ne úřední stránka pro Kopidlno a jeho části.",
    body: `
      <section class="about">
        <img src="/kozel-maskot.webp" alt="Maskot Kopidlenské drbny">
        <div>
          <p class="eyebrow">O stránce</p>
          <h1>Sousedská, ne úřední</h1>
          <p class="lede">Kopidlenská drbna je místní noviny pro Kopidlno, Drahoraz, Mlýnec, Pševes a Ledkov. Píšeme zprávy, pozvánky a praktické věci, hlavně kdy vyvézt popelnici.</p>
          <p>Stránku neprovozuje Město Kopidlno. Vyhlášky, poplatky a úřední oznámení berte vždy z webu města.</p>
          <p>${esc(data.contactNote)}</p>
          <div class="row links">
            <a href="/popelnice">Svoz popelnic</a>
            <a href="${POPELNICE_URL}" target="_blank" rel="noreferrer">popelnice.kopidlenskadrbna.org</a>
          </div>
        </div>
      </section>`,
  });
}

function photoControl(editing) {
  const preview = editing?.imageKey
    ? `<img class="thumb" src="${mediaUrl(editing.imageKey)}" alt="">`
    : `<span class="hint">Uloží se do R2 bucketu. JPG, PNG, WEBP nebo GIF, nejvýš 4 MB.</span>`;
  return `<input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">${preview}`;
}

function field(label, control) {
  return `<label class="field"><span>${label}</span>${control}</label>`;
}

const input = "control";

function adminShell(ctx, data, tab, message, inner) {
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
          <p class="muted">Sem se dostane jen ten, kdo stránku vede. Návštěvníci obsah jen čtou.</p>
          ${
            data.showDefaultPassword
              ? `<p class="banner">Výchozí heslo je Drbna2026. Po přihlášení si ho změňte.</p>`
              : ""
          }
          <form method="post" action="/redakce/prihlasit">
            ${field("Heslo", `<input class="${input}" type="password" name="password" autocomplete="current-password" required>`)}
            <button class="btn btn-primary" type="submit">Vstoupit</button>
            ${note(message, "bad")}
          </form>
        </section>`,
    });
  }

  const tabs = [
    ["/redakce/zpravy", "zpravy", "Zprávy"],
    ["/redakce/akce", "akce", "Akce"],
    ["/redakce/svoz", "svoz", "Popelnice a kontakt"],
    ["/redakce/heslo", "heslo", "Heslo"],
  ]
    .map(
      ([href, id, label]) =>
        `<a class="btn ${tab === id ? "btn-ink" : "btn-line"}" href="${href}">${label}</a>`,
    )
    .join("");
  return layout({
    ...ctx,
    path: "/redakce",
    title: "Redakce | Kopidlenská drbna",
    description: "Redakce Kopidlenské drbny.",
    body: `
      <div class="admin-head">
        <div><p class="eyebrow">Administrace</p><h1>Redakce</h1></div>
        <form method="post" action="/redakce/odhlasit"><button class="btn btn-line" type="submit">Odhlásit</button></form>
      </div>
      ${data.showDefaultPassword ? `<p class="banner">Pořád platí výchozí heslo. V záložce Heslo si nastavte vlastní.</p>` : ""}
      <div class="row">${tabs}</div>
      ${note(message, message?.startsWith("Heslo nesedí") || message?.startsWith("Doplňte") || message?.startsWith("Nové") || message?.startsWith("Současné") || message?.startsWith("Fotka") || message?.startsWith("Interval") || message?.startsWith("Vyberte") || message?.startsWith("Přihlaste") ? "bad" : "ok")}
      ${inner}`,
  });
}

export function adminArticles(ctx, data, message, editingId, confirmId) {
  const editing = data.articles.find((item) => item.id === editingId) ?? null;
  const options = CATEGORIES.map(
    (category) =>
      `<option${editing?.category === category || (!editing && category === "Zprávy") ? " selected" : ""}>${esc(category)}</option>`,
  ).join("");
  const list = data.articles
    .map((item) => {
      const confirm =
        confirmId === item.id
          ? `<form method="post" action="/redakce/zpravy/smazat">
              <input type="hidden" name="id" value="${item.id}">
              <input type="hidden" name="confirm" value="1">
              <button class="btn btn-primary" type="submit">Opravdu smazat</button>
            </form>
            <a class="btn btn-ghost" href="/redakce/zpravy">Nechat</a>`
          : `<a class="btn btn-ghost" href="/redakce/zpravy?smazat=${item.id}">Smazat</a>`;
      return `<li class="card">
        <p class="kicker">${esc(item.category)}${item.published ? "" : " · skrytá"}</p>
        <h3>${esc(item.title)}</h3>
        <div class="row">
          <a class="btn btn-line" href="/redakce/zpravy?id=${item.id}">Upravit</a>
          ${confirm}
        </div>
      </li>`;
    })
    .join("");
  const form = `<form class="card form" method="post" action="/redakce/zpravy/ulozit" enctype="multipart/form-data">
    <h2>${editing ? "Upravit zprávu" : "Nová zpráva"}</h2>
    ${editing ? `<input type="hidden" name="id" value="${editing.id}">` : ""}
    ${field("Nadpis", `<input class="${input}" name="title" required maxlength="160" value="${esc(editing?.title ?? "")}">`)}
    ${field("Perex", `<textarea class="${input}" name="excerpt" required maxlength="320" rows="3">${esc(editing?.excerpt ?? "")}</textarea>`)}
    ${field("Text", `<textarea class="${input}" name="body" required maxlength="12000" rows="8">${esc(editing?.body ?? "")}</textarea>`)}
    ${field("Rubrika", `<select class="${input}" name="category">${options}</select>`)}
    ${field("Fotka", photoControl(editing))}
    <label class="check"><input type="checkbox" name="published" value="1"${editing ? (editing.published ? " checked" : "") : " checked"}> Zveřejnit</label>
    <div class="row">
      <button class="btn btn-primary" type="submit">Uložit</button>
      ${editing ? `<a class="btn btn-ghost" href="/redakce/zpravy">Nová</a>` : ""}
    </div>
  </form>`;
  return adminShell(
    ctx,
    data,
    "zpravy",
    message,
    `<div class="split">${form}<ul class="stack plain">${list}</ul></div>`,
  );
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
  const form = `<form class="card form narrow" method="post" action="/redakce/heslo/ulozit">
    <h2>Heslo redakce</h2>
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
