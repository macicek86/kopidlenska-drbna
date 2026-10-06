// Otisky významu zpráv: Workers AI (bge-m3, umí česky, 1024 čísel) a index ve Vectorize.
// Místně Vectorize neběží (skripty dev a nahled dávají VECTORS_OFF=1, ať se nevolá ani placené Workers AI);
// bez otisků se hledá jen fulltextem.
export const EMBED_MODEL = "@cf/baai/bge-m3";

export function hasVectors(env) {
  return Boolean(env?.AI && env?.VECTORS) && env.VECTORS_OFF !== "1";
}

export async function embedTexts(env, texts) {
  const answer = await env.AI.run(EMBED_MODEL, { text: texts });
  const values = answer?.data ?? answer?.response;
  if (!Array.isArray(values) || values.length !== texts.length) throw new Error("Workers AI nevrátil otisky.");
  return values;
}

// Nejbližší zprávy k dotazu: [{ id, score }] od nejpodobnější. Pod MIN_SCORE už jde spíš o shodu náhodou.
export const MIN_SCORE = 0.45;
const TOP_K = 30;

export async function nearestArticles(env, query) {
  if (!hasVectors(env)) return [];
  try {
    const [values] = await embedTexts(env, [query]);
    const found = await env.VECTORS.query(values, { topK: TOP_K });
    return (found?.matches ?? [])
      .filter((match) => Number(match.score) >= MIN_SCORE)
      .map((match) => ({ id: Number(match.id), score: Number(match.score) }))
      .filter((match) => Number.isInteger(match.id));
  } catch {
    return [];
  }
}
