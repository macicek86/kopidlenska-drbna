// Pomocník při psaní zprávy: Drběna přepíše podklady redaktora svým hlasem, nebo text jen učeše.
// K tomu navrhne rubriku a téma fotky z knihovny. Nic neukládá, výsledek jde zpátky do formuláře.
import { callClaude } from "../claude.js";
import { CHAT_MODELS } from "../chat/ai.js";
import { prepareArticleBody } from "../rich.js";
import { topicsText } from "../stock.js";

export const ASSIST_MODEL = "sonnet";
export const ASSIST_MODES = {
  drbena: "Přepsat hlasem Drběny",
  ucesat: "Jen učesat",
};
export const ASSIST_TEXT_MIN = 20;

const FORMAT = `Formát:
- title: nadpis do 90 znaků, nese hlavní informaci, bez emoji a bez psaní velkými písmeny.
- excerpt: perex, jedna až dvě věty do 220 znaků.
- body_html: text zprávy. Smíš použít jen <p>, <strong>, <em>, <u>, <ul>, <ol>, <li>, <h2>, <h3>, <blockquote> a <a href="…">. Odkazy z podkladů zachovej, nové nevymýšlej.
- České uvozovky „takhle“, pomlčka – mezi slovy, data jako 18. října 2026, časy jako 14:00.
- rubric: značka rubriky ze seznamu, kam zpráva nejlíp patří.
- image_topic: téma z knihovny obrázků, které ke zprávě sedí (značka ze seznamu). Když nesedí žádné, nech prázdné.
- note: jedna krátká věta pro redaktora, třeba co v podkladech chybělo (čas, místo), nebo prázdný text.`;

const RULES = {
  drbena: `Redaktor Kopidlenské drbny ti posílá podklady ke zprávě: hotový text, rozepsaný článek, nebo jen pár poznámek v bodech. Napiš z nich zprávu svým hlasem podle povahy níž.

Pravidla:
- Použij všechno podstatné z podkladů. Data, časy, místa, jména, ceny a telefony opiš přesně.
- Nic nevymýšlej. Co v podkladech není, do zprávy nepiš, ani jako odhad. Když něco důležitého chybí, řekni to v note.
- Zprávu podej jako novinku pro sousedy, ne jako převyprávěné oznámení.
- Dva až pět krátkých odstavců, výčty jako odrážky.

${FORMAT}`,
  ucesat: `Redaktor Kopidlenské drbny ti posílá svou zprávu. Učeš ji: oprav pravopis, interpunkci, překlepy a neobratné věty, ať se dobře čte.

Pravidla:
- Je to jeho text. Zachovej jeho hlas, styl, obsah i délku. Nic nepřidávej a nic podstatného neubírej. Žádné vtipy ani komentáře navíc.
- Odstavce, nadpisy, seznamy, tučné a odkazy nech, jak jsou, jen je oprav. Dlouhý odstavec smíš rozdělit, výčet v jedné větě smíš dát do odrážek.
- Data, časy, místa, jména, ceny a telefony nech přesně. Rozepsanou zkratku nebo zjevný překlep ve jméně neopravuj, upozorni na něj v note.
- Když nadpis nebo perex chybí, napiš ho podle textu. Když jsou, jen je oprav.

${FORMAT}`,
};

export function assistSchema(rubricSlugs, topics) {
  const string = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "excerpt", "body_html", "rubric", "image_topic", "note"],
    properties: {
      title: string,
      excerpt: string,
      body_html: string,
      rubric: { type: "string", enum: rubricSlugs.length ? rubricSlugs : ["zpravy"] },
      image_topic: { type: "string", enum: [...new Set([...topics, ""])] },
      note: string,
    },
  };
}

export function assistSystem(mode, voice) {
  if (mode === "ucesat") return RULES.ucesat;
  return `${RULES.drbena}\n\nHlas a styl:\n${voice}`;
}

// Rubriky pro Claude: značka a jméno, podrubrika i se svou rubrikou („Komunita › Škola“).
export function rubricsText(rubrics) {
  const names = new Map(rubrics.map((row) => [row.id, row.name]));
  const rows = rubrics.map((row) => `- ${row.slug}: ${row.parentId && names.has(row.parentId) ? `${names.get(row.parentId)} › ` : ""}${row.name}`);
  return `Rubriky:\n${rows.join("\n")}`;
}

export function assistUserText(input, { today, rubrics, topics, rubric }) {
  return [
    `Dnes je ${today}.`,
    rubricsText(rubrics),
    topicsText(topics),
    rubric ? `Redaktor má zatím vybranou rubriku ${rubric}. Nech ji, pokud se zpráva jasně nehodí jinam.` : "",
    `Nadpis: ${input.title || "(zatím bez nadpisu)"}`,
    `Perex: ${input.excerpt || "(zatím bez perexu)"}`,
    `Text:\n${input.body || "(prázdný)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Ověří odpověď. Vrací { ok: true, title, excerpt, body, rubric, imageTopic, note } nebo { ok: false, error }.
export function readAssist(raw, { rubricSlugs, topics }) {
  const prepared = prepareArticleBody(String(raw?.body_html ?? "").slice(0, 20000));
  const title = clean(raw?.title, 160);
  const excerpt = clean(raw?.excerpt, 320);
  if (title.length < 3 || excerpt.length < 3 || prepared.text.length < 3) return { ok: false, error: "Drběně se text nepovedl. Zkuste to znovu." };
  return {
    ok: true,
    title,
    excerpt,
    body: prepared.html,
    rubric: rubricSlugs.includes(raw.rubric) ? raw.rubric : "",
    imageTopic: topics.includes(raw.image_topic) ? raw.image_topic : "",
    note: clean(raw.note, 300),
  };
}

// Cena odpovědi v dolarech podle ceníku Sonnetu.
export function assistCost(usage) {
  const price = CHAT_MODELS[ASSIST_MODEL].price;
  const cost =
    Number(usage?.input_tokens ?? 0) * price.input +
    Number(usage?.output_tokens ?? 0) * price.output +
    Number(usage?.cache_read_input_tokens ?? 0) * price.read +
    Number(usage?.cache_creation_input_tokens ?? 0) * price.write;
  return cost / 1_000_000;
}

// `input`: { mode, title, excerpt, body } (body jako HTML). `rubrics`: [{ id, parentId, name, slug }],
// `topics`: témata knihovny s fotkami. Vrací výsledek readAssist a k němu `cost` (i u chyby, když Claude odpověděl).
export async function askAssist(env, { input, voice, today, rubrics, topics, rubric }) {
  const rubricSlugs = rubrics.map((row) => row.slug);
  const topicSlugs = topics.map((topic) => topic.slug);
  const answer = await callClaude(env, {
    model: CHAT_MODELS[ASSIST_MODEL].id,
    effort: input.mode === "ucesat" ? "low" : "medium",
    system: assistSystem(input.mode, voice),
    content: assistUserText(input, { today, rubrics, topics, rubric }),
    schema: assistSchema(rubricSlugs, topicSlugs),
  });
  if (!answer.ok) return { ...answer, cost: 0 };
  return { ...readAssist(answer.raw, { rubricSlugs, topics: topicSlugs }), cost: assistCost(answer.usage) };
}
