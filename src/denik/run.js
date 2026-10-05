// Jeden průchod Deníku: z RSS vybrat články o Kopidlnu, stáhnout jejich volnou část a nechat Drběnu napsat, co je podstatné.
import { saveBotEvent } from "../events-db.js";
import {
  CLICK_BUDGET_MS,
  CLICK_LOCK_SECONDS,
  CRON_BUDGET_MS,
  CRON_LOCK_SECONDS,
  drain,
  inBackground,
  isFresh,
  STALE_REASON,
} from "../background.js";
import { saveBotArticle } from "../bot-article.js";
import { followupReason, saveFollowup } from "../followup.js";
import { requireChief } from "../db-core.js";
import { loadDrbena } from "../drbena-db.js";
import { voiceFor } from "../drbena.js";
import { memoryOn, withMemory } from "../drbena-memory.js";
import { noteReads } from "../import-tools.js";
import { importSourceDate, importSummary, knownContent, rubricMap } from "../import-context.js";
import { insertNotice } from "../notices-db.js";
import { pragueNow } from "../waste.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { askDenik } from "./ai.js";
import { fetchArticle, fetchDenikFeed } from "./feed.js";
import {
  countWaitingDenik,
  finishDenikItem,
  loadDenikSettings,
  lockDenik,
  rememberDenikItems,
  saveDenikText,
  selectDenikItems,
  unlockDenik,
  waitingDenikItems,
  writeDenikStatus,
} from "./store.js";

export const BATCH_CRON = 5;
export const BATCH_CLICK = 2;
const BUSY = "Drběna už Deník čte. Počkejte, stránka se sama obnoví.";

