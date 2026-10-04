// Formulář zprávy v redakci: pole zprávy, rubrika, fotka a schválení návrhu.
import { ASSIST_MODES } from "../assist/ai.js";
import { ASSIST_PERMISSION } from "../assist/store.js";
import { userCan } from "../db-core.js";
import { formatShort } from "../format.js";
import { pragueNow } from "../waste.js";
import { prepareArticleBody } from "../rich.js";
import { rubricsFrom } from "../rubrics.js";
import { MAX_ATTACHMENTS } from "../attachments.js";
import { mediaUrl } from "../html.js";
import { credit, esc } from "../view.js";
import { photoField } from "./photo-field.js";
import { stockPicker } from "./stock-pick.js";
import { callout, cancelLink, check, field, formFoot, hidden, input, modalLink } from "./ui.js";

export const BASE = "/redakce/zpravy";

function rubricChosen(rubric, source, list) {
  if (source?.rubricId) return rubric.id === Number(source.rubricId);
  if (source?.category) return rubric.name === source.category;
  const first = list.find((row) => !row.parentId);
  return first?.id === rubric.id;
}

export function rubricOptions(rubrics, source) {
  const all = Array.isArray(rubrics) ? rubrics : rubricsFrom({});
  const parts = [];
  for (const top of all.filter((row) => !row.parentId)) {
    const children = all.filter((row) => row.parentId === top.id);
    const topOption = `<option value="${top.id}"${rubricChosen(top, source, all) ? " selected" : ""}>${esc(top.name)}</option>`;
    if (!children.length) {
      parts.push(topOption);
      continue;
    }
    parts.push(`<optgroup label="${esc(top.name)}">`, topOption);
    for (const child of children) {
      parts.push(`<option value="${child.id}"${rubricChosen(child, source, all) ? " selected" : ""}>${esc(child.name)}</option>`);
    }
    parts.push("</optgroup>");
  }
  return parts.join("");
}

export function photoControl(source, stock = null) {
  return `${photoField(source, {
    hint: "Před odesláním se v prohlížeči zmenší. Stačí fotka z mobilu.",
    previews: [
      { crop: "list", label: "Přehled zpráv" },
      { crop: "wide", label: "Mobil a titulka" },
    ],
    note: "Ve zprávě samotné bude fotka vidět celá.",
    extra: stockPicker(stock),
  })}
  ${field(
    "Popisek fotky",
    `<input class="${input}" name="image_caption" maxlength="200" value="${esc(source?.imageCaption ?? "")}" placeholder="Foto: Jana Nováková">`,
    "Nepovinné. Kdo fotil nebo co je na fotce. Ukáže se pod fotkou ve zprávě.",
  )}`;
}

// Přílohy pod zprávou (jízdní řád, mapa, plakát): od Drběny ze zdroje, nebo je nahraje, kdo zprávu píše.
// Odškrtnutá se po uložení smaže. Popisky nových příloh doplní public/editor.js, bez JS se dají dopsat po uložení.
const ATTACHMENT_LIMITS = 'data-edge="2400" data-bytes="1500000"';

function attachmentsControl(source) {
  const list = source?.attachments ?? [];
  const items = list
    .map(
      (item) => `<li class="attachment-pick">
          <input type="checkbox" name="keep_attachment" value="${esc(item.key)}" checked aria-label="Nechat přílohu">
          <a href="${mediaUrl(item.key)}" target="_blank" rel="noopener"><img src="${mediaUrl(item.key)}" alt="" loading="lazy"></a>
          ${hidden("attachment_key", item.key)}
          <input class="${input}" name="attachment_caption" maxlength="200" value="${esc(item.caption)}" placeholder="Popisek" aria-label="Popisek přílohy">
        </li>`,
    )
    .join("");
  return `<div class="field" data-attachments><span>Přílohy</span>
      ${hidden("attachments_shown", "1")}
      ${list.length ? `<ul class="plain attachment-picks">${items}</ul>` : ""}
      <input class="control" type="file" name="attachment_files" multiple accept="image/jpeg,image/png,image/webp,image/gif" ${ATTACHMENT_LIMITS}>
      <ul class="plain attachment-picks" data-attachment-new></ul>
      <span class="hint">Obrázky, které si čtenář prohlédne sám: jízdní řád, mapa, plakát. Ukážou se pod zprávou, nejvýš ${MAX_ATTACHMENTS}.${list.length ? " Odškrtnutá příloha se po uložení smaže." : ""}</span>
    </div>`;
}

function richTextField(body) {
  const html = prepareArticleBody(body).html;
  return `<div class="field field-rich"><span>Text</span>
    <div class="rich">
      <textarea class="control" name="body" maxlength="20000" rows="12" hidden>${esc(html)}</textarea>
    </div>
    <span class="hint">Nadpisy, seznamy, tučné, kurzíva, podtržení, citace a odkazy. Adresa začíná na https://, http://, mailto: nebo /.</span>
  </div>`;
}

// Datum zprávy: u zprávy hlavního redaktora a při schválení nového příspěvku. Datum v budoucnu je plánované zveřejnění.
function dateField(value, hint = "") {
  return field(
    "Datum zprávy",
    `<input class="${input}" type="date" name="created_on" required value="${esc(value)}">`,
    `${hint}Podle něj se zprávy řadí. Datum v budoucnu: zpráva se na webu ukáže až ten den.`,
  );
}

