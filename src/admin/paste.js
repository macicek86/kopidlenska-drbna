// Redakce: vložené příspěvky (src/skola/paste.js, paste-run.js). Formulář Vložit příspěvek a okno s konceptem od Drběny:
// náhled, rubrika, fotka ke zprávě, Zveřejnit, Naplánovat, Upravit ručně, Napsat znovu s poznámkou, Zahodit.
import { MODEL } from "../claude.js";
import { formatShort } from "../format.js";
import { DEFAULT_PUBLISH_TIME } from "../publish-time.js";
import { lastPastedFrom, MAX_PASTED_PHOTOS, MAX_PASTED_TEXT } from "../skola/paste.js";
import { shiftDay } from "../skola/defer.js";
import { skolaRunning } from "../skola/store.js";
import { esc, mediaUrl } from "../view.js";
import { pragueNow } from "../waste.js";
import { rubricOptions } from "./article-form.js";
import { madeLinks, queued, refLink, statusBadge, textBlock, workingNote, entryDatesLine } from "./imports.js";
import { stockPicker } from "./stock-pick.js";
import { callout, cancelLink, check, field, formFoot, icon, input } from "./ui.js";

const baseOf = (source) => `/redakce/${source.tag}`;

export function pasteForm(source, entries) {
  const BASE = baseOf(source);
  const today = pragueNow().date;
  return `<form class="form" method="post" action="${BASE}/vlozit" enctype="multipart/form-data">
    ${field("Text příspěvku", `<textarea class="${input}" name="postText" rows="10" maxlength="${MAX_PASTED_TEXT}"></textarea>`, "Zkopírujte celý text. Emoji a hashtagy nevadí, Drběna je vynechá.")}
    ${field("Fotky", `<input class="control" type="file" name="images" multiple accept="image/jpeg,image/png,image/webp,image/gif" data-edge="2400" data-bytes="1500000">`, `Nejvýš ${MAX_PASTED_PHOTOS}. Ke zprávě je vyberete, až bude text hotový.`)}
    ${check("showPhotos", "1", false, "Ukázat fotky Drběně", "Jen když je na plakátu něco, co v textu chybí (den, čas, místo). Každá fotka stojí zhruba tolik jako celý text příspěvku.")}
    ${field("Odkud", `<input class="${input}" name="postFrom" maxlength="80" value="${esc(lastPastedFrom(source, entries))}">`, "Napíše se pod zprávu jako zdroj.")}
    ${field("Odkaz na příspěvek", `<input class="${input}" type="url" name="postLink" placeholder="https://www.facebook.com/…">`, "Nepovinný. Když ho vyplníte, bude zdroj pod zprávou odkazem.")}
    ${field("Den zveřejnění", `<input class="${input}" type="date" name="postDate" max="${today}" value="${today}">`, "Podle něj Drběna dopočítá rok a pozná, co je „zítra“.")}
    ${formFoot("Napsat článek", cancelLink(BASE))}
  </form>`;
}

