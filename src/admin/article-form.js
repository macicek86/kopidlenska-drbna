// Formulář zprávy v redakci: pole zprávy, rubrika, fotka a schválení návrhu.
import { formatShort } from "../format.js";
import { readFocus } from "../photo.js";
import { prepareArticleBody } from "../rich.js";
import { rubricsFrom } from "../rubrics.js";
import { credit, esc, mediaUrl } from "../view.js";
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
  const current = source?.imageKey ? mediaUrl(source.imageKey) : "";
  const now = current
    ? `<figure class="photo-now" data-photo-now><img src="${current}" alt=""><figcaption>Současná fotka. Nová ji nahradí.</figcaption></figure>`
    : "";
  return `<div class="field photo-field" data-photo${current ? ` data-current="${esc(current)}"` : ""}>
    <span>Fotka</span>
    ${now}
    <input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif">
    <span class="hint">Před odesláním se v prohlížeči zmenší. Stačí fotka z mobilu.</span>
    <input type="hidden" name="image_focus" value="${esc(readFocus(source?.imageFocus))}" data-photo-focus>
    <div class="photo-pick" data-photo-pick hidden>
      <p class="photo-pick-title">Ťukněte na to, co má být vidět</p>
      <div class="photo-pick-full" data-photo-full tabindex="0" role="button" aria-label="Místo, které má zůstat vidět. Posunete ho i šipkami.">
        <img alt="" data-photo-src>
        <span class="photo-dot" data-photo-dot></span>
      </div>
      <div class="photo-pick-previews">
        <figure><div class="photo-crop photo-crop-list"><img alt="" data-photo-src data-photo-crop></div><figcaption>Přehled zpráv</figcaption></figure>
        <figure><div class="photo-crop photo-crop-wide"><img alt="" data-photo-src data-photo-crop></div><figcaption>Mobil a titulka</figcaption></figure>
      </div>
      <p class="hint">Ve zprávě samotné bude fotka vidět celá.</p>
    </div>
    ${stockPicker(stock)}
  </div>
  ${field(
    "Popisek fotky",
    `<input class="${input}" name="image_caption" maxlength="200" value="${esc(source?.imageCaption ?? "")}" placeholder="Foto: Jana Nováková">`,
    "Nepovinné. Kdo fotil nebo co je na fotce. Ukáže se pod fotkou ve zprávě.",
  )}`;
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

export function articleFields(source, data, { publish } = {}) {
  return `<div class="form-cols">
    <div class="form-col-main">
      ${field("Nadpis", `<input class="${input} control-lg" name="title" required maxlength="160" value="${esc(source?.title ?? "")}">`)}
      ${field("Perex", `<textarea class="${input}" name="excerpt" required maxlength="320" rows="3" data-count>${esc(source?.excerpt ?? "")}</textarea>`, "Krátké shrnutí do přehledu zpráv. Nejvýš 320 znaků.")}
      ${richTextField(source?.body ?? "")}
    </div>
    <div class="form-col-side">
      ${field("Rubrika", `<select class="${input}" name="rubric_id">${rubricOptions(data.rubrics, source)}</select>`, "Podrubrika je pod svou rubrikou, třeba Fotbal pod Sportem.")}
      ${photoControl(source, data.stock)}
      ${publish ? `<div class="field"><span>Viditelnost</span>${check("published", "1", publish.checked, "Zveřejnit na webu")}</div>` : ""}
    </div>
  </div>`;
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
  const form = `<form class="form" method="post" action="${BASE}/schvalit" enctype="multipart/form-data">
      ${callout(`${intro}${
        proposal.articleTitle ? `<br>Ke zprávě: <b>${esc(proposal.articleTitle)}</b>` : ""
      }${
        proposal.publishOn && !proposal.articleId ? `<br>Vyjde s datem ze zdroje: <b>${esc(formatShort(proposal.publishOn))}</b>` : ""
      }`)}
      ${hidden("id", proposal.id)}
      ${articleFields(proposal, data)}
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
