// Přílohy zprávy: obrázky, které si čtenář má prohlédnout sám (jízdní řád, mapa objížďky, rozpis, plakát).
// Vybírá je Drběna ze zdroje, nebo je v redakci nahraje člověk.
// Ve zprávě i návrhu je drží sloupec `attachments` jako JSON [{ key, caption }], soubory leží v R2 ve složce prilohy/.
import { esc, mediaUrl } from "./html.js";
import { releaseImage, storeImage } from "./images.js";

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
    .map((item) => ({ key: String(item.key), caption: cleanCaption(item.caption) }));
}

function cleanCaption(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX);
}

export function attachmentsJson(list) {
  return list?.length ? JSON.stringify(list.map(({ key, caption }) => ({ key, caption }))) : "";
}

// Přílohy z formuláře zprávy nebo návrhu: ponechané (s upraveným popiskem) a nově nahrané.
// Formulář bez příloh (`attachmentsShown` chybí) nic neubírá. Vrací JSON a klíče, které ze seznamu vypadly.
export async function formAttachments(env, value, input) {
  const list = readAttachments(value);
  const captions = new Map((input?.attachmentKeys ?? []).map((key, index) => [key, input.attachmentCaptions?.[index]]));
  const keep = new Set(input?.keepAttachments ?? []);
  const next = (input?.attachmentsShown ? list.filter((item) => keep.has(item.key)) : list).map((item) => ({
    key: item.key,
    caption: captions.has(item.key) ? cleanCaption(captions.get(item.key)) : item.caption,
  }));
  const files = (input?.attachmentFiles ?? []).filter((file) => file instanceof File && file.size > 0);
  if (next.length + files.length > MAX_ATTACHMENTS) return { error: `Příloh může být nejvýš ${MAX_ATTACHMENTS}.` };
  const added = [];
  for (const [index, file] of files.entries()) {
    const stored = await storeImage(env, file, "prilohy");
    if (stored.error) {
      for (const item of added) await releaseImage(env, item.key);
      return { error: `Příloha ${file.name || index + 1}: ${stored.error}` };
    }
    added.push({ key: stored.key, caption: cleanCaption(input.newAttachmentCaptions?.[index]) });
  }
  const all = [...next, ...added];
  const now = new Set(all.map((item) => item.key));
  return { json: attachmentsJson(all), added: added.map((item) => item.key), removed: list.filter((item) => !now.has(item.key)).map((item) => item.key) };
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
