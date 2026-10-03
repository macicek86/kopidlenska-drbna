// Pole fotky v redakci: nahrání, náhled výřezu a ťuknutí na místo, které má zůstat vidět (public/photo-pick.js).
import { readFocus } from "../photo.js";
import { esc, mediaUrl } from "../view.js";

// previews: [{ crop: "list" | "wide" | "strip" | "side", label }]
export function photoField(source, { inputAttrs = "", hint, previews, note, extra = "" }) {
  const current = source?.imageKey ? mediaUrl(source.imageKey) : "";
  const now = current
    ? `<figure class="photo-now" data-photo-now><img src="${current}" alt=""><figcaption>Současná fotka. Nová ji nahradí.</figcaption></figure>`
    : "";
  const crops = previews
    .map(
      ({ crop, label }) =>
        `<figure><div class="photo-crop photo-crop-${crop}"><img alt="" data-photo-src data-photo-crop></div><figcaption>${esc(label)}</figcaption></figure>`,
    )
    .join("");
  return `<div class="field photo-field" data-photo${current ? ` data-current="${esc(current)}"` : ""}>
    <span>Fotka</span>
    ${now}
    <input class="control" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"${inputAttrs}>
    <span class="hint">${hint}</span>
    <input type="hidden" name="image_focus" value="${esc(readFocus(source?.imageFocus))}" data-photo-focus>
    <div class="photo-pick" data-photo-pick hidden>
      <p class="photo-pick-title">Ťukněte na to, co má být vidět</p>
      <div class="photo-pick-full" data-photo-full tabindex="0" role="button" aria-label="Místo, které má zůstat vidět. Posunete ho i šipkami.">
        <img alt="" data-photo-src>
        <span class="photo-dot" data-photo-dot></span>
      </div>
      <div class="photo-pick-previews">${crops}</div>
      <p class="hint">${note}</p>
    </div>
    ${extra}
  </div>`;
}
