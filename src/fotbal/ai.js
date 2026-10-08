// Claude napíše z aktuality FK Kopidlno článek hlasem kozy Drběny: zprávu po zápase, pozvánku nebo klubovou novinku.
import { callClaude } from "../claude.js";
import { prepareArticleBody } from "../rich.js";
import { DEFAULT_FOOTBALL_VOICE } from "../drbena.js";
import { KEYWORDS_RULE, keywordsSchema, readKeywords } from "../keywords.js";
import { readRecall } from "../drbena-memory.js";
import { addArticles, recentSection, relatedSection } from "../import-overview.js";
import { footballLookup, withLookups } from "../import-tools.js";

export { DEFAULT_FOOTBALL_VOICE };

const RULES = `Dostaneš jednu aktualitu z webu fotbalového klubu FK Kopidlno a přehled toho, co už na webu Kopidlenská drbna je. Napiš z ní článek do fotbalové rubriky drbny.

Druh aktuality je napsaný u ní:
- "Po zápase": zpráva o odehraném zápase. Hlavní je výsledek, kdo dal góly a jak zápas vypadal. Zmiň, jak si tým stojí v tabulce, když ji máš.
- "Pozvánka": zápas, který se teprve hraje. Pozvi sousedy na hřiště: kdo s kým, kdy, kde a v jaké soutěži. Když se zápas podle data už odehrál, zvol "preskocit".
- "Klubová zpráva": ostatní novinky klubu. Když pro čtenáře drbny nemá smysl (kronika, interní věci, prázdný text), zvol "preskocit".

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je článek nebo čekající návrh. Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Pozvánka a zpráva po stejném zápase nejsou duplicita.
- "preskocit": viz výše.
- "vytvorit": všechno ostatní.

Pravidla:
- Výsledek, góly, minuty, jména, data, časy a místa opiš přesně podle zdroje. Nic nevymýšlej, ani průběh zápasu, který ve zdroji není. Když údaj chybí, nepiš ho.
- Řádek „Oficiálně (fotbalunas.cz)“ jsou údaje svazu. Týmy (i jestli hrálo A, B, nebo C), datum, čas, výsledek a střelci podle něj platí, i když klub v aktualitě píše něco jiného. Rozpor v článku nezmiňuj, prostě piš správně. Celé jméno střelce smíš vzít z webu klubu, když sedí příjmení.
- Skóre piš jako 7:6, poločas v závorce (3:3). Jména hráčů piš tak, jak jsou ve zdroji.
- V přehledu a v oddílu „Možná souvisí“ (když je, ukazuje starší zprávy z archivu drbny) najdeš i dřívější zápasy. U zápasu smíš jednou větou připomenout předchozí zápas stejného týmu (A, B, nebo C) se stejným soupeřem, třeba „Na podzim Céčko Libuň doma porazilo 3:1.“ Řekni, kdy to bylo, a ber jen výsledek a fakta z nadpisu a perexu té zprávy. Když si nejsi jistá, že jde o stejný tým i soupeře, nepiš to. Výsledek dnešního zápasu má vždy přednost.
- Taková věta a vzpomínka na akci (když ji pokyny dovolují) dohromady nanejvýš jednou v článku.
- Víkend: když je v přehledu zpráva (zprava:…) o jiném zápase Kopidla ze stejného víkendu (třeba sobotní, a ty píšeš o nedělním, klidně jiného týmu), navaž na ni jednou větou, třeba „Po sobotní výhře áčka si v neděli zahrálo i béčko.“ Ber jen výsledek a fakta z jejího nadpisu a perexu. Do follows dej její značku, drbna pod článek přidá odkaz. Jinak nech follows prázdné. Tahle věta se do limitu výše nepočítá.
- Kopidlno může hrát doma i venku. Kdo je domácí, poznáš podle pořadí v nadpisu (první je domácí).
- title: do 90 znaků, bez emoji a bez psaní velkými písmeny. U zápasu ať je v nadpisu výsledek nebo soupeř.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: dva až čtyři krátké odstavce. Smíš použít jen <p>, <strong>, <em>, <ul>, <li> a <h3>. Odkaz na zdroj nepiš, drbna ho doplní sama.
${KEYWORDS_RULE} U zápasu dej do nich soupeře, soutěž a datum zápasu.
- recall: značka akce, na kterou v článku vzpomínáš (jen když to dovolují pravidla paměti), třeba "akce:12". Jinak prázdné.
- U "preskocit" a "duplicita" nech článek prázdný i follows.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const FORCE = "Redakce chce tuhle aktualitu zpracovat, i když jsi ji předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

export const KIND_LABEL = { zapas: "Po zápase", pozvanka: "Pozvánka", clanek: "Klubová zpráva" };

export function footballSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reason", "duplicate_of", "title", "excerpt", "body_html", "keywords", "recall", "follows"],
    properties: {
      decision: { type: "string", enum: ["vytvorit", "preskocit", "duplicita"] },
      reason: { type: "string" },
      duplicate_of: { type: "string" },
      title: { type: "string" },
      excerpt: { type: "string" },
      body_html: { type: "string" },
      keywords: keywordsSchema(),
      recall: { type: "string" },
      follows: { type: "string" },
    },
  };
}

export function footballPrompt(voice) {
  const style = String(voice ?? "").trim() || DEFAULT_FOOTBALL_VOICE;
  return `${RULES}\n\nHlas a styl textů:\n${style}`;
}

// Přehled zpráv, s pamětí i akce z posledních dní (`known.recent`).
export function footballContext(known) {
  const parts = [];
  addArticles((heading, rows) => parts.push(`${heading}:\n${rows.length ? rows.join("\n") : "(nic)"}`), known);
  const recent = recentSection(known.recent);
  if (recent) parts.push(recent);
  return parts.join("\n\n");
}

// Claude o rozporu ví, ať ho nezakryje sebejistým textem. Opraví ho redakce, článek jde jako návrh.
function doubtNote(doubts) {
  if (!doubts?.length) return "";
  return `Pozor, datum ve zdroji nesedí: ${doubts.join(" ")}\nNeopravuj ho podle sebe a nevymýšlej. Den a datum zápasu napiš jen jednou, přesně jako ve zdroji, redakce je před zveřejněním zkontroluje.`;
}

// Co klub spletl a co platí podle fotbalunas.cz. Drběna píše opravené údaje.
function fixNote(fixes) {
  if (!fixes?.length) return "";
  return `Klub se v aktualitě spletl, platí oficiální údaje z fotbalunas.cz: ${fixes.join(" ")}\nPiš podle oficiálních údajů.`;
}

export function footballText(item, known, { today, force = false, doubts = [], fixes = [] }) {
  return [
    `Dnes je ${today}.`,
    footballContext(known),
    relatedSection(known.related),
    `Aktualita z webu FK Kopidlno (druh: ${KIND_LABEL[item.kind] ?? item.kind}, zveřejněno ${item.publishedOn || "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    `Text:\n${item.text || "(bez textu)"}`,
    item.extra ? `Doplněno z rozpisu a tabulky (web klubu a fotbalunas.cz):\n${item.extra}` : "",
    fixNote(fixes),
    doubtNote(doubts),
    force ? FORCE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const REF = /^(zprava|navrh|fotbal):\d+$/;

// Zpráva ze stejného víkendu, na kterou článek navazuje („zprava:12“ → 12), jinak null.
function readFollows(value) {
  const match = String(value ?? "").trim().match(/^zprava:(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function readFootballDecision(raw, { force = false } = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Claude nevrátil rozhodnutí." };
  let decision = ["vytvorit", "preskocit", "duplicita"].includes(raw.decision) ? raw.decision : "";
  if (!decision) return { ok: false, error: "Claude nevrátil rozhodnutí." };
  if (force) decision = "vytvorit";
  const reason = clean(raw.reason, 400);
  const duplicateOf = REF.test(String(raw.duplicate_of ?? "").trim()) ? String(raw.duplicate_of).trim() : "";
  if (decision !== "vytvorit") return { ok: true, decision, reason, duplicateOf, article: null };
  const prepared = prepareArticleBody(String(raw.body_html ?? "").slice(0, 20000));
  const title = clean(raw.title, 160);
  const excerpt = clean(raw.excerpt, 320);
  if (title.length < 3 || excerpt.length < 3 || prepared.text.length < 3) {
    return { ok: false, error: "Claude chtěl aktualitu zpracovat, ale nevrátil článek, který by šel uložit." };
  }
  return {
    ok: true,
    decision,
    reason,
    duplicateOf: "",
    article: { title, excerpt, body: prepared.html, keywords: readKeywords(raw.keywords), recall: readRecall(raw.recall), followsId: readFollows(raw.follows) },
  };
}

export async function askFootball(env, { item, known, voice, today, force = false, doubts = [], fixes = [] }) {
  const answer = await callClaude(env, {
    system: footballPrompt(voice),
    content: [{ type: "text", text: footballText(item, known, { today, force, doubts, fixes }) }],
    schema: footballSchema(),
    effort: "low",
    lookup: footballLookup(env),
  });
  if (!answer.ok) return answer;
  return withLookups(readFootballDecision(answer.raw, { force }), answer);
}
