// Chat s Drběnou: volání Claude s nástroji na zprávy, výběr modelu a cena odpovědi.
import Anthropic from "@anthropic-ai/sdk";
import { wellFormed } from "../claude.js";
import { CHAT_TOOLS, runChatTool } from "./context.js";

// Ceny v dolarech za milion tokenů (vstup, výstup, čtení z cache, zápis do cache).
export const CHAT_MODELS = {
  sonnet: { id: "claude-sonnet-5-5", label: "Sonnet 5.5", price: { input: 2, output: 10, read: 0.2, write: 2.5 } },
  haiku: { id: "claude-haiku-4-5", label: "Haiku 4.5", price: { input: 1, output: 5, read: 0.1, write: 1.25 } },
};
export const DEFAULT_CHAT_MODEL = "sonnet";

// Přibližný kurz pro přepočet ceny v redakci a pro měsíční rozpočet.
export const USD_CZK = 23;

const MAX_ROUNDS = 4;

export function chatModel(key) {
  return Object.hasOwn(CHAT_MODELS, key) ? key : DEFAULT_CHAT_MODEL;
}

export function emptyUsage() {
  return { input: 0, output: 0, read: 0, write: 0 };
}

export function addUsage(sum, usage) {
  return {
    input: sum.input + Number(usage?.input_tokens ?? 0),
    output: sum.output + Number(usage?.output_tokens ?? 0),
    read: sum.read + Number(usage?.cache_read_input_tokens ?? 0),
    write: sum.write + Number(usage?.cache_creation_input_tokens ?? 0),
  };
}

export function usageCost(usage, key) {
  const price = CHAT_MODELS[chatModel(key)].price;
  const cost = usage.input * price.input + usage.output * price.output + usage.read * price.read + usage.write * price.write;
  return cost / 1_000_000;
}

// Sonnet 5.5 přemýšlí sám (nízké úsilí stačí) a při odmítnutí ho zastoupí jiný model; Haiku 4.5 nic z toho nezná.
function request(key, { system, messages }) {
  const model = CHAT_MODELS[key];
  if (key === "haiku") return { model: model.id, max_tokens: 1500, system, tools: CHAT_TOOLS, messages };
  return {
    model: model.id,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    tools: CHAT_TOOLS,
    messages,
  };
}

function answerText(content) {
  return (content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

// system: pole bloků (pevná část s cache_control, pak čas). history: [{ role, text }].
// Vrací { ok, text, usage } nebo { ok: false, error, usage }; usage se počítá i při chybě.
export async function askDrbena(env, { modelKey, system, history }, { runTool = runChatTool } = {}) {
  const key = chatModel(modelKey);
  let usage = emptyUsage();
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "Chybí klíč ANTHROPIC_API_KEY.", usage };
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: 1,
    timeout: 60_000,
  });
  const messages = history.map((item) => ({ role: item.role, content: item.text }));
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let response;
    try {
      const params = wellFormed(request(key, { system, messages }));
      response = key === "haiku" ? await client.messages.create(params) : await client.beta.messages.create(params);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "busy", usage };
      return { ok: false, error: error instanceof Anthropic.APIError ? `Claude odpověděl chybou ${error.status ?? ""}.` : "Claude neodpověděl.", usage };
    }
    usage = addUsage(usage, response.usage);
    if (response.stop_reason === "refusal") return { ok: false, error: "refusal", usage };
    if (response.stop_reason !== "tool_use") {
      const text = answerText(response.content);
      return text ? { ok: true, text, usage } : { ok: false, error: "Claude nic nenapsal.", usage };
    }
    messages.push({ role: "assistant", content: response.content });
    const calls = response.content.filter((block) => block.type === "tool_use");
    const results = await Promise.all(
      calls.map(async (call) => {
        try {
          return { type: "tool_result", tool_use_id: call.id, content: await runTool(env, call.name, call.input) };
        } catch {
          return { type: "tool_result", tool_use_id: call.id, content: "Nástroj selhal.", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { ok: false, error: "Drběna hledala moc dlouho.", usage };
}
