// Claude roztřídí zprávu z Munipolisu, pozná duplicitu a přepíše ji hlasem kozy Drběny.
import { callClaude, MODEL } from "../claude.js";
import { EVENT_CHANGE_RULE, eventChangeSchema, readEventChange } from "../event-change.js";
import { clubRules } from "../clubs.js";
import { prepareArticleBody } from "../rich.js";
import { isoDate, clockTime, parseNoticeInput } from "../notices.js";
import { DEFAULT_VOICE } from "../drbena.js";
import { HOURS_RULES, hoursSchema, readHours } from "./hours.js";
import { contentText, importContent } from "../import-overview.js";
import { importLookup, withLookups } from "../import-tools.js";
import { OWN_PHOTO_RULE, topicsText } from "../stock.js";
import { writeFollowup } from "../followup.js";
import { FOLLOWUP_DECISION } from "../followup-rules.js";
import { KEYWORDS_RULE, keywordsSchema, readKeywords } from "../keywords.js";
import { MAX_ATTACHMENTS } from "../attachments.js";
import { readRecall } from "../drbena-memory.js";

export { MODEL, DEFAULT_VOICE };
export { addArticles, articleLine, contextText } from "../import-overview.js";
const MAX_IMAGE_BYTES = 3_700_000;
// Kolik obrázků Claude dostane a kolik dohromady smí mít (dotaz na API má strop 32 MB i s base64).
const MAX_IMAGES = 8;
const MAX_IMAGES_BYTES = 18_000_000;

// Obrázek u článku: vlastní fotka jen když stojí za to, jinak ilustrační z knihovny obrázků.
const IMAGE_RULES = `- Obrázky jsou očíslované (Obrázek 1, 2…). Vlastní fotka nebo plakát je vždy Obrázek 1.
- image_use: "vlastni" jen tehdy, když je přiložená skutečná fotka, která je sama o sobě pěkná nebo zajímavá (lidé, místo, akce, příroda) a nese málo textu. ${OWN_PHOTO_RULE}
  "plakat", když je přiložený pěkně udělaný plakát nebo pozvánka na akci, kde aspoň zhruba třetinu plochy zabírají fotky nebo kresby. Delší odstavce textu nevadí, rozhodují obrázky. Oznámení, která nezvou na akci (zavřeno, změna, upozornění), jsou "knihovna", i když mají pěkné malované pozadí nebo ozdoby.
  "knihovna" u plakátu nebo letáku, na kterém fotky a kresby skoro nejsou, nebo jsou jen malé (logo, ikonka, drobný obrázek v rohu), a u vyhlášky, tabulky, mapy nebo loga, i když jsou barevné. Když nic přiložené není, taky "knihovna".
- image_topic: téma z knihovny obrázků, které ke zprávě nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné.
- image_caption: krátký popisek vlastní fotky nebo plakátu (u plakátu třeba „Plakát bazárku“), nebo prázdný text. U "knihovna" vždy prázdný.`;

// Odkazy ze zdroje do článku (Munipolis i školy). Ve zdroji jsou jako „popis (adresa)“, viz htmlToText v feed.js.
export const LINK_RULE = `- Odkazy ze zdroje, které čtenáři pomůžou (mapa, objízdná trasa, přihláška, formulář, e-mail), smíš dát do textu jako <a href="adresa">krátký popis</a>. Ve zdroji jsou jako „popis (adresa)“. Adresu opiš přesně, jiné nevymýšlej a odkaz na samotný článek zdroje nedávej.`;

// Přílohy pod článkem (src/attachments.js): zpráva z Munipolisu mívá v galerii jízdní řády, mapy nebo rozpisy.
const ATTACHMENT_RULES = `- attachments: obrázky, které si čtenář potřebuje prohlédnout sám a jejich obsah se do textu nevejde: jízdní řády, mapa uzavírky nebo objížďky, rozpis, tabulka, leták s podrobnostmi. U každého číslo obrázku (image) a krátký popisek, co na něm je (caption), třeba „Výlukový jízdní řád linky 723 Kopidlno – Mladá Boleslav“. Obrázek 1 sem nedávej, když je image_use "vlastni" nebo "plakat". Fotky, loga, ozdoby a obrázky, jejichž údaje už celé jsou v textu, taky ne. Když nic takového není, dej prázdné pole.
  Když přílohy jsou, napiš v textu, že jsou pod článkem („jízdní řády najdete pod článkem“).`;

