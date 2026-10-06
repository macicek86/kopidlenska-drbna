// Týdenní článek „Kam vyrazit o víkendu“: Drběna dostane akce v Kopidlně z kalendáře drbny a akce z okolí
// (src/okoli/store.js) na pátek až neděli a napíše jeden článek. Kopidlno vždy první, z okolí jen výběr.
import { saveBotArticle } from "../bot-article.js";
import { callClaude } from "../claude.js";
import { loadDrbena } from "../drbena-db.js";
import { DEFAULT_VOICE, voiceFor } from "../drbena.js";
import { loadEvents } from "../events-db.js";
import { rubricMap } from "../import-context.js";
import { prepareArticleBody } from "../rich.js";
import { topicsText } from "../stock.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { pragueNow } from "../waste.js";
import { NEARBY_SOURCES } from "./sources.js";
import { loadNearbyEvents } from "./store.js";

export const WEEKEND_RUBRIC = "kam-vyrazit";
// Z okolí Drběna dostane nejvýš tolik akcí (kino jich má na víkend i deset).
const MAX_NEARBY = 60;
const DAY_NAMES = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

export function shiftDay(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();

// Nejbližší víkend: od pondělí do čtvrtka ten, který přijde; v pátek až neděli ten, který právě je (od dneška).
export function weekendFor(today) {
  const dow = weekday(today);
  const friday = dow === 5 ? today : dow === 6 ? shiftDay(today, -1) : dow === 0 ? shiftDay(today, -2) : shiftDay(today, 5 - dow);
  return { friday, from: dow === 5 || dow === 6 || dow === 0 ? today : friday, to: shiftDay(friday, 2) };
}

// Cron píše článek v pátek ráno (od šesti, i s pátečními akcemi); když se to nepovede, zkouší to do šesti večer.
export function weekendDue(settings, now = pragueNow()) {
  if (!settings.weekly) return null;
  if (weekday(now.date) !== 5 || now.time < "06:00" || now.time >= "18:00") return null;
  const weekend = weekendFor(now.date);
  return settings.weekendOn === weekend.friday ? null : weekend;
}

export function czechDay(day) {
  const [, month, date] = day.split("-").map(Number);
  return `${DAY_NAMES[weekday(day)]} ${date}. ${month}.`;
}

function eventLine(event, extra = "") {
  const when = `${czechDay(event.startsOn)}${event.startsTime ? ` v ${event.startsTime}` : ""}`;
  const about = event.description ? ` ${event.description.replace(/\s+/g, " ").slice(0, 320)}` : "";
  return `- ${when}, ${extra}${event.place}: ${event.title}.${event.soldOut ? " VYPRODÁNO." : ""}${about} Odkaz: ${event.link}`;
}

// Kopidlenská akce odkazuje na svou zprávu na drbně, jinak na kartu v kalendáři akcí.
export function kopidlnoLink(event) {
  return event.articleSlug ? `/zpravy/${event.articleSlug}` : `/akce#akce-${event.id}`;
}

const KINDS = { divadlo: "divadlo", kino: "kino", akce: "akce" };

export function weekendText({ today, weekend, home, nearby, radiusKm, topics }) {
  const range = `${czechDay(weekend.from)} až ${czechDay(weekend.to)} ${weekend.to.slice(0, 4)}`;
  const homeLines = home.map((event) => eventLine({ ...event, link: kopidlnoLink(event) }));
  const nearLines = nearby
    .slice(0, MAX_NEARBY)
    .map((event) => eventLine(event, `${event.town} (${event.km} km)${KINDS[event.kind] ? `, ${KINDS[event.kind]}` : ""}, `));
  return [
    `Dnes je ${czechDay(today)} ${today.slice(0, 4)}. Článek je na víkend: ${range}.`,
    `Akce v Kopidlně (z kalendáře drbny):\n${homeLines.join("\n") || "Žádné."}`,
    `Akce v okolí (do ${radiusKm} km):\n${nearLines.join("\n") || "Žádné."}`,
    topicsText(topics),
  ].join("\n\n");
}

const RULES = `Jednou týdně píšeš na web Kopidlenská drbna článek o tom, kam o víkendu vyrazit. Dostaneš akce v Kopidlně z kalendáře drbny a akce z okolí ze stažených programů.

Jak článek poskládat:
- Nejdřív Kopidlno: všechny kopidlenské akce z přehledu, každou s dnem, časem a místem. Kopidlno je doma, má přednost.
- Pak okolí: vyber 3 až 6 akcí, které za cestu stojí. Dej přednost jedinečným akcím (koncert, divadlo, přednáška, pohádka pro děti) před běžným promítáním. Z kina vyber nejvýš dva filmy, spíš zvláštní promítání (předpremiéra, přenos opery nebo baletu, film pro děti o víkendu). Vyprodané nedoporučuj. Snaž se o pestrost: něco pro rodiny s dětmi, něco na večer. U každé akce napiš město a místo, den a čas a v kostce, o co jde.
- Když se v Kopidlně o víkendu nic nekoná, řekni to jednou lehkou větou a pokračuj okolím. Když je jen Kopidlno, okolí vynech.
- Když v přehledu není nic, co by stálo za doporučení, dej write false a zbytek nech prázdný.

Pravidla:
- Názvy, dny, časy a místa opiš přesně podle přehledu. Nic nevymýšlej: žádné ceny, účinkující, program ani zajímavosti, které v přehledu nejsou.
- Každou akci, o které píšeš, odkaž jednou: <a href="adresa">název</a>. Adresu opiš z přehledu (u kopidlenských začíná lomítkem). Jiné adresy nepiš.
- title: do 90 znaků, vlastní a pokaždé jiný, ať je poznat, co tenhle víkend nabízí. Bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: krátký úvod, pak Kopidlno a okolí, každé pod vlastním <h3>. Akce jako krátké odstavce nebo seznam. Smíš použít jen <p>, <strong>, <em>, <ul>, <li>, <h3> a <a>.
- image_topic: téma z knihovny obrázků, které k článku nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné.
- reason: jedna věta pro redakci, co jsi vybrala a proč (nebo proč článek není).`;

export function weekendPrompt(voice) {
  return `${RULES}\n\nHlas a styl textů:\n${String(voice ?? "").trim() || DEFAULT_VOICE}`;
}

export function weekendSchema(topics = []) {
  const text = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["write", "reason", "title", "excerpt", "body_html", "image_topic"],
    properties: {
      write: { type: "boolean" },
      reason: text,
      title: text,
      excerpt: text,
      body_html: text,
      image_topic: { type: "string", enum: [...new Set([...topics, ""])] },
    },
  };
}

