// Výběr fotky z knihovny obrázků u zprávy a návrhu. Bez JS je to obyčejný přepínač s náhledy.
import { STOCK_LABEL } from "../stock.js";
import { esc, mediaUrl } from "../view.js";

export function stockPicker(stock) {
  const topics = (stock?.topics ?? []).filter((topic) => topic.images.length);
  if (!topics.length) return "";
  const groups = topics
    .map(
      (topic) => `<p class="stock-pick-topic">${esc(topic.name)}</p>
      <div class="stock-pick-grid">${topic.images
        .map(
          (image) => `<label class="stock-option"><input type="radio" name="stock_id" value="${image.id}">
            <img src="${mediaUrl(image.imageKey)}" alt="${esc(image.caption || topic.name)}" loading="lazy"></label>`,
        )
        .join("")}</div>`,
    )
    .join("");
  return `<details class="stock-pick">
    <summary>Vybrat z knihovny obrázků</summary>
    <p class="hint">Vybraná fotka nahradí současnou, popisek bude „${STOCK_LABEL}“. Nahraná fotka má přednost.</p>
    <label class="stock-keep"><input type="radio" name="stock_id" value="" checked> Nechat, jak je</label>
    ${groups}
  </details>`;
}