export function pastedStatusPanel(source, data, settings, entries) {
  const keyWarn = data.hasApiKey ? "" : callout("Chybí klíč pro Claude. Nastavíte ho příkazem <code>npx wrangler secret put ANTHROPIC_API_KEY</code>. Do té doby příspěvky počkají.", "warn");
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("plus")}</span>
      <div>
        <p class="status-main">Nic nejde na web samo.</p>
        <p class="status-sub">Drběna napíše koncept, vy ho zveřejníte, naplánujete, nebo zahodíte. Model ${esc(MODEL)}.</p>
      </div>
    </div>
    ${workingNote({ base: baseOf(source), running: skolaRunning(settings), entries, enabled: true, busy: "Drběna píše. Jeden příspěvek jí trvá asi půl minuty." })}
    ${keyWarn}
  </section>`;
}

function hidden(entry) {
  return `<input type="hidden" name="id" value="${entry.id}">`;
}

function draftPreview(draft) {
  const { article, event, target } = draft;
  const when = event ? [formatShort(event.startsOn), event.startsTime, event.place].filter(Boolean).join(", ") : "";
  return `<div class="paste-preview">
    ${target ? `<p class="item-sub">Navazuje na zprávu ${refLink(`zprava:${target.id}`)}: ${esc(target.title)}</p>` : ""}
    <h3 class="paste-title">${esc(article.title)}</h3>
    <p class="paste-lede">${esc(article.excerpt)}</p>
    <div class="paste-body">${article.body}</div>
  </div>
  ${event ? `<p>Do kalendáře: <b>${esc(event.title)}</b>${when ? ` (${esc(when)})` : ""}</p>` : ""}`;
}

function photoChoices(source, entry, data) {
  const topic = entry.draft.article.imageTopic;
  const first = entry.keptImages.length ? `vlozena:${entry.keptImages[0]}` : topic ? "tema" : "bez";
  const radio = (value, label) => `<label class="check"><input type="radio" name="photoChoice" value="${esc(value)}"${value === first ? " checked" : ""}> <span>${label}</span></label>`;
  const own = entry.keptImages.length
    ? `<div class="stock-pick-grid">${entry.keptImages
        .map(
          (key, index) => `<label class="stock-option"><input type="radio" name="photoChoice" value="vlozena:${esc(key)}"${index === 0 ? " checked" : ""}>
            <img src="${mediaUrl(key)}" alt="Vložená fotka ${index + 1}" loading="lazy"></label>`,
        )
        .join("")}</div>`
    : "";
  return `<fieldset class="paste-photo">
    <legend>Fotka ke zprávě</legend>
    ${own}
    ${topic ? radio("tema", "Ilustrační z knihovny podle tématu, které navrhla Drběna") : ""}
    ${radio("bez", "Bez fotky")}
    ${field("Popisek fotky", `<input class="${input}" name="photoCaption" maxlength="200">`, `K vložené nebo nahrané fotce. „foto: ${esc(entry.section || source.defaultFrom)}“ se doplní samo.`)}
    ${field("Nahrát jinou", `<input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">`, "Nahraná fotka má přednost.")}
    ${stockPicker(data.stock)}
  </fieldset>`;
}

function publishForm(source, entry, data) {
  const BASE = baseOf(source);
  const rubric = (data.rubrics ?? []).find((row) => row.slug === entry.draft.article.rubric);
  const tomorrow = shiftDay(pragueNow().date, 1);
  return `<form class="form" method="post" action="${BASE}/vysledek" enctype="multipart/form-data">
    ${hidden(entry)}
    ${field("Rubrika", `<select class="${input}" name="rubric_id">${rubricOptions(data.rubrics, rubric ? { rubricId: rubric.id } : {})}</select>`)}
    ${photoChoices(source, entry, data)}
    <div class="pair">
      ${field("Naplánovat na den", `<input class="${input}" type="date" name="publishDate" min="${pragueNow().date}" value="${tomorrow}">`)}
      ${field("V kolik", `<input class="${input}" type="time" name="publishTime" value="${DEFAULT_PUBLISH_TIME}">`, "Platí jen pro Naplánovat.")}
    </div>
    <div class="form-foot">
      <button class="btn btn-line" type="submit" name="pasteAction" value="upravit" data-busy="Ukládám…">Upravit ručně</button>
      <span class="form-foot-gap"></span>
      <button class="btn btn-line" type="submit" name="pasteAction" value="naplanovat" data-busy="Plánuji…">Naplánovat</button>
      <button class="btn btn-primary" type="submit" name="pasteAction" value="zverejnit" data-busy="Zveřejňuji…">Zveřejnit</button>
    </div>
  </form>`;
}

// Napsat znovu s poznámkou. U duplicity se zprávou jde napsat navazující, nebo samostatnou.
function redoForm(source, entry, { open = false } = {}) {
  const BASE = baseOf(source);
  const follow = /^zprava:\d+$/.test(entry.duplicateOf) && entry.status === "duplicita";
  const buttons = follow
    ? `<button class="btn btn-line" type="submit" name="pasteAction" value="nova" data-busy="Posílám Drběně…">Přesto napsat novou zprávu</button>
       <button class="btn btn-primary" type="submit" name="pasteAction" value="navazat" data-busy="Posílám Drběně…">Napsat jako navazující</button>`
    : `<button class="btn btn-primary" type="submit" name="pasteAction" value="${entry.status === "napsano" ? "" : "nova"}" data-busy="Posílám Drběně…">Napsat znovu</button>`;
  return `<details class="paste-redo"${open ? " open" : ""}>
    <summary>${["duplicita", "preskoceno"].includes(entry.status) ? "Přesto napsat" : "Napsat znovu"}</summary>
    <form class="form" method="post" action="${BASE}/znovu">
      ${hidden(entry)}
      ${field("Co Drběně doplnit nebo změnit", `<textarea class="${input}" name="redoNote" rows="3" maxlength="1000" placeholder="Třeba: pergola má být hotová v listopadu. Piš kratší."></textarea>`, entry.draft ? "Nepovinné. Současná verze zůstane, půjde k ní vrátit." : "Nepovinné.")}
      <div class="form-foot"><span class="form-foot-gap"></span>${buttons}</div>
    </form>
  </details>`;
}

function restoreForm(source, entry) {
  if (!entry.previousDraft) return "";
  return `<form class="paste-restore" method="post" action="${baseOf(source)}/vratit">${hidden(entry)}
    <span class="item-sub">Předchozí verze: ${esc(entry.previousDraft.article.title)}</span>
    <button class="btn btn-sm btn-line" type="submit">Vrátit předchozí verzi</button></form>`;
}

function discardForm(source, entry) {
  if (["hotovo", "zruseno"].includes(entry.status)) return "";
  return `<form method="post" action="${baseOf(source)}/zahodit">${hidden(entry)}<button class="btn btn-danger-text" type="submit" data-busy="Zahazuji…">Zahodit</button></form>`;
}

function original(entry) {
  return `<details class="paste-source"><summary>Vložený příspěvek</summary>
    <div class="import-source">${textBlock(entry.text)}</div>
    ${entry.link ? `<p class="item-sub"><a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Původní příspěvek</a></p>` : ""}
  </details>`;
}

export function pastedDetail(source, entry, data) {
  const BASE = baseOf(source);
  const head = `<p class="item-badges">${statusBadge(entry)}${entryDatesLine(entry, undefined, "vloženo")}<span class="item-sub">${esc(entry.section)}${entry.showPhotos ? " · fotky Drběna viděla" : ""}</span></p>`;
  const reason = entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : "";
  const foot = (extra = "") => `<div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${extra}${discardForm(source, entry)}</div>`;
  if (queued(entry)) {
    const retry = entry.status === "chyba" ? `${reason}<p>Drběna to zkusí znovu.</p>` : "";
    return `<div class="import-detail">${head}${retry}${callout("Drběna píše. Nechte okno otevřené, výsledek se ukáže sám.", "info")}${original(entry)}${foot()}</div>`;
  }
  if (entry.status === "napsano" && entry.draft) {
    return `<div class="import-detail">${head}${reason}${draftPreview(entry.draft)}${restoreForm(source, entry)}
      ${publishForm(source, entry, data)}${redoForm(source, entry)}${original(entry)}${foot()}</div>`;
  }
  if (entry.status === "hotovo") {
    const made = madeLinks(entry);
    return `<div class="import-detail">${head}${reason}${made.length ? `<p>Vzniklo: ${made.join(" · ")}</p>` : ""}${original(entry)}${foot()}</div>`;
  }
  if (entry.status === "zruseno") return `<div class="import-detail">${head}${original(entry)}${foot()}</div>`;
  const duplicate = entry.duplicateOf ? `<p>Stejná věc už je tady: ${refLink(entry.duplicateOf)}</p>` : "";
  return `<div class="import-detail">${head}${reason}${duplicate}${redoForm(source, entry, { open: true })}${original(entry)}${foot()}</div>`;
}
