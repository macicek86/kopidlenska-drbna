// Claude roztřídí článek z webu školy nebo města, pozná duplicitu a přepíše ho hlasem kozy Drběny. Co brát, říká zdroj v `sources.js`.
import { callClaude } from "../claude.js";
import { clubRules } from "../clubs.js";
import { EVENT_CHANGE_RULE } from "../event-change.js";
import { DEFAULT_VOICE } from "../drbena.js";
import { writeFollowup } from "../followup.js";
import { KEYWORDS_RULE } from "../keywords.js";
import { URGENT_RULE } from "../publish-queue.js";
import { contentText, importContent } from "../import-overview.js";
import { importLookup, withLookups } from "../import-tools.js";
import { base64, LINK_RULE, outputSchema, readArticle, readDecision, visibleImages } from "../munipolis/ai.js";
import { OWN_PHOTO_RULE, topicsText } from "../stock.js";
import { pastedFrom } from "./paste.js";
import { SCHOOLS } from "./sources.js";

const RULES = `{SOURCE}

Pravidla:
- Data, časy, místa, jména, čísla a výsledky opiš přesně podle zdroje. Nic nevymýšlej. Když údaj chybí, nech pole prázdné. Rok doplň podle data zveřejnění článku.
- Jména dětí a studentů piš jen tak, jak je uvádí zdroj, a nepřidávej o nich nic dalšího (třídu, bydliště, rodinu), co ve zdroji není.
- Je-li přiložený plakát nebo fotka, vytáhni z něj údaje, které v textu chybí.
{RUBRIC}
{IMAGES}{CLUBS}
- title: do 90 znaků, vlastní, bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
${LINK_RULE}
- body_html: dva až čtyři krátké odstavce. Smíš použít jen <p>, <strong>, <em>, <ul>, <li>, <h3> a <a> s odkazem ze zdroje. Odkaz na zdroj nepiš, drbna ho doplní sama.
- event.description: prostý text, jedna až tři věty.
${KEYWORDS_RULE}
${URGENT_RULE}
- Datum piš jako RRRR-MM-DD a čas jako HH:MM.
- U části, kterou nevytváříš, dej include false a ostatní pole nech prázdná. Odstávky a uzavírky (notice) z tohoto zdroje drbna nebere, notice nech vždy include false.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const OWN_IMAGES = `- image_use: "vlastni" jen tehdy, když je přiložená skutečná fotka, která je sama o sobě pěkná ({PEOPLE}) a nese málo textu. ${OWN_PHOTO_RULE}
  "plakat", když je přiložený pěkně udělaný plakát nebo pozvánka na akci, kde aspoň zhruba třetinu plochy zabírají fotky nebo kresby. Delší odstavce textu nevadí, rozhodují obrázky. Oznámení, která nezvou na akci (zavřeno, změna, upozornění), jsou "knihovna", i když mají pěkné malované pozadí nebo ozdoby.
  "knihovna" u plakátu nebo letáku, na kterém fotky a kresby skoro nejsou, nebo jsou jen malé (logo, ikonka, drobný obrázek v rohu), a u loga, tabulky nebo koláže s textem. Když nic přiložené není, taky "knihovna".