// Pomocník při psaní (public/assist.js): Drběna přepíše, co je v polích, nebo to jen učeše. Bez JS se neukáže.
// Jeden řádek nad Nadpisem, nápověda se ukáže po ťuknutí na „i“, stav až po použití.
function assistBar(user) {
  if (!userCan(user, ASSIST_PERMISSION)) return "";
  const buttons = Object.entries(ASSIST_MODES)
    .map(([mode, label]) => `<button class="assist-link" type="button" data-assist-run="${mode}">${esc(label)}</button>`)
    .join("");
  return `<div class="assist" data-assist hidden>
      <img class="assist-face" src="/drbena-uvitani.webp" alt="" width="28" height="28">
      <div class="assist-actions">${buttons}<button class="assist-link assist-undo" type="button" data-assist-undo hidden>Vrátit můj text</button></div>
      <button class="assist-info" type="button" data-assist-info aria-expanded="false" aria-label="Jak pomocník funguje">i</button>
      <p class="assist-hint" data-assist-hint hidden>Napište, co víte, klidně jen v bodech. Drběna z toho udělá zprávu a navrhne rubriku i fotku. Nic se neuloží, dokud nedáte Uložit.</p>
      <p class="assist-status" data-assist-status role="status" aria-live="polite"></p>
    </div>`;
}

export function articleFields(source, data, { publish, date } = {}) {
  return `<div class="form-cols">
    <div class="form-col-main">
      ${assistBar(data.user)}
      ${field("Nadpis", `<input class="${input} control-lg" name="title" required maxlength="160" value="${esc(source?.title ?? "")}">`)}
      ${field("Perex", `<textarea class="${input}" name="excerpt" required maxlength="320" rows="3" data-count>${esc(source?.excerpt ?? "")}</textarea>`, "Krátké shrnutí do přehledu zpráv. Nejvýš 320 znaků.")}
      ${richTextField(source?.body ?? "")}
    </div>
    <div class="form-col-side">
      ${field("Rubrika", `<select class="${input}" name="rubric_id">${rubricOptions(data.rubrics, source)}</select>`, "Podrubrika je pod svou rubrikou, třeba Fotbal pod Sportem.")}
      ${photoControl(source, data.stock)}
      ${attachmentsControl(source)}
      ${publish ? `<div class="field"><span>Viditelnost</span>${check("published", "1", publish.checked, "Zveřejnit na webu")}</div>` : ""}
      ${publish ? dateField(source?.createdOn || publish.today) : ""}
      ${date ? dateField(date.value, date.hint) : ""}
    </div>
  </div>`;
}

function proposalDate(proposal) {
  if (proposal.publishOn) return { value: proposal.publishOn, hint: "Předvyplněné datum ze zdroje. " };
  return { value: pragueNow().date };
}

export function proposalKind(proposal) {
  return proposal.articleId ? "Návrh úpravy" : "Nový příspěvek";
}

// Schválení návrhu. Přispěvatel s oprávněním `drbena_navrhy` (`chief: false`) návrh od Drběny
// jen upraví a schválí, vrátit ani smazat ho nemůže.
export function reviewForm(data, proposal, { chief = true } = {}) {
  const intro = chief
    ? `Autor na webu: <b>${esc(credit(proposal))}</b>. Text můžete před schválením upravit, typicky češtinu. Ven se neukáže, co se měnilo. Když se znění liší od návrhu, u autora bude nanejvýš slovo Redigováno.`
    : `Článek napsala <b>${esc(credit(proposal))}</b>. Opravte, co je potřeba, a schvalte. Půjde na web hned. Nepovedený nechte ležet, rozhodne o něm hlavní redaktor.`;
  const extra = chief
    ? `<button class="btn btn-line" type="button" data-toggle="vratit-${proposal.id}">Vrátit autorovi…</button>
        ${modalLink(`${BASE}?smazat-navrh=${proposal.id}`, "Smazat", "btn-ghost btn-danger-text")}`
    : cancelLink(BASE);
  // Návrh úpravy z doby před přílohami od lidí: ukáže přílohy zprávy (src/proposals-db.js).
  const linked = proposal.ownAttachments ? null : data.articles?.find((row) => row.id === proposal.articleId);
  const source = linked ? { ...proposal, attachments: linked.attachments } : proposal;
  const form = `<form class="form" method="post" action="${BASE}/schvalit" enctype="multipart/form-data">
      ${callout(`${intro}${
        proposal.articleTitle ? `<br>Ke zprávě: <b>${esc(proposal.articleTitle)}</b>` : ""
      }${
        !chief && proposal.publishOn && !proposal.articleId ? `<br>Vyjde s datem ze zdroje: <b>${esc(formatShort(proposal.publishOn))}</b>` : ""
      }`)}
      ${hidden("id", proposal.id)}
      ${articleFields(source, data, { date: chief && !proposal.articleId ? proposalDate(proposal) : null })}
      ${formFoot("Schválit a zveřejnit", extra)}
    </form>`;
  if (!chief) return form;
  return `${form}
    <form class="form return-form" id="vratit-${proposal.id}" method="post" action="${BASE}/vratit" data-toggled>
      ${hidden("id", proposal.id)}
      ${field("Poznámka pro autora", `<textarea class="${input}" name="note" maxlength="400" rows="3" placeholder="Co má dopracovat. Může zůstat prázdné."></textarea>`)}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-line" type="submit">Vrátit</button></div>
    </form>`;
}
