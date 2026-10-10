// Článek „Kam vyrazit“: Drběna dostane akce v Kopidlně z kalendáře drbny a akce z okolí (src/okoli/store.js)
// na období (víkend, volno se svátkem, samostatný svátek nebo pracovní týden, src/okoli/outings.js) a napíše jeden článek.
// Kopidlno vždy první, z okolí jen výběr. Víkendový a týdenní článek se den překrývají: Drběna dostane předchozí
// článek a akce, o kterých už psala, jen připomene.
import { sourceEntry } from "../article-source.js";
import { saveBotArticle } from "../bot-article.js";
import { publishNote } from "../publish-time.js";
import { htmlText } from "../chat/prompt.js";
import { callClaude } from "../claude.js";
import { loadDrbena } from "../drbena-db.js";
import { DEFAULT_VOICE, voiceFor } from "../drbena.js";
import { loadEvents } from "../events-db.js";
import { loadHomeFixtures } from "../fotbal/fixtures-db.js";
import { rubricMap } from "../import-context.js";
import { prepareArticleBody } from "../rich.js";
import { topicsText } from "../stock.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { pragueNow } from "../waste.js";
import { czechDay, shiftDay } from "./outings.js";
import { NEARBY_SOURCES } from "./sources.js";
import { loadNearbyEvents } from "./store.js";

export const WEEKEND_RUBRIC = "kam-vyrazit";
// Z okolí Drběna dostane nejvýš tolik akcí (kino jich má na víkend i deset).
const MAX_NEARBY = 60;
function eventLine(event, extra = "") {
  const short = (day) => czechDay(day).replace(/^\S+ /, "");
  const days = event.endsOn && event.endsOn > event.startsOn ? `od ${short(event.startsOn)} do ${short(event.endsOn)}` : czechDay(event.startsOn);
  const when = `${days}${event.startsTime ? ` v ${event.startsTime}` : ""}`;
  const about = event.description ? ` ${event.description.replace(/\s+/g, " ").slice(0, 320)}` : "";
  return `- ${when}, ${extra}${event.place}: ${event.title}.${event.soldOut ? " VYPRODÁNO." : ""}${about} Odkaz: ${event.link}`;
}

// Kopidlenská akce odkazuje na svou zprávu na drbně, jinak na kartu v kalendáři akcí.
export function kopidlnoLink(event) {
  return event.articleSlug ? `/zpravy/${event.articleSlug}` : `/akce#akce-${event.id}`;
}

// Domácí zápas FK Kopidlno z oficiálního rozpisu (src/fotbal/fixtures-db.js). Do kalendáře akcí se nedává, jen sem.
export function footballLine(fixture) {
  const time = fixture.time ? ` v ${fixture.time}` : "";
  return `- ${czechDay(fixture.date)}${time}, hřiště v Kopidlně: ${fixture.home} – ${fixture.away} (muži, okresní soutěž).`;
}

const KINDS = { divadlo: "divadlo", kino: "kino", akce: "akce" };

// Jak období nazvat v poznámkách redakci.
export function periodLabel(period) {
  return { volno: "volno", svatek: "svátek", dny: "dny", tyden: "pracovní týden" }[period.kind] ?? "víkend";
}

const rangeText = (from, to) => (from === to ? `${czechDay(from)} ${from.slice(0, 4)}` : `${czechDay(from)} až ${czechDay(to)} ${to.slice(0, 4)}`);