const cleanText = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function readWeekend(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Claude nevrátil článek." };
  const reason = cleanText(raw.reason, 400);
  if (!raw.write) return { ok: true, write: false, reason };
  const body = prepareArticleBody(String(raw.body_html ?? "").slice(0, 20000));
  const title = cleanText(raw.title, 160);
  const excerpt = cleanText(raw.excerpt, 320);
  if (title.length < 3 || excerpt.length < 3 || body.text.length < 20) return { ok: false, error: "Claude vrátil neúplný článek." };
  return { ok: true, write: true, reason, article: { title, excerpt, body: body.html, keywords: "" }, imageTopic: cleanText(raw.image_topic, 60) };
}

// Pod článek: odkud je program okolí.
export function weekendSource(nearby) {
  const used = NEARBY_SOURCES.filter((source) => nearby.some((event) => event.source === source.tag));
  if (!used.length) return "";
  const links = used.map((source) => `<a href="${source.home}" target="_blank" rel="noopener noreferrer">${source.name}</a>`).join(", ");
  return `<p><em>Program akcí v okolí: ${links}</em></p>`;
}

// Podklady pro článek na víkend `weekend` (weekendFor).
export async function weekendInput(env, weekend, radiusKm) {
  const events = await loadEvents(env, { publicOnly: true });
  const home = events.filter((event) => event.startsOn >= weekend.from && event.startsOn <= weekend.to);
  const nearby = await loadNearbyEvents(env, { from: weekend.from, to: weekend.to, radiusKm });
  return { home, nearby };
}

function weekendRubric(rubrics) {
  return rubrics.get(WEEKEND_RUBRIC) ?? rubrics.get("kultura") ?? [...rubrics.values()][0];
}

// Napíše článek na víkend. Vrací { ok, note, articleId?, proposalId? }; bez akcí Claude vůbec nevolá.
export async function writeWeekend(env, settings, weekend, { ask = callClaude } = {}) {
  const today = pragueNow().date;
  const { home, nearby } = await weekendInput(env, weekend, settings.radiusKm);
  if (!home.length && !nearby.length) return { ok: true, note: `Na víkend od ${czechDay(weekend.from)} nejsou žádné akce, článek nevyšel.` };
  const topics = await loadStockTopics(env);
  const drbena = await loadDrbena(env);
  const answer = await ask(env, {
    system: weekendPrompt(voiceFor(drbena)),
    content: [{ type: "text", text: weekendText({ today, weekend, home, nearby, radiusKm: settings.radiusKm, topics }) }],
    schema: weekendSchema(topics.map((topic) => topic.slug)),
  });
  if (!answer.ok) return answer;
  const result = readWeekend(answer.raw);
  if (!result.ok) return result;
  if (!result.write) return { ok: true, note: `Článek na víkend nevyšel: ${result.reason || "není co doporučit."}` };
  const rubric = weekendRubric(await rubricMap(env));
  if (!rubric) return { ok: false, error: "Na webu není žádná rubrika." };
  const made = await saveBotArticle(env, {
    article: result.article,
    image: await pickStockImage(env, result.imageTopic),
    sourceHtml: weekendSource(nearby),
    autoPublish: settings.autoPublish,
    rubric,
  });
  const where = made.articleId ? "vyšel" : "čeká jako návrh";
  return { ok: true, note: `Článek „${result.article.title}“ ${where}. ${result.reason}`.trim(), ...made };
}
