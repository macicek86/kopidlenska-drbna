// Drběna a uzavírky z NDIC: každou novou uzavírku v okruhu přepíše lidsky, pozná duplicitu
// a k delší napíše článek do praktické rubriky jako u Munipolisu. Běží v cronu a krátce po příjmu zprávy od NDIC.
import { CLICK_BUDGET_MS, CLICK_LOCK_SECONDS, CRON_BUDGET_MS, CRON_LOCK_SECONDS, drain, inBackground } from "../background.js";
import { saveBotArticle } from "../bot-article.js";
import { loadDrbena } from "../drbena-db.js";
import { voiceFor } from "../drbena.js";
import { memoryOn, withMemory } from "../drbena-memory.js";
import { knownContent, rubricMap } from "../import-context.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { pragueNow } from "../waste.js";
import { askNdic } from "./ai.js";
import { closureDays } from "./closures.js";
import { finishClosure, loadNdicSettings, lockNdic, unlockNdic, waitingClosures, writeNdicNote } from "./store.js";

export const BATCH_CRON = 10;
export const BATCH_CLICK = 2;
const FALLBACK_RUBRIC = "prakticke";

// Článek jen k delší uzavírce a jen jednou: když už ho Drběna napsala (i jako návrh), znovu ne.
export function wantsArticle(row, settings) {
  if (row.articleId || row.proposalId) return false;
  return closureDays(row) >= settings.articleDays;
}

// Co u uzavírky zůstává, i když Drběna napoprvé nebo napodruhé neuspěje: článek a dřívější přepis.
function kept(row) {
  return { articleId: row.articleId, proposalId: row.proposalId, humanTitle: row.humanTitle, humanPlaces: row.humanPlaces, humanNote: row.humanNote };
}

export async function processClosure(env, row, settings, { ask = askNdic } = {}) {
  const today = pragueNow().date;
  const rubrics = await rubricMap(env);
  const wantArticle = wantsArticle(row, settings);
  const drbena = await loadDrbena(env);
  const memory = memoryOn(drbena, "", today);
  const answer = await ask(env, {
    row,
    known: await knownContent(env, { itemId: 0, today, table: "road_closures", closureRef: row.ref, recall: memory }),
    settings,
    wantArticle,
    topics: await loadStockTopics(env),
    rubricSlugs: [...rubrics.keys()],
    voice: withMemory(voiceFor(drbena), memory),
    today,
  });
  if (!answer.ok) {
    await finishClosure(env, row.id, { ...kept(row), status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error };
  }
  // Vlastní článek k téže uzavírce duplicita není (Drběna to v zadání ví, tohle je pojistka).
  const own = [row.articleId && `zprava:${row.articleId}`, row.proposalId && `navrh:${row.proposalId}`].filter(Boolean);
  if (answer.decision === "duplicita" && own.includes(answer.duplicateOf)) {
    await finishClosure(env, row.id, { ...kept(row), status: "chyba", reason: "Drběna měla uzavírku za duplicitu vlastního článku." });
    return { ok: false, error: "Drběna měla uzavírku za duplicitu vlastního článku." };
  }
  if (answer.decision === "duplicita") {
    await finishClosure(env, row.id, { ...kept(row), status: "duplicita", reason: answer.reason, duplicateOf: answer.duplicateOf });
    return { ok: true, status: "duplicita" };
  }
  const made = { articleId: row.articleId, proposalId: row.proposalId };
  if (answer.article) {
    const rubric = rubrics.get(answer.article.rubric) ?? rubrics.get(FALLBACK_RUBRIC) ?? [...rubrics.values()][0];
    // Bez řádku se zdrojem: přepsaný text podle podmínek ŘSD nesmí NDIC jako zdroj uvádět.
    Object.assign(
      made,
      await saveBotArticle(env, {
        article: answer.article,
        image: await pickStockImage(env, answer.article.imageTopic),
        sourceHtml: "",
        autoPublish: settings.autoPublish,
        rubric,
      }),
    );
  }
  await finishClosure(env, row.id, {
    status: "hotovo",
    reason: answer.reason,
    ...made,
    humanTitle: answer.notice.title,
    humanPlaces: answer.notice.places,
    humanNote: answer.notice.note,
  });
  return { ok: true, status: "hotovo" };
}

function summary(results, waiting) {
  const done = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const parts = [];
  if (done) parts.push(`Zpracováno: ${done}.`);
  if (failed.length) parts.push(`Nepovedlo se: ${failed.length} (${failed[0].error})`);
  if (waiting) parts.push(`Čeká ještě ${waiting}.`);
  return parts.join(" ");
}

async function writeBatch(env, settings, { ask, budgetMs, max }) {
  const seen = new Set();
  const results = await drain({
    next: async () => (await waitingClosures(env, settings)).find((row) => !seen.has(row.id)) ?? null,
    handle: (row) => {
      seen.add(row.id);
      return processClosure(env, row, settings, { ask });
    },
    budgetMs,
    max,
  });
  if (results.length) {
    const waiting = (await waitingClosures(env, settings)).filter((row) => !seen.has(row.id)).length;
    await writeNdicNote(env, `${pragueNow().date} ${pragueNow().time}: ${summary(results, waiting)}`);
  }
  return results;
}

// Cron: dopíše všechno, co čeká.
export async function runNdic(env, { ask = askNdic } = {}) {
  const settings = await loadNdicSettings(env);
  if (!settings.drbena) return { ok: true, skipped: true };
  const lock = await lockNdic(env, CRON_LOCK_SECONDS);
  if (!lock) return { ok: true, skipped: true };
  try {
    await writeBatch(env, settings, { ask, budgetMs: CRON_BUDGET_MS, max: BATCH_CRON });
    return { ok: true };
  } finally {
    await unlockNdic(env, lock);
  }
}

// Po zprávě od NDIC nebo po kliknutí v redakci: krátká dávka na pozadí, zbytek dopíše cron.
export async function continueNdic(env, { ctx = null, ask = askNdic } = {}) {
  const settings = await loadNdicSettings(env);
  if (!settings.drbena) return { ok: true, skipped: true };
  if (!(await waitingClosures(env, settings)).length) return { ok: true, idle: true };
  const lock = await lockNdic(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: true, busy: true };
  const work = async () => {
    try {
      await writeBatch(env, settings, { ask, budgetMs: CLICK_BUDGET_MS, max: BATCH_CLICK });
    } finally {
      await unlockNdic(env, lock);
    }
  };
  if (inBackground(ctx, work)) return { ok: true, background: true };
  await work();
  return { ok: true };
}
