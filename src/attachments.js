// Přílohy zprávy: obrázky ze zdroje, které si čtenář má prohlédnout sám (jízdní řád, mapa objížďky, rozpis).
// Ve zprávě i návrhu je drží sloupec `attachments` jako JSON [{ key, caption }], soubory leží v R2 ve složce prilohy/.
import { esc, mediaUrl } from "./html.js";

export const MAX_ATTACHMENTS = 8;
const CAPTION_MAX = 200;
const KEY = /^prilohy\/[0-9a-f-]+\.(?:jpg|png|webp|gif)$/;

export function readAttachments(value) {
  let list;
  try {
    list = JSON.parse(String(value ?? "") || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => KEY.test(String(item?.key ?? "")))
    .slice(0, MAX_ATTACHMENTS)
    .map((item) => ({ key: String(item.key), caption: String(item.caption ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX) }));
}

export function attachmentsJson(list) {
  return list?.length ? JSON.stringify(list.map(({ key, caption }) => ({ key, caption }))) : "";
}

// Redakce u zprávy nebo návrhu odškrtla přílohy, které nechce. Formulář bez příloh nic nemění.
export function keptAttachments(value, input) {
  const list = readAttachments(value);
  if (!input?.attachmentsShown) return { json: attachmentsJson(list), removed: [] };
  const keep = new Set(input.keepAttachments ?? []);
  return {
    json: attachmentsJson(list.filter((item) => keep.has(item.key))),
    removed: list.filter((item) => !keep.has(item.key)).map((item) => item.key),
  };
}

export function attachmentKeys(value) {
  return readAttachments(value).map((item) => item.key);
}

// Pod zprávou: náhledy, ťuknutím se obrázek otevře v okně na stránce (public/attachments.js), bez JS sám.
export function attachmentsSection(article) {
  const list = article.attachments ?? [];
  if (!list.length) return "";
  const items = list
    .map(
      (item) => `<li><a href="${mediaUrl(item.key)}" target="_blank" rel="noopener">
              <img src="${mediaUrl(item.key)}" alt="${esc(item.caption)}" loading="lazy">
              ${item.caption ? `<span>${esc(item.caption)}</span>` : ""}
            </a></li>`,
    )
    .join("");
  return `<section class="article-attachments">
            <h2>Přílohy</h2>
            <p class="muted">Ťukněte na obrázek, otevře se celý.</p>
            <ul class="plain">${items}</ul>
          </section>`;
}
