// Společné volání Claude (importy, pomocník, klíčová slova): odpověď jako JSON podle schématu, u importů i s dohledáváním.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
// Levný model na drobnosti (klíčová slova). Úsilí ani zástupce při odmítnutí nezná.
export const CHEAP_MODEL = "claude-haiku-4-5";

const CACHED = { type: "ephemeral" };

// Texty se na mnoha místech ořezávají na počet znaků a řez může rozpůlit emoji. Půlka znaku (osamocený
// surrogate) udělá z dotazu neplatný JSON a Claude ho odmítne chybou 400. Proto každý řetězec v dotazu opraví.
export function wellFormed(value) {
  if (typeof value === "string") return value.toWellFormed();
  if (Array.isArray(value)) return value.map(wellFormed);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wellFormed(item)]));
  return value;
}
// Kol s nástroji nejvýš tolik; poslední kolo už nástroje nepustí.
const MAX_ROUNDS = 4;

function errorText(error) {
  if (error instanceof Anthropic.AuthenticationError) return "Claude nepřijal klíč. Zkontrolujte ANTHROPIC_API_KEY.";
  if (error instanceof Anthropic.RateLimitError) return "Claude je teď přetížený. Zkusí se to příště.";
  if (error instanceof Anthropic.APIError) return `Claude odpověděl chybou ${error.status ?? ""}.`.replace(" .", ".");
  return "Claude neodpověděl.";
}

// Součet tokenů (víc kol, víc volání), ve tvaru `usage` z API (počítá z něj cenu pomocník při psaní a souhrn importu).
export function addUsage(sum, usage) {
  const keys = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
  if (!usage) return sum ?? null;
  return Object.fromEntries(keys.map((key) => [key, Number(sum?.[key] ?? 0) + Number(usage[key] ?? 0)]));
}

// Odpovědi na volání nástrojů z jednoho kola. Po `maxCalls` čteních už Drběna dostane jen výzvu, ať rozhodne.
async function toolResults(calls, lookup, used) {
  return Promise.all(
    calls.map(async (call, index) => {
      if (used + index >= lookup.maxCalls) {
        return { type: "tool_result", tool_use_id: call.id, content: "Už nic dalšího nečti a rozhodni podle toho, co máš.", is_error: true };
      }
      try {
        return { type: "tool_result", tool_use_id: call.id, content: String(await lookup.run(call.name, call.input)) };
      } catch {
        return { type: "tool_result", tool_use_id: call.id, content: "Tohle se teď nepodařilo přečíst.", is_error: true };
      }
    }),
  );
}

// Vrací { ok: true, raw, usage } s rozparsovaným JSON, nebo { ok: false, error } s větou pro redakci.
// `model` jiný než výchozí (pomocník při psaní bere Sonnet), `usage` jsou tokeny z odpovědi kvůli ceně.
// Pokyny jdou do cache (stejné pro všechny články zdroje); bloky obsahu si cache značí volající (importContent).
// `lookup` ({ tools, rule, run, maxCalls }) dovolí Claudovi před odpovědí něco dohledat (src/import-tools.js);
// `read` pak říká, co si přečetl (značky jako "zprava:12").
export async function callClaude(env, { system, content, schema, effort = "medium", cheap = false, model = MODEL, lookup = null }) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "Chybí klíč ANTHROPIC_API_KEY." };
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: 2,
    timeout: 180_000,
  });
  const format = { type: "json_schema", schema };
  const systemBlocks = [{ type: "text", text: lookup ? `${system}\n\n${lookup.rule}` : system, cache_control: CACHED }];
  const tools = lookup ? { tools: lookup.tools } : {};
  const messages = [{ role: "user", content }];
  let usage = null;
  let used = 0;
  const read = [];
  let response;
  for (let round = 1; ; round += 1) {
    try {
      response = cheap
        ? await client.messages.create(wellFormed({ model: CHEAP_MODEL, max_tokens: 8000, output_config: { format }, system: systemBlocks, messages }))
        : await client.beta.messages.create(
            wellFormed({
              model,
              max_tokens: 16000,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
              output_config: { effort, format },
              system: systemBlocks,
              messages,
              ...tools,
            }),
          );
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
    usage = addUsage(usage, response.usage);
    if (response.stop_reason !== "tool_use" || !lookup) break;
    if (round >= MAX_ROUNDS) return { ok: false, error: "Drběna pořád něco dohledávala a nerozhodla se. Zkusí se to znovu." };
    const calls = (response.content ?? []).filter((block) => block.type === "tool_use");
    // Obsah odpovědi (i myšlenky) se vrací beze změny, jinak by na ni Claude nemohl navázat.
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: await toolResults(calls, lookup, used) });
    for (const call of calls.slice(0, Math.max(0, lookup.maxCalls - used))) read.push(lookup.label ? lookup.label(call) : String(call.input?.znacka ?? call.name));
    used += calls.length;
  }
  if (response.stop_reason === "refusal") return { ok: false, error: "Claude tuhle zprávu odmítl zpracovat." };
  if (response.stop_reason === "max_tokens") return { ok: false, error: "Claudova odpověď se nevešla. Zkuste to znovu." };
  const text = (response.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
  try {
    return { ok: true, raw: JSON.parse(text), usage, read };
  } catch {
    return { ok: false, error: "Claudova odpověď nešla přečíst." };
  }
}