const RULES = `Dostaneš jednu zprávu z městského Munipolisu Kopidlna a přehled toho, co už na webu Kopidlenská drbna je.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy. Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když nová zpráva přináší podstatnou změnu (jiný termín, zrušení, nové místo), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a změnu zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": zpráva nemá pro čtenáře drbny smysl, nebo jde o odstávku elektřiny (tu drbna bere automaticky od ČEZ).
- "vytvorit": všechno ostatní.

Co vytvořit:
- Odstávka vody: notice s kind "voda". Každou ulici nebo část obce dej do places zvlášť. Článek jen tehdy, když zpráva říká víc než samotnou odstávku.
- Uzavírka silnice nebo objížďka: notice s kind "uzavirka" a k tomu článek v praktické rubrice. Úsek popiš tak, jak opravdu je (ulice, odkud kam, podle textu nebo mapy na obrázku), jednou a přirozeně. Nadpis zdroje bývá zkratka, nepiš podle něj víc, než je zavřené. Nevysvětluj, co zavřené není, a stejný údaj neopakuj. Nadpis piš lidsky, ne jako výčet ulic, třeba „Silnice u stadionu je zavřená, bruslaři musí jezdit jinudy“. Do notice.places dej jen uzavřené úseky.
- Pozvánka na akci s datem: event a k tomu krátký článek s pozvánkou.
- Zavření nebo jiná otevírací doba: hours, viz níže.
- Cokoli jiného: článek.

${HOURS_RULES}

Pravidla:
- Data, časy, místa, jména, ceny a telefony opiš přesně podle zdroje. Nic nevymýšlej. Když údaj chybí, nech pole prázdné. Rok doplň podle data zveřejnění zprávy.
- Je-li přiložený plakát nebo fotka, vytáhni z něj údaje, které v textu chybí.
- Zprávu podej jako svou novinku, ne jako převyprávěné oznámení. Nepiš, že město nebo radnice něco oznámila, informuje, zveřejnila, prosí nebo se omlouvá, ani „v příloze oznámení“. Co zpráva čtenářům říká, napiš rovnou („Řidiči i cestující, počítejte s omezením.“). Město jmenuj jen tam, kde samo něco dělá (opravuje, pořádá, rozhodlo). Odkaz na zdroj drbna přidá sama.
${LINK_RULE}
${IMAGE_RULES}
${ATTACHMENT_RULES}
${KEYWORDS_RULE}
- title: do 90 znaků, bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: dva až pět krátkých odstavců. Smíš použít jen <p>, <strong>, <em>, <ul>, <li>, <h3> a <a> s odkazem ze zdroje. Odkaz na zdroj nepiš, drbna ho doplní sama.
- event.description: prostý text, jedna až tři věty.
- Datum piš jako RRRR-MM-DD a čas jako HH:MM.
- U části, kterou nevytváříš, dej include false a ostatní pole nech prázdná.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const FORCE = "Redakce chce tuhle zprávu zpracovat, i když jsi ji předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

function stringField() {
  return { type: "string" };
}

// `hours` přidá pole s otevírací dobou (jen Munipolis, Deník ho nemá). `topics` jsou značky témat knihovny obrázků,
// `ownImage` dovolí vybrat vlastní fotku (Deník fotky nedává, tam je obrázek vždy z knihovny),
// `followup` přidá rozhodnutí „doplneni“ (navazující zpráva, src/followup.js).
// `attachments` přidá k článku přílohy (obrázky ze zdroje pod článkem).
export function outputSchema(rubricSlugs, { hours = false, topics = [], ownImage = true, followup = false, attachments = false } = {}) {
  const slugs = rubricSlugs.length ? rubricSlugs : ["zpravy"];
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reason", "duplicate_of", "article", "event", "event_change", "notice"],
    properties: {
      decision: { type: "string", enum: ["vytvorit", "preskocit", "duplicita", ...(followup ? ["doplneni"] : [])] },
      reason: stringField(),
      duplicate_of: stringField(),
      article: {
        type: "object",
        additionalProperties: false,
        required: ["include", "title", "excerpt", "body_html", "rubric", "image_caption", "image_topic", "keywords", "recall"],
        properties: {
          include: { type: "boolean" },
          title: stringField(),
          excerpt: stringField(),
          body_html: stringField(),
          rubric: { type: "string", enum: slugs },
          image_caption: stringField(),
          image_topic: { type: "string", enum: [...new Set([...topics, ""])] },
          keywords: keywordsSchema(),
          recall: stringField(),
        },
      },
      event: {
        type: "object",
        additionalProperties: false,
        required: ["include", "title", "place", "date", "time", "description"],
        properties: {
          include: { type: "boolean" },
          title: stringField(),
          place: stringField(),
          date: stringField(),
          time: stringField(),
          description: stringField(),
        },
      },
      event_change: eventChangeSchema(),
      notice: {
        type: "object",
        additionalProperties: false,
        required: ["include", "kind", "title", "starts_on", "starts_time", "ends_on", "ends_time", "places", "note"],
        properties: {
          include: { type: "boolean" },
          kind: { type: "string", enum: ["voda", "uzavirka"] },
          title: stringField(),
          starts_on: stringField(),
          starts_time: stringField(),
          ends_on: stringField(),
          ends_time: stringField(),
          places: { type: "array", items: stringField() },
          note: stringField(),
        },
      },
    },
  };
  if (ownImage) {
    schema.properties.article.required.push("image_use");
    schema.properties.article.properties.image_use = { type: "string", enum: ["vlastni", "plakat", "knihovna"] };
  }
  if (attachments) {
    schema.properties.article.required.push("attachments");
    schema.properties.article.properties.attachments = {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["image", "caption"],
        properties: { image: { type: "integer" }, caption: stringField() },
      },
    };
  }
  if (hours) {
    schema.required.push("hours");
    schema.properties.hours = hoursSchema();
  }
  return schema;
}

export function systemPrompt(voice, { rubricSlugs = null } = {}) {
  const style = String(voice ?? "").trim() || DEFAULT_VOICE;
  const clubs = clubRules(rubricSlugs);
  return `${RULES}\n${EVENT_CHANGE_RULE}${clubs ? `\n\n${clubs}` : ""}\n\nHlas a styl textů:\n${style}`;
}

// Samotná zpráva ze zdroje. Bez přehledu ji dostane i druhé volání, které píše navazující zprávu.
export function itemText(item) {
  return [
    `Nová zpráva z Munipolisu (zveřejněno ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    `Text:\n${item.text || "(bez textu, údaje jsou možná jen na obrázku)"}`,
  ].join("\n\n");
}