- image_topic: téma z knihovny obrázků, které k článku nejlíp sedí (značka ze seznamu témat). Použije se, když vlastní fotka není. Když nesedí žádné, nech prázdné.
- image_caption: krátký popisek vlastní fotky nebo plakátu, nebo prázdný text. Když je u článku napsané, kdo fotky pořídil nebo poskytl, přidej to do popisku. U "knihovna" vždy prázdný.`;

const STOCK_IMAGES = `- image_topic: téma z knihovny obrázků, které k článku nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné. Fotky z webu zdroje se neberou, image_caption nech prázdné.`;

const FORCE = "Redakce chce tenhle článek zpracovat, i když jsi ho předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

// Školy mají svou podrubriku, web města ne: rubriku vybere Drběna jako u Munipolisu.
function rubricRule(source) {
  if (!source.rubric) return "- rubric: vyber rubriku ze seznamu, která k článku nejlíp sedí.";
  return `- rubric: zprávy z téhle školy patří do rubriky "${source.rubric}", pokud je v seznamu. Jinak vyber nejbližší.`;
}

export function skolaPrompt(voice, { ownPhotos = false, source = SCHOOLS.skola, rubricSlugs = null } = {}) {
  const style = String(voice ?? "").trim() || DEFAULT_VOICE;
  const clubs = clubRules(rubricSlugs, { hideSchool: source.tag === "skola" });
  const rules = RULES.replace("{SOURCE}", source.rules)
    .replace("{IMAGES}", ownPhotos ? OWN_IMAGES.replace("{PEOPLE}", source.people) : STOCK_IMAGES)
    .replace("{CLUBS}", clubs ? `\n${clubs}` : "")
    .replace("{RUBRIC}", rubricRule(source));
  return `${rules}\n${EVENT_CHANGE_RULE}\n\nHlas a styl textů:\n${style}`;
}

// Vložený příspěvek nemá nadpis ani rubriku, jen odkud je a text.
function pastedItemText(item, source) {
  return [
    `Příspěvek, který redakce vložila z: ${pastedFrom(source, item.section)} (zveřejněno ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}):`,
    `Text:\n${item.text || "(bez textu, údaje jsou možná jen na obrázku)"}`,
  ].join("\n\n");
}

export function skolaItemText(item, source = SCHOOLS.skola) {
  if (source.pasted) return pastedItemText(item, source);
  return [
    `Článek z webu ${source.name}${item.section ? `, rubrika ${item.section}` : ""} (zveřejněno ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    item.term ? `${source.term}: ${item.term}` : "",
    item.documents?.length ? "Text: v přiloženém dokumentu (PDF)." : `Text:\n${item.text || "(bez textu, údaje jsou možná jen na obrázku)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// `later` je poznámka k odložené pozvánce (`defer.js`).
export function skolaContent(item, known, { today, force = false, later = "", topics = [], images = [], documents = [], source = SCHOOLS.skola }) {
  const media = [
    ...documents.map((doc) => ({ type: "document", source: { type: "base64", media_type: doc.type, data: base64(doc.bytes) } })),
    ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.type, data: base64(image.bytes) } })),
  ];
  const shown = images.length ? `Přiložené obrázky: ${images.length}.` : "Bez přiloženého obrázku.";
  return importContent(known, { today, topics: topicsText(topics), media, tail: [skolaItemText(item, source), shown, later, force ? FORCE : ""] });
}

export function skolaText(item, known, { images = 0, ...options }) {
  const fake = Array.from({ length: images }, () => ({ type: "image/png", bytes: new Uint8Array() }));
  return contentText(skolaContent(item, known, { ...options, images: fake }));
}

function followupFor(env, decision, { system, source, item, rubricSlugs, topics, today, extra = "" }) {
  return writeFollowup(env, decision, {
    system,
    sourceText: [skolaItemText(item, source), extra].filter(Boolean).join("\n\n"),
    articleSchema: outputSchema(rubricSlugs, { topics: topics.map((topic) => topic.slug), ownImage: false }).properties.article,
    readArticle: (raw) => readArticle(raw, rubricSlugs),
    topics,
    today,
  });
}

// Navazující zprávu ke zprávě `followOf` chce redakce sama (vložený příspěvek, který Drběna měla za duplicitu).
// `extra` je poznámka redakce k přepsání.
export function followSkola(env, { source, item, followOf, rubricSlugs, topics = [], voice, today, extra = "" }) {
  const decision = { ok: true, decision: "doplneni", reason: "Redakce chtěla navazující zprávu.", duplicateOf: `zprava:${followOf}`, followOf, event: null, eventChange: null };
  const system = skolaPrompt(voice, { ownPhotos: false, source, rubricSlugs });
  return followupFor(env, decision, { system, source, item, rubricSlugs, topics, today, extra });
}

// Jedno volání Claude. Obrázky vidí vždy (plakát nese údaje), vybrat vlastní fotku smí jen s `ownPhotos`.
// `documents` jsou PDF z úřední desky ({ type, bytes }).
export async function askSkola(env, { source = SCHOOLS.skola, item, known, images = [], documents = [], topics = [], rubricSlugs, voice, today, force = false, later = "", ownPhotos = false }) {
  const shown = visibleImages(images);
  const content = skolaContent(item, known, { today, force, later, topics, images: shown, documents, source });
  const slugs = topics.map((topic) => topic.slug);
  const schema = outputSchema(rubricSlugs, { topics: slugs, ownImage: ownPhotos, followup: true });
  const system = skolaPrompt(voice, { ownPhotos, source, rubricSlugs });
  const answer = await callClaude(env, { system, content, schema, lookup: importLookup(env) });
  if (!answer.ok) return answer;
  const decision = withLookups(readDecision(answer.raw, { rubricSlugs, force }), answer);
  if (decision.ok && decision.decision === "doplneni") {
    const written = await followupFor(env, decision, { system, source, item, rubricSlugs, topics, today });
    return withLookups(written, decision);
  }
  if (!decision.ok || decision.decision !== "vytvorit") return decision;
  // Odstávky z těchhle webů drbna nebere. Kdyby je Claude přesto vrátil, drbna je neuloží.
  if (!decision.article && !decision.event) return { ok: false, error: "Claude chtěl článek zpracovat, ale nevrátil zprávu ani akci." };
  return { ...decision, notice: null, hours: [] };
}
