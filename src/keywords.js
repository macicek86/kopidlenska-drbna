// Klíčová slova zpráv a návrhů: kdo, co, kde a kdy. Drběna podle nich v přehledu pozná, o čem zpráva je,
// i když má nadpis po svém. Zprávy od Drběny je dostanou rovnou z importu, ostatní dopočítá levný model v cronu.
import { callClaude } from "./claude.js";
import { prepareArticleBody } from "./rich.js";
import { addDays, pragueNow } from "./waste.js";

export const KEYWORDS_MAX = 10;
const BATCH = 20;
const BATCHES_PER_RUN = 5;
const LOOKBACK_DAYS = 365;

export const KEYWORDS_RULE =
  "- keywords: 4 až 8 klíčových slov nebo krátkých spojení o tom, kdo, co, kde a kdy (spolek nebo instituce, druh akce, místo, měsíc a rok). Malými písmeny a v 1. pádě, třeba \"lmk kopidlno\", \"letecké modely\", \"mistrovství čr\", \"hradec králové\", \"září 2026\".";

export function keywordsSchema() {
  return { type: "array", items: { type: "string" } };
}

// Seznam od Claude na text do databáze: malými písmeny, bez opakování, nejvýš KEYWORDS_MAX.
export function readKeywords(list) {
  if (!Array.isArray(list)) return "";
  const seen = new Set();
  for (const raw of list) {
    const word = String(raw ?? "").replace(/[\s,]+/g, " ").trim().toLowerCase().slice(0, 40);
    if (word.length >= 2) seen.add(word);
    if (seen.size >= KEYWORDS_MAX) break;
  }
  return [...seen].join(", ");
}

const FILL_RULES = `Dostaneš několik zpráv z webu Kopidlenská drbna (obec Kopidlno a okolí). Ke každé napiš klíčová slova, podle kterých se později pozná, jestli jiná zpráva není o stejné věci.

${KEYWORDS_RULE}
- ref: značku zprávy opiš přesně ze zadání.
- Nic nevymýšlej, ber jen to, co ve zprávě je.`;

function fillSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "keywords"],
          properties: { ref: { type: "string" }, keywords: keywordsSchema() },
        },
      },
    },
  };
}

export function fillText(rows) {
  return rows
    .map((row) => {
      const text = prepareArticleBody(String(row.body ?? "")).text.replace(/\s+/g, " ").trim().slice(0, 1200);
      return `[${row.ref}] ${String(row.created_at ?? "").slice(0, 10)}\nNadpis: ${row.title}\nPerex: ${row.excerpt}\nText: ${text}`;
    })
    .join("\n\n");
}

export async function askKeywords(env, rows) {
  const answer = await callClaude(env, { system: FILL_RULES, content: [{ type: "text", text: fillText(rows) }], schema: fillSchema(), cheap: true });
  if (!answer.ok) return answer;
  const found = new Map();
  for (const item of Array.isArray(answer.raw?.items) ? answer.raw.items : []) {
    const keywords = readKeywords(item?.keywords);
    if (keywords) found.set(String(item.ref ?? "").trim(), keywords);
  }
  return { ok: true, found };
}

async function missing(env, limit) {
  const since = addDays(pragueNow().date, -LOOKBACK_DAYS);
  const articles = await env.DB.prepare(
    `select 'zprava:' || id as ref, id, title, excerpt, body, created_at from articles
     where keywords = '' and created_at >= ? order by created_at desc, id desc limit ?`,
  )
    .bind(since, limit)
    .all();
  const proposals = await env.DB.prepare(
    `select 'navrh:' || id as ref, id, title, excerpt, body, created_at from proposals
     where keywords = '' and status = 'pending' order by id desc limit ?`,
  )
    .bind(limit)
    .all();
  return [...(proposals.results ?? []), ...(articles.results ?? [])].slice(0, limit);
}

// Cron: doplní klíčová slova zprávám a návrhům, které je nemají (psané lidmi, starší, upravené).
// Zprávu, ke které model nic nevrátil, označí pomlčkou, ať se o ni nepokouší pořád dokola.
export async function fillKeywords(env, { ask = askKeywords } = {}) {
  if (!env.ANTHROPIC_API_KEY) return { ok: true, skipped: true };
  let filled = 0;
  for (let round = 0; round < BATCHES_PER_RUN; round += 1) {
    const rows = await missing(env, BATCH);
    if (!rows.length) break;
    const answer = await ask(env, rows);
    if (!answer.ok) return { ok: false, error: answer.error, filled };
    for (const row of rows) {
      const table = row.ref.startsWith("navrh:") ? "proposals" : "articles";
      const keywords = answer.found.get(row.ref) || "-";
      await env.DB.prepare(`update ${table} set keywords = ? where id = ?`).bind(keywords, row.id).run();
      if (keywords !== "-") filled += 1;
    }
    if (rows.length < BATCH) break;
  }
  return { ok: true, filled };
}

// Klíčová slova pro přehled (pomlčka znamená „nejdou zjistit“).
export function shownKeywords(text) {
  const value = String(text ?? "").trim();
  return value === "-" ? "" : value;
}
