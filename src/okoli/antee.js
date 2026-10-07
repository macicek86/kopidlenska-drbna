// Weby obcí na Antee (Libáň…): aktuality jako RSS (`?action=atom`, čte je src/skola/feed.js). Pozvánky jsou mezi
// uzavírkami, svozem a inzercí a čas a místo bývají jen na plakátu. Každou novou položku proto přečte levný model
// (Haiku, i s plakátem) a řekne, jestli je to akce pro veřejnost, a vytáhne název, den, čas, místo a popis.
// Přečtená položka se zapamatuje (akce v okoli_events, ostatní v okoli_seen) a podruhé se nečte.
import { callClaude } from "../claude.js";
import { fetchImage } from "../images.js";
import { base64, visibleImages } from "../munipolis/ai.js";
import { fetchSchoolFeeds, schoolKey } from "../skola/feed.js";
import { pragueNow } from "../waste.js";

// Položek přečtených modelem nejvýš tolik za průchod (Worker má omezený čas i počet požadavků), zbytek příště.
export const MAX_READS = 8;
// Položka bez termínu v kalendáři obce se bere jen tolik dní po zveřejnění.
const FRESH_DAYS = 30;

const EXTRACT_RULES = `Dostaneš jednu položku z aktualit na webu {ABOUT}, případně s plakátem. Rozhodni, jestli je to pozvánka na konkrétní akci pro veřejnost (koncert, divadlo, přednáška, zábava, ples, výlet, procházka, sportovní akce, trhy, výstava, slavnost).
Akce to není: uzavírka, odstávka, svoz odpadu, úřední oznámení, poplatky, nabídka práce, reklama a nabídky firem, nábor do kroužku nebo oddílu, vítání občánků a jiné akce jen pro pozvané.
Když je to akce, vyplň (údaje z textu i z plakátu):
- title: krátký název akce přesně podle zdroje, normálně (ne celé velkými písmeny), bez slova „Pozvánka“.
- date: den začátku jako RRRR-MM-DD.
- time: čas začátku jako HH:MM, nebo prázdné, když není uvedený.
- place: kde se koná, co nejpřesněji (sál, kostel, hřiště…) a obec.
- description: jedna až dvě věty: o co jde, kdo hraje nebo vystupuje, kdo pořádá a vstupné, když je uvedené. Předprodej, kontakty a další podrobnosti vynech. Jména a názvy opiš přesně, i s diakritikou. Zkratky (DS, TJ, SDH) nech, jak jsou, nerozepisuj je.
Údaje ber jen ze zdroje, nic nevymýšlej. Když to akce není, dej is_event false a ostatní pole prázdná.`;

export function extractPrompt(source) {
  return EXTRACT_RULES.replace("{ABOUT}", source.about ?? `obce ${source.town}`);
}

export const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_event", "title", "date", "time", "place", "description"],
  properties: {
    is_event: { type: "boolean" },
    title: { type: "string" },
    date: { type: "string" },
    time: { type: "string" },
    place: { type: "string" },
    description: { type: "string" },
  },
};

const clean = (value, max) => String(value ?? "").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim().slice(0, max);

