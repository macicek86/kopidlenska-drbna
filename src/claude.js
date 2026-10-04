// Společné volání Claude pro importy (Munipolis, fotbal): jedna zpráva, odpověď jako JSON podle schématu.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";
// Levný model na drobnosti (klíčová slova). Úsilí ani zástupce při odmítnutí nezná.
export const CHEAP_MODEL = "claude-haiku-4-5";

// Vrací { ok: true, raw, usage } s rozparsovaným JSON, nebo { ok: false, error } s větou pro redakci.
// `model` jiný než výchozí (pomocník při psaní bere Sonnet), `usage` jsou tokeny z odpovědi kvůli ceně.
export async function callClaude(env, { system, content, schema, effort = "medium", cheap = false, model = MODEL }) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "Chybí klíč ANTHROPIC_API_KEY." };
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL || undefined,
    maxRetries: 2,
    timeout: 180_000,
  });
  let response;
  try {
    const format = { type: "json_schema", schema };
    const messages = [{ role: "user", content }];
    response = cheap
      ? await client.messages.create({ model: CHEAP_MODEL, max_tokens: 8000, output_config: { format }, system, messages })
      : await client.beta.messages.create({
          model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort, format },
          system,
          messages,
        });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, error: "Claude nepřijal klíč. Zkontrolujte ANTHROPIC_API_KEY." };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: "Claude je teď přetížený. Zkusí se to příště." };
    if (error instanceof Anthropic.APIError) return { ok: false, error: `Claude odpověděl chybou ${error.status ?? ""}.`.replace(" .", ".") };
    return { ok: false, error: "Claude neodpověděl." };
  }
  if (response.stop_reason === "refusal") return { ok: false, error: "Claude tuhle zprávu odmítl zpracovat." };
  if (response.stop_reason === "max_tokens") return { ok: false, error: "Claudova odpověď se nevešla. Zkuste to znovu." };
  const text = (response.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("");
  try {
    return { ok: true, raw: JSON.parse(text), usage: response.usage ?? null };
  } catch {
    return { ok: false, error: "Claudova odpověď nešla přečíst." };
  }
}