// Dotaz na jednu zprávu: přehled (cache), obrázky a nakonec zpráva sama.
export function userContent(item, known, { today, force = false, topics = [], images = [] }) {
  const media = images.flatMap((image, index) => [
    { type: "text", text: `Obrázek ${index + 1}:` },
    { type: "image", source: { type: "base64", media_type: image.type, data: base64(image.bytes) } },
  ]);
  return importContent(known, {
    today,
    topics: topicsText(topics),
    media,
    tail: [itemText(item), images.length ? `Přiložené obrázky: ${images.length}.` : "Bez přiloženého obrázku.", force ? FORCE : ""],
  });
}

export function userText(item, known, { today, force = false, topics = [], images = 0 }) {
  const fake = Array.from({ length: images }, () => ({ type: "image/png", bytes: new Uint8Array() }));
  return contentText(userContent(item, known, { today, force, topics, images: fake }));
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const REF = /^(zprava|navrh|akce|odstavka|ndic|munipolis|denik|skola|zahradka|webmesta|vlozene|misto|lekar):\d+$/;

// Článek z odpovědi Claude, nebo null, když ho nechtěl napsat nebo v něm něco chybí. Sdílí ho i Deník a NDIC.
export function readArticle(raw, rubricSlugs) {
  if (!raw?.include) return null;
  const prepared = prepareArticleBody(String(raw.body_html ?? "").slice(0, 20000));
  const title = clean(raw.title, 160);
  const excerpt = clean(raw.excerpt, 320);
  const rubric = rubricSlugs.includes(raw.rubric) ? raw.rubric : "";
  if (title.length < 3 || excerpt.length < 3 || prepared.text.length < 3 || !rubric) return null;
  const imageUse = ["vlastni", "plakat"].includes(raw.image_use) ? raw.image_use : "knihovna";
  return {
    title,
    excerpt,
    body: prepared.html,
    rubric,
    imageUse,
    imageTopic: clean(raw.image_topic, 60),
    imageCaption: imageUse !== "knihovna" ? clean(raw.image_caption, 200) : "",
    keywords: readKeywords(raw.keywords),
    recall: readRecall(raw.recall),
    attachments: readAttachmentPicks(raw.attachments, imageUse),
  };
}

// Které obrázky jdou pod článek: čísla od 1, každé jednou, bez obrázku 1, když je to fotka nebo plakát článku.
function readAttachmentPicks(raw, imageUse) {
  if (!Array.isArray(raw)) return [];
  const picks = [];
  for (const item of raw) {
    const index = Number(item?.image);
    if (!Number.isInteger(index) || index < 1 || picks.some((pick) => pick.index === index)) continue;
    if (index === 1 && imageUse !== "knihovna") continue;
    picks.push({ index, caption: clean(item.caption, 200) });
  }
  return picks.slice(0, MAX_ATTACHMENTS);
}

function readEvent(raw) {
  if (!raw?.include) return null;
  const date = isoDate(raw.date);
  const title = clean(raw.title, 160);
  const place = clean(raw.place, 160);
  if (!date || title.length < 3 || place.length < 2) return null;
  return { title, place, startsOn: date, startsTime: clockTime(raw.time), description: clean(raw.description, 4000) };
}

// Ověří, co Claude vrátil, a převede to na tvar, který umí uložit drbna. Když něco nesedí, vrátí chybu.
// Doplnění nese jen akci, kterou stará zpráva neměla v kalendáři (src/followup.js). Zrušení nebo změnu akce
// v kalendáři (`eventChange`, src/event-change.js) nese každé rozhodnutí kromě přeskočení.
export function readDecision(raw, options) {
  const decision = readDecisionBase(raw, options);
  if (!decision.ok || decision.decision === "preskocit") return decision;
  return { ...decision, eventChange: readEventChange(raw.event_change) };
}

function readDecisionBase(raw, { rubricSlugs, force = false }) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Claude nevrátil rozhodnutí." };
  let decision = ["vytvorit", "preskocit", "duplicita", "doplneni"].includes(raw.decision) ? raw.decision : "";
  if (!decision) return { ok: false, error: "Claude nevrátil rozhodnutí." };
  if (force && decision !== "doplneni") decision = "vytvorit";
  const reason = clean(raw.reason, 400);
  const duplicateOf = REF.test(String(raw.duplicate_of ?? "").trim()) ? String(raw.duplicate_of).trim() : "";
  if (decision === "doplneni") {
    // Doplnit jde jen zprávu. K návrhu nebo bez značky je to duplicita (při ručním zpracování nová zpráva).
    const follow = /^zprava:(\d+)$/.exec(duplicateOf);
    if (follow) return { ok: true, decision, reason, duplicateOf, followOf: Number(follow[1]), article: null, event: readEvent(raw.event), notice: null, hours: [] };
    if (!force) return { ok: true, decision: "duplicita", reason, duplicateOf, article: null, event: null, notice: null, hours: [] };
    decision = "vytvorit";
  }
  if (decision !== "vytvorit") return { ok: true, decision, reason, duplicateOf, article: null, event: null, notice: null, hours: [] };

  let article = readArticle(raw.article, rubricSlugs);

  const event = readEvent(raw.event);

  let notice = null;
  if (raw.notice?.include) {
    const parsed = parseNoticeInput({
      kind: raw.notice.kind,
      title: raw.notice.title,
      startsOn: raw.notice.starts_on,
      startsTime: raw.notice.starts_time,
      endsOn: raw.notice.ends_on,
      endsTime: raw.notice.ends_time,
      places: raw.notice.places,
      note: raw.notice.note,
    });
    if (parsed.ok) notice = parsed.notice;
  }

  const hours = readHours(raw.hours);
  // Zavření a dočasná změna se jen propíšou, článek o nich redakce nechce. Článek zůstane u trvalé změny nebo u další novinky.
  if (hours.length && !hours.some((change) => change.kind === "trvala") && !event && !notice) article = null;

  if (!article && !event && !notice && !hours.length) {
    return { ok: false, error: "Claude chtěl zprávu zpracovat, ale nevrátil nic, co by šlo uložit." };
  }
  return { ok: true, decision, reason, duplicateOf: "", article, event, notice, hours };
}

