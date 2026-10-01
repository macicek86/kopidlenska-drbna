// Claude napíše z aktuality FK Kopidlno článek hlasem kozy Drběny: zprávu po zápase, pozvánku nebo klubovou novinku.
import { callClaude } from "../claude.js";
import { DEFAULT_VOICE } from "../munipolis/ai.js";
import { prepareArticleBody } from "../rich.js";

export const DEFAULT_FOOTBALL_VOICE = `${DEFAULT_VOICE}
U fotbalu Drběna fandí Kopidlnu z ohrady za brankou. Raduje se z gólů, po prohře hráče povzbudí, soupeře nikdy nezesměšňuje. Fotbalové výrazy používá přirozeně, ale text musí pochopit i babička, která na hřišti nikdy nebyla.`;

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
- Skóre piš jako 7:6, poločas v závorce (3:3). Jména hráčů piš tak, jak jsou ve zdroji.
- Kopidlno může hrát doma i venku. Kdo je domácí, poznáš podle pořadí v nadpisu (první je domácí).
- title: do 90 znaků, bez emoji a bez psaní velkými písmeny. U zápasu ať je v nadpisu výsledek nebo soupeř.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: dva až čtyři krátké odstavce. Smíš použít jen <p>, <strong>, <em>, <ul>, <li> a <h3>. Odkaz na zdroj nepiš, drbna ho doplní sama.
- U "preskocit" a "duplicita" nech článek prázdný.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const FORCE = "Redakce chce tuhle aktualitu zpracovat, i když jsi ji předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

export const KIND_LABEL = { zapas: "Po zápase", pozvanka: "Pozvánka", clanek: "Klubová zpráva" };

export function footballSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reason", "duplicate_of", "title", "excerpt", "body_html"],
    properties: {
      decision: { type: "string", enum: ["vytvorit", "preskocit", "duplicita"] },
      reason: { type: "string" },
      duplicate_of: { type: "string" },
      title: { type: "string" },
      excerpt: { type: "string" },
      body_html: { type: "string" },
    },
  };
}

export function footballPrompt(voice) {
  const style = String(voice ?? "").trim() || DEFAULT_FOOTBALL_VOICE;
  return `${RULES}\n\nHlas a styl textů:\n${style}`;
}

function line(value, max = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function footballContext(known) {
  const parts = [];
  const add = (heading, rows) => parts.push(`${heading}:\n${rows.length ? rows.join("\n") : "(nic)"}`);
  add(
    "Zprávy na drbně za poslední týdny",
    (known.articles ?? []).map((row) => `[zprava:${row.id}] ${row.createdOn} · ${line(row.title, 140)} · ${line(row.excerpt)}`),
  );
  add(
    "Návrhy, které čekají na schválení",
    (known.proposals ?? []).map((row) => `[navrh:${row.id}] ${row.createdOn} · ${line(row.title, 140)} · ${line(row.excerpt)}`),
  );
  return parts.join("\n\n");
}

export function footballText(item, known, { today, force = false }) {
  return [
    `Dnes je ${today}.`,
    footballContext(known),
    `Aktualita z webu FK Kopidlno (druh: ${KIND_LABEL[item.kind] ?? item.kind}, zveřejněno ${item.publishedOn || "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    `Text:\n${item.text || "(bez textu)"}`,
    item.extra ? `Doplněno z rozpisu a tabulky na webu klubu:\n${item.extra}` : "",
    force ? FORCE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const REF = /^(zprava|navrh|fotbal):\d+$/;

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
  return { ok: true, decision, reason, duplicateOf: "", article: { title, excerpt, body: prepared.html } };
}

export async function askFootball(env, { item, known, voice, today, force = false }) {
  const answer = await callClaude(env, {
    system: footballPrompt(voice),
    content: [{ type: "text", text: footballText(item, known, { today, force }) }],
    schema: footballSchema(),
    effort: "low",
  });
  if (!answer.ok) return answer;
  return readFootballDecision(answer.raw, { force });
}
