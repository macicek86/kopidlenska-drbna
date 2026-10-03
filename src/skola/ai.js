// Claude roztřídí článek z webu ZŠ a MŠ Kopidlno, pozná duplicitu a přepíše ho hlasem kozy Drběny.
import { callClaude } from "../claude.js";
import { DEFAULT_VOICE } from "../drbena.js";
import { base64, contextText, outputSchema, readDecision, visibleImages } from "../munipolis/ai.js";
import { topicsText } from "../stock.js";

const RULES = `Dostaneš jeden článek z webu Základní a mateřské školy Kopidlno a přehled toho, co už na webu Kopidlenská drbna je.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy (třeba ze zpráv města). Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když článek přináší podstatnou novinku (jiný termín, zrušení, výsledek), není to duplicita: zvol "vytvorit" a novinku zmiň v reason.
- "preskocit": věc jen pro žáky a učitele bez zajímavosti pro sousedy (rozvrh, dokument ke stažení, přání krásných prázdnin, hospodaření spolku), nebo článek nemá dost obsahu.
- "vytvorit": úspěchy žáků, akce školy a školky (i pro veřejnost), novinky, které zajímají rodiče i ostatní sousedy (zápis, ceny stravného, ředitelské volno, nové kroužky, projekty).

Co vytvořit:
- Akce, kam může přijít veřejnost nebo rodiče s dětmi, s datem: event a k tomu krátký článek s pozvánkou. Termín ze školního kalendáře je u článku uvedený zvlášť. Akce jen pro žáky (třída jede na výlet) do kalendáře nedávej, stačí článek.
- Cokoli jiného: článek.

Pravidla:
- Data, časy, místa, jména, čísla a výsledky opiš přesně podle zdroje. Nic nevymýšlej. Když údaj chybí, nech pole prázdné. Rok doplň podle data zveřejnění článku.
- Jména dětí piš jen tak, jak je uvádí škola, a nepřidávej o nich nic dalšího (třídu, bydliště, rodinu), co ve zdroji není.
- Je-li přiložený plakát nebo fotka, vytáhni z něj údaje, které v textu chybí.
- rubric: zprávy ze školy a školky patří do rubriky "skola", pokud je v seznamu. Jinak vyber nejbližší.
{IMAGES}
- title: do 90 znaků, vlastní, bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: dva až čtyři krátké odstavce. Smíš použít jen <p>, <strong>, <em>, <ul>, <li> a <h3>. Odkaz na zdroj nepiš, drbna ho doplní sama.
- event.description: prostý text, jedna až tři věty.
- Datum piš jako RRRR-MM-DD a čas jako HH:MM.
- U části, kterou nevytváříš, dej include false a ostatní pole nech prázdná. Odstávky a uzavírky (notice) škola nehlásí, notice nech vždy include false.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const OWN_IMAGES = `- image_use: "vlastni" jen tehdy, když je přiložená skutečná fotka, která je sama o sobě pěkná (děti při akci, výstava, výlet, ocenění) a nese málo textu. Plakát, leták, pozvánka, logo, tabulka nebo koláž s textem jsou "knihovna". Když nic přiložené není, taky "knihovna".
- image_topic: téma z knihovny obrázků, které k článku nejlíp sedí (značka ze seznamu témat). Použije se, když vlastní fotka není. Když nesedí žádné, nech prázdné.
- image_caption: krátký popisek vlastní fotky, nebo prázdný text. Když škola u článku píše, kdo fotky pořídil nebo poskytl, přidej to do popisku. U "knihovna" vždy prázdný.`;

const STOCK_IMAGES = `- image_topic: téma z knihovny obrázků, které k článku nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné. Fotky ze školního webu se neberou, image_caption nech prázdné.`;

const FORCE = "Redakce chce tenhle článek zpracovat, i když jsi ho předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

export function skolaPrompt(voice, { ownPhotos = false } = {}) {
  const style = String(voice ?? "").trim() || DEFAULT_VOICE;
  return `${RULES.replace("{IMAGES}", ownPhotos ? OWN_IMAGES : STOCK_IMAGES)}\n\nHlas a styl textů:\n${style}`;
}

export function skolaText(item, known, { today, force = false, topics = [], images = 0 }) {
  return [
    `Dnes je ${today}.`,
    contextText(known),
    topicsText(topics),
    `Článek z webu ZŠ a MŠ Kopidlno${item.section ? `, rubrika ${item.section}` : ""} (zveřejněno ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    item.term ? `Termín v kalendáři školy: ${item.term}` : "",
    `Text:\n${item.text || "(bez textu, údaje jsou možná jen na obrázku)"}`,
    images ? `Přiložené obrázky: ${images}.` : "Bez přiloženého obrázku.",
    force ? FORCE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Jedno volání Claude. Obrázky vidí vždy (plakát nese údaje), vybrat vlastní fotku smí jen s `ownPhotos`.
export async function askSkola(env, { item, known, images = [], topics = [], rubricSlugs, voice, today, force = false, ownPhotos = false }) {
  const shown = visibleImages(images);
  const content = [
    ...shown.map((image) => ({ type: "image", source: { type: "base64", media_type: image.type, data: base64(image.bytes) } })),
    { type: "text", text: skolaText(item, known, { today, force, topics, images: shown.length }) },
  ];
  const schema = outputSchema(rubricSlugs, { topics: topics.map((topic) => topic.slug), ownImage: ownPhotos });
  const answer = await callClaude(env, { system: skolaPrompt(voice, { ownPhotos }), content, schema });
  if (!answer.ok) return answer;
  const decision = readDecision(answer.raw, { rubricSlugs, force });
  if (!decision.ok || decision.decision !== "vytvorit") return decision;
  // Odstávky škola nehlásí. Kdyby je Claude přesto vrátil, drbna je neuloží.
  if (!decision.article && !decision.event) return { ok: false, error: "Claude chtěl článek zpracovat, ale nevrátil zprávu ani akci." };
  return { ...decision, notice: null, hours: [] };
}