export function base64(bytes) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

// API bere obrázek do 5 MB v base64. Větší obrázek Claude neuvidí, a tak ho ani nemůže vybrat jako vlastní fotku.
// Obrázků je nejvýš MAX_IMAGES a dohromady do MAX_IMAGES_BYTES, další Claude neuvidí.
export function visibleImages(images) {
  const shown = [];
  let total = 0;
  for (const image of images) {
    const size = image.bytes.byteLength;
    if (size > MAX_IMAGE_BYTES || total + size > MAX_IMAGES_BYTES) continue;
    shown.push(image);
    total += size;
    if (shown.length >= MAX_IMAGES) break;
  }
  return shown;
}

// Jedno volání Claude. `images` jsou už stažené obrázky ({ bytes, type }), `topics` témata knihovny obrázků.
export async function askClaude(env, { item, known, images = [], topics = [], rubricSlugs, voice, today, force = false }) {
  const shown = visibleImages(images);
  const content = userContent(item, known, { today, force, topics, images: shown });
  const schema = outputSchema(rubricSlugs, { hours: true, topics: topics.map((topic) => topic.slug), followup: true, attachments: true });
  const system = systemPrompt(voice, { rubricSlugs });
  const answer = await callClaude(env, { system, content, schema, lookup: importLookup(env) });
  if (!answer.ok) return answer;
  const decision = withLookups(readDecision(answer.raw, { rubricSlugs, force }), answer);
  if (!decision.ok || decision.decision !== "doplneni") return decision;
  const written = await writeFollowup(env, decision, {
    system,
    sourceText: itemText(item),
    articleSchema: outputSchema(rubricSlugs, { topics: topics.map((topic) => topic.slug), ownImage: false }).properties.article,
    readArticle: (raw) => readArticle(raw, rubricSlugs),
    topics,
    today,
  });
  return withLookups(written, decision);
}