// Odkaz na zdroj jen tehdy, když ho redakce v nastavení zapne. V textu samotném se Deník nezmiňuje.
export function denikSource(link, enabled) {
  if (!enabled || !link) return "";
  const href = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<p><em><a href="${href}" target="_blank" rel="noopener noreferrer">Zdroj</a></em></p>`;
}

export async function processDenikItem(env, item, settings, { fetchImpl = fetch, ask = askDenik } = {}) {
  const today = pragueNow().date;
  const page = await fetchArticle(item.link, { fetchImpl });
  if (!page.ok) {
    await finishDenikItem(env, item.id, { status: "chyba", reason: page.error });
    return { ok: false, error: page.error };
  }
  if (page.text) {
    item = { ...item, text: page.text };
    await saveDenikText(env, item.id, page.text);
  }
  const rubrics = await rubricMap(env);
  const drbena = await loadDrbena(env);
  const memory = memoryOn(drbena, item.manual ? importSourceDate(item, today) : "", today);
  const answer = await ask(env, {
    item,
    known: await knownContent(env, { itemId: item.id, today, table: "denik_items", recall: memory }),
    topics: await loadStockTopics(env),
    rubricSlugs: [...rubrics.keys()],
    voice: withMemory(voiceFor(drbena), memory),
    today,
    force: item.manual,
  });
  if (!answer.ok) {
    await finishDenikItem(env, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error, usage: answer.usage };
  }
  if (answer.decision === "doplneni") {
    const made = await saveFollowup(env, answer, {
      image: await pickStockImage(env, answer.article.imageTopic),
      sourceHtml: denikSource(item.link, settings.sourceLink),
      autoPublish: settings.autoPublish,
      rubrics,
      publishOn: item.manual ? importSourceDate(item, today) : "",
    });
    await finishDenikItem(env, item.id, { status: "hotovo", reason: noteReads(followupReason(answer), answer), duplicateOf: answer.duplicateOf, eventId: item.eventId, ...made });
    return { ok: true, status: "hotovo", usage: answer.usage };
  }
  if (answer.decision !== "vytvorit") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    await finishDenikItem(env, item.id, { status, reason: noteReads(answer.reason, answer), duplicateOf: answer.duplicateOf });
    return { ok: true, status, usage: answer.usage };
  }

  const made = {};
  if (answer.article) {
    Object.assign(
      made,
      await saveBotArticle(env, {
        article: answer.article,
        image: await pickStockImage(env, answer.article.imageTopic),
        sourceHtml: denikSource(item.link, settings.sourceLink),
        autoPublish: settings.autoPublish,
        rubric: rubrics.get(answer.article.rubric),
        publishOn: item.manual ? importSourceDate(item, today) : "",
      }),
    );
  }
  if (answer.event || item.eventId) {
    // K akci patří zpráva (nebo návrh), kterou Drběna napsala ze stejné zprávy.
    // Při novém zpracování smazané zprávy zůstává stará akce, nová se nezakládá.
    made.eventId = await saveBotEvent(env, answer.event, {
      existingId: item.eventId,
      published: settings.autoPublish,
      articleId: made.articleId,
      proposalId: made.proposalId,
    });
  }
  if (answer.notice) {
    made.noticeId = await insertNotice(env, {
      ...answer.notice,
      sourceUrl: settings.sourceLink ? item.link : "",
      published: settings.autoPublish,
    });
  }
  await finishDenikItem(env, item.id, { status: "hotovo", reason: noteReads(answer.reason, answer), ...made });
  return { ok: true, status: "hotovo", usage: answer.usage };
}

async function collect(env, settings, fetchImpl, { manual = false } = {}) {
  const feed = await fetchDenikFeed(settings.feedUrl, { fetchImpl, football: settings.football });
  if (!feed.ok) {
    await writeDenikStatus(env, { status: "error", note: feed.error });
    return feed;
  }
  const today = pragueNow().date;
  const isOld = (item) => !isFresh(importSourceDate(item, today), today, settings.freshDays);
  return { ok: true, added: await rememberDenikItems(env, feed.items, { manual, isOld }) };
}

async function nextFresh(env, settings, manualOnly) {
  const today = pragueNow().date;
  for (;;) {
    const [item] = await waitingDenikItems(env, 1, { manualOnly });
    if (!item || item.manual || isFresh(importSourceDate(item, today), today, settings.freshDays)) return item;
    await env.DB.prepare("update denik_items set status = 'stare', reason = ? where id = ?").bind(STALE_REASON, item.id).run();
  }
}

async function writeBatch(env, settings, { added, fetchImpl, ask, budgetMs, max, manualOnly = false }) {
  const results = await drain({
    next: () => nextFresh(env, settings, manualOnly),
    handle: (item) => processDenikItem(env, item, settings, { fetchImpl, ask }),
    budgetMs,
    max,
  });
  const result = importSummary(results, added, await countWaitingDenik(env));
  await writeDenikStatus(env, result);
  return result;
}

// Cron každé čtyři hodiny. Se zapnutým importem stáhne RSS a zpracuje nové články,
// vždy dopíše to, co redakce ručně vybrala (s datem ze zdroje).
export async function runDenik(env, { fetchImpl = fetch, ask = askDenik } = {}) {
  const settings = await loadDenikSettings(env);
  const manualWaiting = await countWaitingDenik(env, { manualOnly: true });
  if (!settings.enabled && !manualWaiting) return { ok: true, skipped: true };
  const lock = await lockDenik(env, CRON_LOCK_SECONDS);
  if (!lock) return { ok: true, skipped: true };
  try {
    let added = 0;
    if (settings.enabled) {
      const collected = await collect(env, settings, fetchImpl);
      if (!collected.ok) return collected;
      added = collected.added;
    }
    const result = await writeBatch(env, settings, { added, fetchImpl, ask, budgetMs: CRON_BUDGET_MS, max: BATCH_CRON, manualOnly: !settings.enabled });
    return { ok: result.status !== "error", note: result.note };
  } finally {
    await unlockDenik(env, lock);
  }
}

// Tlačítko „Zkontrolovat teď“: jen načte nové články. Zpracuje se až to, co redakce vybere.
export async function checkDenikNow(env, request, { fetchImpl = fetch } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const settings = await loadDenikSettings(env);
  const lock = await lockDenik(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const collected = await collect(env, settings, fetchImpl, { manual: true });
    if (!collected.ok) return collected;
    const note = collected.added ? `Načteno nových článků: ${collected.added}. Vyberte, které má Drběna zpracovat.` : "Nic nového o Kopidlnu.";
    await writeDenikStatus(env, { status: "ok", note });
    return { ok: true, added: collected.added };
  } finally {
    await unlockDenik(env, lock);
  }
}

// Ručně vybrané zpracuje na pozadí po krátkých dávkách. Volá se po výběru i při každém otevření stránky Deník.
export async function continueDenik(env, { ctx = null, fetchImpl = fetch, ask = askDenik } = {}) {
  if (!(await countWaitingDenik(env, { manualOnly: true }))) return { ok: true, idle: true };
  const lock = await lockDenik(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: true, busy: true };
  const settings = await loadDenikSettings(env);
  const work = async () => {
    try {
      await writeBatch(env, settings, { added: 0, fetchImpl, ask, budgetMs: CLICK_BUDGET_MS, max: BATCH_CLICK, manualOnly: true });
    } finally {
      await unlockDenik(env, lock);
    }
  };
  if (inBackground(ctx, work)) return { ok: true, background: true };
  await work();
  return { ok: true };
}

export async function selectDenik(env, request, ids, options = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const marked = await selectDenikItems(env, ids);
  if (!marked) return { ok: false, error: "Vyberte aspoň jeden článek, který ještě není zpracovaný." };
  const started = await continueDenik(env, options);
  return { ok: true, marked, background: Boolean(started.background || started.busy) };
}
