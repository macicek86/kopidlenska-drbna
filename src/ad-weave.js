// Reklamy zasunuté do dlouhých seznamů (zprávy, akce): každá na stránce jen jednou.
import { adQueue, pickAd } from "./ads.js";
import { adPanel } from "./view.js";

// Fronta reklam pro stránku: první ta vybraná (`data.ad`), za ní ostatní náhodně.
export function pageAds(data) {
  const first = Object.hasOwn(data, "ad") ? data.ad : pickAd(data.ads);
  return first ? adQueue(data.ads, first) : [];
}

// Reklama po `first` kartách, pak vždy po `every`; za poslední kartu nikdy. Bere z fronty.
export function weaveAds(cards, queue, copy, { first, every }) {
  const out = [];
  cards.forEach((card, index) => {
    out.push(card);
    const seen = index + 1;
    const due = seen === first || (seen > first && (seen - first) % every === 0);
    if (due && queue.length && seen < cards.length) out.push(adPanel(queue.shift(), copy));
  });
  return out;
}
