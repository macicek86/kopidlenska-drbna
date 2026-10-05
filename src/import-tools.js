// Nástroje importů (Munipolis, Deník, školy, web města): když Drběna z přehledu nepozná jistě, jestli jde o stejnou věc,
// přečte si celou zprávu nebo návrh, nebo původní text dřívější položky zdroje. Přehled jí dál chodí celý (src/import-overview.js).
import { htmlText } from "./chat/prompt.js";
import { addUsage } from "./claude.js";
import { IMPORT_SOURCES } from "./import-context.js";

const ARTICLE_MAX = 6000;
const SOURCE_MAX = 5000;
// Víc čtení na jeden článek nedává smysl, a každé kolo se platí.
export const MAX_READS = 4;

export const IMPORT_TOOLS = [
  {
    name: "precist_zpravu",
    description:
      "Celý text zprávy nebo čekajícího návrhu z přehledu (nadpis, datum, perex, text). Použij, když z perexu a klíčových slov nepoznáš jistě, jestli jde o stejnou věc, nebo co v ní už je.",
    input_schema: {
      type: "object",
      properties: { znacka: { type: "string", description: 'Značka z přehledu, třeba "zprava:12" nebo "navrh:5".' } },
      required: ["znacka"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "precist_zdroj",
    description:
      "Původní text dřívější převzaté položky (z Munipolisu, webu školy nebo webu města), i té, kterou Drběna přeskočila. Použij, když z nadpisu nepoznáš, o čem byla.",
    input_schema: {
      type: "object",
      properties: { znacka: { type: "string", description: 'Značka z oddílu dřívějších převzatých zpráv, třeba "munipolis:40".' } },
      required: ["znacka"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const TOOLS_RULE = `Nástroje:
- Přehled ukazuje u zpráv jen perex a klíčová slova a u dřívějších převzatých položek jen nadpis. Když z toho nepoznáš jistě, jestli jde o stejnou věc, nebo co přesně už na drbně je, přečti si celou zprávu či návrh (precist_zpravu) nebo původní text položky (precist_zdroj).
- Čti jen ve sporných případech, nejvýš ${MAX_READS}×. Když je to z přehledu jasné, rozhodni rovnou.
- Z přečtených textů nic neopisuj, slouží jen k rozhodnutí.`;

function clipText(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseRef(value) {
  const [, kind, id] = String(value ?? "").trim().replace(/^\[|\]$/g, "").match(/^([a-z]+):(\d+)$/) ?? [];
  return kind ? { kind, id: Number(id) } : null;
}

async function readWritten(env, ref) {
  if (ref?.kind === "zprava") {
    const row = await env.DB.prepare(
      `select a.title, a.excerpt, a.body, a.created_at, coalesce(r.name, a.category) as rubric
       from articles a left join rubrics r on r.id = a.rubric_id where a.id = ?`,
    )
      .bind(ref.id)
      .first();
    if (!row) return "Taková zpráva už na drbně není.";
    return `${row.title}\n${String(row.created_at).slice(0, 10)} · ${row.rubric}\n${row.excerpt}\n\n${clipText(htmlText(String(row.body ?? "")), ARTICLE_MAX)}`;
  }
  if (ref?.kind === "navrh") {
    const row = await env.DB.prepare("select title, excerpt, body, status from proposals where id = ?").bind(ref.id).first();
    if (!row) return "Takový návrh už není.";
    const state = row.status === "pending" ? "čeká na schválení" : "už vyřízený";
    return `${row.title} (návrh, ${state})\n${row.excerpt}\n\n${clipText(htmlText(String(row.body ?? "")), ARTICLE_MAX)}`;
  }
  return 'Zprávu čtu jen podle značky "zprava:12" nebo "navrh:5".';
}

async function readSourceItem(env, ref) {
  const source = IMPORT_SOURCES.find((item) => item.tag === ref?.kind);
  if (!source) return `Zdroj čtu jen podle značky z dřívějších převzatých zpráv (${IMPORT_SOURCES.map((item) => `${item.tag}:12`).join(", ")}).`;
  const row = await env.DB.prepare(`select title, text, published_at from ${source.table} where id = ?`).bind(ref.id).first();
  if (!row) return "Takovou položku už nemám.";
  const head = `${row.title}\n${String(row.published_at ?? "").slice(0, 10)}`;
  // Podmínky Deníku nedovolují jeho text přenášet jinam. K rozhodnutí stačí nadpis.
  if (source.tag === "denik") return `${head}\n\n(Text z Deníku nečtu, podmínky Deníku to nedovolují. Rozhodni podle nadpisu.)`;
  return `${head}\n\n${clipText(htmlText(String(row.text ?? "")), SOURCE_MAX) || "(bez textu)"}`;
}

export async function runImportTool(env, name, input) {
  const ref = parseRef(input?.znacka);
  if (name === "precist_zpravu") return readWritten(env, ref);
  if (name === "precist_zdroj") return readSourceItem(env, ref);
  return "Takový nástroj nemám.";
}

// Rozhodnutí z odpovědi doplní o to, co si Drběna přečetla, a o tokeny (souhrn importu z nich počítá cache).
export function withLookups(result, answer) {
  return { ...result, read: [...(result.read ?? []), ...(answer?.read ?? [])], usage: addUsage(result.usage ?? null, answer?.usage) };
}

// Zdůvodnění pro redakci s tím, co si Drběna přečetla.
export function noteReads(reason, answer) {
  const read = answer?.read ?? [];
  return read.length ? `${reason ?? ""} (Přečetla si: ${read.join(", ")}.)`.trim() : reason;
}

// Co dostane `callClaude` jako `lookup`.
export function importLookup(env) {
  return { tools: IMPORT_TOOLS, rule: TOOLS_RULE, run: (name, input) => runImportTool(env, name, input), maxCalls: MAX_READS };
}