function periodLine(period) {
  const holidays = (period.holidays ?? []).map((holiday) => `${holiday.name} (${czechDay(holiday.day)})`).join(", ");
  // Víkend (volno) prodloužený do začátku týdne, src/okoli/outings.js `withWeekdays`.
  const offTo = period.offTo ?? period.to;
  const range = rangeText(period.from, offTo);
  const after = period.weekAfter ? " Večer před posledním z těch dnů vyjde článek na pracovní týden." : " Další článek vyjde až před dalším volnem.";
  const tail = period.offTo ? ` K tomu pracovní dny po něm: ${rangeText(shiftDay(period.offTo, 1), period.to)}.${after}` : "";
  if (period.kind === "svatek") return `Článek je na samostatný svátek uprostřed týdne: ${range}. Svátek: ${holidays}.`;
  if (period.kind === "volno") return `Článek je na volno se svátkem: ${range}.${tail} Svátky: ${holidays}.`;
  if (period.kind === "dny") return `Článek je na dny, které vybrala redakce: ${range}.${holidays ? ` Svátky v nich: ${holidays}.` : ""}`;
  if (period.kind === "tyden") return `Článek je na pracovní týden: ${range}.${period.manual ? "" : " Vychází večer předem."}${holidays ? ` Svátky v něm: ${holidays}.` : ""}`;
  return `Článek je na víkend: ${range}.${tail}${holidays ? ` Svátky: ${holidays}.` : ""}`;
}

// Předchozí článek Kam vyrazit (nejvýš týden starý, zveřejněný i návrh), ať Drběna u dnů, které se překrývají,
// akce jen připomene. Vrací { title, text, day } nebo null.
export async function previousOuting(env, today) {
  const since = shiftDay(today, -7);
  const query = (table, extra) =>
    env.DB.prepare(
      `select t.id, t.title, t.body, t.created_at as day from ${table} t join rubrics r on r.id = t.rubric_id
       where r.slug = ? and t.created_at >= ?${extra} order by t.created_at desc, t.id desc limit 1`,
    )
      .bind(WEEKEND_RUBRIC, since)
      .first();
  const rows = (await Promise.all([query("articles", ""), query("proposals", " and t.status = 'pending'")])).filter(Boolean);
  const last = rows.sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
  return last ? { title: String(last.title), text: htmlText(last.body).slice(0, 6000), day: String(last.day).slice(0, 10) } : null;
}

function previousText(previous) {
  if (!previous) return "";
  return `Předchozí článek Kam vyrazit (${czechDay(previous.day)}): ${previous.title}\n${previous.text}`;
}

export function weekendText({ today, weekend, home, nearby, radiusKm, topics, previous = null, football = [] }) {
  const homeLines = home.map((event) => eventLine({ ...event, link: kopidlnoLink(event) }));
  const nearLines = nearby
    .slice(0, MAX_NEARBY)
    .map((event) => eventLine(event, `${event.town} (${event.km} km)${KINDS[event.kind] ? `, ${KINDS[event.kind]}` : ""}, `));
  return [
    `Dnes je ${czechDay(today)} ${today.slice(0, 4)}. ${periodLine(weekend)}`,
    `Akce v Kopidlně (z kalendáře drbny):\n${homeLines.join("\n") || "Žádné."}`,
    football.length ? `Fotbal v Kopidlně (domácí zápasy FK Kopidlno z oficiálního rozpisu, nejsou v kalendáři drbny):\n${football.map(footballLine).join("\n")}` : "",
    `Akce v okolí (do ${radiusKm} km):\n${nearLines.join("\n") || "Žádné."}`,
    previousText(previous),
    topicsText(topics),
  ]
    .filter(Boolean)
    .join("\n\n");
}