// Termín z kalendáře obce: „14. 11. 2026“ nebo „21. 9. 2026 až 2. 10. 2026“ jako RRRR-MM-DD.
export function termDays(term) {
  const days = [...String(term ?? "").matchAll(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/g)].map(
    ([, day, month, year]) => `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
  );
  return days.length ? { first: days[0], last: days[days.length - 1] } : null;
}

// Stojí za přečtení: termín ještě neskončil, nebo bez termínu nedávno zveřejněná.
export function isCurrent(item, today) {
  const term = termDays(item.term);
  if (term) return term.last >= today;
  const published = Date.parse(item.publishedAt);
  if (!Number.isFinite(published)) return true;
  return Date.now() - published <= FRESH_DAYS * 86_400_000;
}

export function extractText(item) {
  return [
    `Nadpis: ${item.title}`,
    `Zveřejněno: ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}`,
    `Termín v kalendáři obce: ${item.term || "neuveden"}`,
    `Text:\n${String(item.text ?? "").slice(0, 3000) || "(bez textu)"}`,
  ].join("\n");
}

// Odpověď modelu jako akce pro okoli_events, nebo null (není akce, chybí den).
export function readExtract(raw, source) {
  if (!raw?.is_event) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date ?? "").trim()) ? String(raw.date).trim() : "";
  const title = clean(raw.title, 200);
  if (!date || title.length < 3) return null;
  const time = /^\d{1,2}:\d{2}$/.test(String(raw.time ?? "").trim()) ? String(raw.time).trim().padStart(5, "0") : "";
  return { title, startsOn: date, startsTime: time, endsTime: "", place: clean(raw.place, 160) || source.town, description: clean(raw.description, 700), kind: "akce", soldOut: false };
}

// Antee dává obrázek i zmenšený (`width`, `height` v adrese); bez nich je originál, na plakátu jde líp číst drobné písmo.
export function posterUrls(urls) {
  const full = urls.map((url) => {
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("width");
      parsed.searchParams.delete("height");
      return parsed.toString();
    } catch {
      return "";
    }
  });
  return [...new Set(full.filter(Boolean))].slice(0, 2);
}

async function posters(env, urls, fetchImpl) {
  const images = [];
  for (const url of posterUrls(urls)) {
    const image = await fetchImage(env, url, { fetchImpl });
    // Náhled u článku a obrázek v textu bývá tentýž plakát pod jiným číslem.
    if (image && !images.some((other) => other.bytes.byteLength === image.bytes.byteLength)) images.push(image);
  }
  return visibleImages(images);
}

export async function askExtract(env, source, item, images) {
  const content = [{ type: "text", text: `${extractText(item)}${images.length ? `\n\nPřiložené obrázky: ${images.length}.` : ""}` }];
  for (const image of images) content.push({ type: "image", source: { type: "base64", media_type: image.type, data: base64(image.bytes) } });
  return callClaude(env, { system: extractPrompt(source), content, schema: EXTRACT_SCHEMA, cheap: true });
}

// Čtečka pro zdroj v sources.js (`feed` je adresa RSS aktualit). Vrací položky jako fetchKzmj a navíc `seen`:
// přečtené položky, které akcí nejsou (nebo jsou staré), ať se nečtou znovu. Starší položky z RSS vypadávají,
// proto `complete` není nikdy pravda a akce se podle chybějících nemažou.
export function anteeReader(source) {
  return async function fetchAnteeEvents({ env, fetchImpl = fetch, known = new Map(), ask = askExtract, today = pragueNow().date } = {}) {
    const feed = await fetchSchoolFeeds([source.feed], { fetchImpl });
    if (!feed.ok) return { ok: false, error: feed.error ?? "Web obce neodpověděl.", items: [], listed: [], seen: [], complete: false };
    const items = [];
    const seen = [];
    const errors = [];
    let reads = 0;
    for (const entry of feed.items) {
      const guid = `${source.tag}:${schoolKey(entry.link) || entry.guid}`;
      if (known.has(guid)) continue;
      if (!isCurrent(entry, today)) {
        seen.push(guid);
        continue;
      }
      if (reads >= MAX_READS || !env?.ANTHROPIC_API_KEY) continue;
      reads += 1;
      const answer = await ask(env, source, entry, await posters(env, entry.images ?? [], fetchImpl));
      if (!answer.ok) {
        errors.push(answer.error);
        continue;
      }
      const event = readExtract(answer.raw, source);
      if (event) items.push({ guid, stamp: "", link: entry.link, ...event });
      else seen.push(guid);
    }
    const warning = errors.length ? errors[0] : !env?.ANTHROPIC_API_KEY ? "Chybí klíč ANTHROPIC_API_KEY, pozvánky se nečtou." : "";
    // `total`: kolik položek v RSS je (pro stránku Stav, nové jsou jen v items a seen).
    return { ok: true, items, listed: [], seen, total: feed.items.length, complete: false, warning };
  };
}