const RULES = `Před víkendem, před svátky a na pracovní týden píšeš na web Kopidlenská drbna článek o tom, kam vyrazit. Dostaneš akce v Kopidlně z kalendáře drbny a akce z okolí ze stažených programů.

Na jaké dny článek je, stojí v přehledu:
- Víkend: piš o víkendu.
- Víkend (nebo volno) a k tomu pracovní dny po něm: hlavní je víkend. Pracovní dny po něm dej na konec, krátce a věcněji, jako výhled (nejvýš jeden odstavec, u víc než dvou dnů klidně dva). Když se v nich nic neděje, vynech je.
- Pracovní týden: článek obvykle vychází večer předem. Začni tím, že je tu další pracovní týden (pokaždé jinými slovy). Pořád povídáš, ale pracovně: věcněji a stručněji, jako kolegům v práci, co se dá v týdnu stihnout po práci a po škole. Kopidlno první, z okolí nejvýš tři akce, z kina nejvýš jeden film. Dva až čtyři odstavce. O sobotě a neděli nepiš, víkend má vlastní článek; páteční akce ale do týdne patří. Když je v týdnu svátek, řekni jaký a že je volno: ten den se nepracuje, akce v něm doporuč jako na volný den (klidně dopolední nebo celodenní výlet), ne po práci.
- Volno se svátkem: řekni, jaký svátek to je, a piš o celém volnu (prodloužený víkend, Velikonoce, Vánoce), ne jen o víkendu. Akce rozlož do všech volných dnů.
- Dny, které vybrala redakce: piš o těch dnech. Svátek v nich zmiň, u jednoho nebo dvou dnů piš krátce.
- Samostatný svátek uprostřed týdne: krátký článek jen o ten den. Řekni, jaký je svátek, z okolí vyber nejvýš tři akce a napiš dva až tři odstavce.

Jak článek poskládat:
- Nejdřív Kopidlno: všechny kopidlenské akce z přehledu, každou s dnem, časem a místem. Kopidlno je doma, má přednost.
- Pak okolí: vyber 3 až 6 akcí, které za cestu stojí. Dej přednost jedinečným akcím (koncert, divadlo, přednáška, pohádka pro děti) před běžným promítáním. Z kina vyber nejvýš dva filmy, spíš zvláštní promítání (předpremiéra, přenos opery nebo baletu, film pro děti o víkendu). Vyprodané nedoporučuj. Snaž se o pestrost: něco pro rodiny s dětmi, něco na večer. U každé akce musí čtenář z textu poznat město a místo, den a čas a v kostce, o co jde.
- Fotbal: domácí zápasy z oddílu „Fotbal v Kopidlně“ jsou jen drobnost, ne téma článku. Zmiň je jednou krátkou větou na konci kopidlenské části (den, čas, s kým hraje naše mužstvo), bez odkazu. Nepatří do title ani do excerpt a nesmí ovlivnit, které akce článek vyzdvihne. Na zápasy chodíš na tribunu, ne na lavičku. Průběh, tabulku, očekávání ani jména hráčů nevymýšlej a nepiš. Víc zápasů jedním dechem. Když je stejný zápas už mezi akcemi v Kopidlně, napiš ho jen jednou.
- Akce z okolí, která se koná přímo v Kopidle (místo v přehledu), patří ke kopidlenským. Když je stejná jako některá kopidlenská, napiš ji jen jednou.
- Vícedenní akci (festival, výstava) piš s rozsahem dní, ne jen prvním dnem.
- Když se v Kopidlně v těch dnech nic nekoná, řekni to jednou lehkou větou a pokračuj okolím. Když je jen Kopidlno, okolí vynech.
- Když v přehledu není nic, co by stálo za doporučení, dej write false a zbytek nech prázdný.
- Když je v přehledu předchozí článek Kam vyrazit: akce, o kterých jsi v něm už psala, jen krátce připomeň (jednou větou, třeba „jak už Drběna psala, …“, v osobě, jakou určuje povaha), i s odkazem. Nové akce, které v něm nebyly, rozepiš normálně. Věty z něj neopakuj.

Pravidla:
- O přehledu ani o podkladech nepiš („podle přehledu“, „v kalendáři mám“), piš, jako bys to věděla sama.
- Názvy, dny, časy a místa opiš přesně podle přehledu. Nic nevymýšlej: žádné ceny, účinkující, program ani zajímavosti, které v přehledu nejsou.
- Každou akci, o které píšeš, odkaž jednou: <a href="adresa">název</a>. Adresu opiš z přehledu (u kopidlenských začíná lomítkem). Jiné adresy nepiš.
- title: do 90 znaků, vlastní a pokaždé jiný, ať je poznat, co tyhle dny nabízejí; vyber z nejzajímavějších akcí (klidně tři, třeba „Kvítí v zámecké zahradě, draci nad Vitiněvsí a cesta k pramenům“), ne z fotbalu. Bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: povídání, ne výčet. Piš souvislé odstavce, jako když sousedům u plotu vyprávíš, co se v těch dnech děje a kam se sama chystáš (u pracovního týdne věcněji, viz výše). Akce propoj do příběhu volných dnů (dopoledne, odpoledne, večer, další den), přecházej mezi nimi přirozeně a u každé řekni, proč by tam někdo měl jít, ale jen z toho, co je v přehledu. Den, čas a místo vpleť do věty, nepiš je jako hlavičku. Žádné seznamy ani tučné řádky s časem. Kopidlno dej na začátek, okolí po něm; nadpis <h3> smíš použít nanejvýš jednou, když se přechází do okolí, klidně vůbec. Tři až šest odstavců, u samostatného svátku dva až tři, u pracovního týdne dva až čtyři. Smíš použít jen <p>, <strong>, <em>, <h3> a <a>.
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

// Zdroj pod čarou (src/article-source.js): odkud je program okolí.
export function weekendSource(nearby, football = []) {
  const used = NEARBY_SOURCES.filter((source) => nearby.some((event) => event.source === source.tag));
  const entries = used.map((source) => sourceEntry(source.name, source.home));
  if (football.length) entries.push(sourceEntry("fotbalunas.cz", "https://fotbalunas.cz/"));
  return entries.join(", ");
}

// Stejná akce z víc zdrojů (jicin.org přebírá program KZMJ): stejný den, čas a začátek názvu. Zůstane první.
export function dedupeNearby(events) {
  const seen = new Set();
  return events.filter((event) => {
    const name = event.title.toLocaleLowerCase("cs").normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 14);
    const key = `${event.startsOn} ${event.startsTime} ${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Podklady pro článek na období `weekend` (src/okoli/outings.js).
export async function weekendInput(env, weekend, radiusKm) {
  const events = await loadEvents(env, { publicOnly: true });
  const home = events.filter((event) => !event.cancelled && event.startsOn >= weekend.from && event.startsOn <= weekend.to);
  const nearby = dedupeNearby(await loadNearbyEvents(env, { from: weekend.from, to: weekend.to, radiusKm }));
  // Rozpis fotbalu je navíc: když se nenačte, článek vyjde bez něj.
  const football = await loadHomeFixtures(env, weekend.from, weekend.to).catch(() => []);
  return { home, nearby, football };
}

function weekendRubric(rubrics) {
  return rubrics.get(WEEKEND_RUBRIC) ?? rubrics.get("kultura") ?? [...rubrics.values()][0];
}

// Napíše článek na období. Vrací { ok, note, articleId?, proposalId? }; bez akcí Claude vůbec nevolá.
export async function writeWeekend(env, settings, weekend, { ask = callClaude } = {}) {
  const today = pragueNow().date;
  const { home, nearby, football } = await weekendInput(env, weekend, settings.radiusKm);
  if (!home.length && !nearby.length) return { ok: true, note: `Na ${periodLabel(weekend)} od ${czechDay(weekend.from)} nejsou žádné akce, článek nevyšel.` };
  const [topics, drbena, previous] = await Promise.all([loadStockTopics(env), loadDrbena(env), previousOuting(env, today)]);
  const answer = await ask(env, {
    system: weekendPrompt(voiceFor(drbena)),
    content: [{ type: "text", text: weekendText({ today, weekend, home, nearby, football, radiusKm: settings.radiusKm, topics, previous }) }],
    schema: weekendSchema(topics.map((topic) => topic.slug)),
  });
  if (!answer.ok) return answer;
  const result = readWeekend(answer.raw);
  if (!result.ok) return result;
  if (!result.write) return { ok: true, note: `Článek na ${periodLabel(weekend)} nevyšel: ${result.reason || "není co doporučit."}` };
  const rubric = weekendRubric(await rubricMap(env));
  if (!rubric) return { ok: false, error: "Na webu není žádná rubrika." };
  const made = await saveBotArticle(env, {
    article: result.article,
    image: await pickStockImage(env, result.imageTopic),
    source: weekendSource(nearby, football),
    autoPublish: settings.autoPublish,
    publishTime: weekend.manual ? "" : weekend.kind === "tyden" ? settings.weekPublishTime : settings.publishTime,
    rubric,
  });
  const where = made.articleId ? publishNote(made.publishedAt) : "čeká jako návrh";
  return { ok: true, note: `Článek „${result.article.title}“ ${where}. ${result.reason}`.trim(), ...made };
}
