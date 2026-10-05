// Jeden průchod importu: stáhnout RSS, nové zprávy dát Claudovi a výsledek uložit jako návrh, akci nebo odstávku.
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
import { fetchImage, storeImageBytes } from "../images.js";
import { importSourceDate, importSummary, knownContent, outcomeOf, rubricMap } from "../import-context.js";
import { insertNotice } from "../notices-db.js";
import { pragueNow } from "../waste.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { askClaude, visibleImages } from "./ai.js";
import { saveHoursChanges } from "./hours.js";
import { ensureBot } from "./store.js";
import { fetchFeed } from "./feed.js";
import { fetchPageImages, mergeImageUrls } from "./page.js";
import {
  countWaitingItems,
  finishItem,
  loadImportSettings,
  lockImport,
  rememberItems,
  selectImportItems,
  unlockImport,
  waitingItems,
  writeImportStatus,
} from "./store.js";

// Kolik zpráv se zpracuje najednou. Cron má času dost, po kliknutí v redakci se píše na pozadí jen chvilku.
export const BATCH_CRON = 5;
export const BATCH_CLICK = 2;
const BUSY = "Drběna už zprávy města čte. Počkejte, stránka se sama obnoví.";

export function sourceParagraph(link) {
  if (!link) return `<p><em>Zdroj: Munipolis města Kopidlna</em></p>`;
  const href = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<p><em>Zdroj: <a href="${href}" target="_blank" rel="noopener noreferrer">Munipolis města Kopidlna</a></em></p>`;
}

export { importSourceDate, outcomeOf };

// Obrázky z RSS a ze stránky zprávy (galerie s jízdními řády, mapami…). Claude jich uvidí nejvýš tolik, kolik pustí visibleImages.
async function downloadImages(env, item, fetchImpl) {
  const urls = mergeImageUrls(item.images, await fetchPageImages(item.link, { fetchImpl }));
  const images = [];
  for (const url of urls.slice(0, 8)) {
    const image = await fetchImage(env, url, { fetchImpl });
    if (image) images.push(image);
  }
  return images;
}

// Vlastní fotku nebo pěkný plakát ze zprávy jen tehdy, když je Drběna vybrala, jinak ilustrační z knihovny.
// Plakát se zatím ořezává jako fotka (celý by šel ukázat s bodem výřezu WHOLE).
export async function articleImage(env, article, images) {
  const [own] = visibleImages(images);
  if (article.imageUse !== "knihovna" && own) {
    return { key: await storeImageBytes(env, own), focus: "", caption: article.imageCaption };
  }
  return pickStockImage(env, article.imageTopic);
}

// Přílohy, které Drběna vybrala, se uloží do R2 a půjdou pod článek. Čísla obrázků jsou od 1 v pořadí, jak je Claude viděl.
export async function articleAttachments(env, article, images) {
  const shown = visibleImages(images);
  const list = [];
  for (const pick of article.attachments ?? []) {
    const image = shown[pick.index - 1];
    if (image) list.push({ key: await storeImageBytes(env, image, "prilohy"), caption: pick.caption });
  }
  return list;
}

// Ručně vybranou zprávu Drběna zpracuje vždy (redakce rozhodla) a článek dostane datum ze zdroje. Cron píše s dnešním datem.
export async function processItem(env, item, settings, { fetchImpl = fetch, ask = askClaude } = {}) {
  const today = pragueNow().date;
  const force = item.manual;
  const rubrics = await rubricMap(env);
  const images = await downloadImages(env, item, fetchImpl);
  const drbena = await loadDrbena(env);
  const memory = memoryOn(drbena, item.manual ? importSourceDate(item, today) : "", today);
  const answer = await ask(env, {
    item,
    known: await knownContent(env, { itemId: item.id, today, recall: memory }),
    images,
    topics: await loadStockTopics(env),
    rubricSlugs: [...rubrics.keys()],
    voice: withMemory(voiceFor(drbena), memory),
    today,
    force,
  });
  if (!answer.ok) {
    await finishItem(env, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error };
  }
  if (answer.decision === "doplneni") {
    const made = await saveFollowup(env, answer, {
      image: await articleImage(env, answer.article, images),
      sourceHtml: sourceParagraph(item.link),
      autoPublish: settings.autoPublish,
      rubrics,
      publishOn: item.manual ? importSourceDate(item, today) : "",
    });
    await finishItem(env, item.id, { status: "hotovo", reason: followupReason(answer), duplicateOf: answer.duplicateOf, eventId: item.eventId, ...made });
    return { ok: true, status: "hotovo" };
  }
  if (answer.decision !== "vytvorit") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    await finishItem(env, item.id, { status, reason: answer.reason, duplicateOf: answer.duplicateOf });
    return { ok: true, status };
  }

  const made = {};
  if (answer.article) {
    Object.assign(
      made,
      await saveBotArticle(env, {
        article: answer.article,
        image: await articleImage(env, answer.article, images),
        attachments: await articleAttachments(env, answer.article, images),
        sourceHtml: sourceParagraph(item.link),
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
    made.noticeId = await insertNotice(env, { ...answer.notice, sourceUrl: item.link, published: settings.autoPublish });
  }
  if (answer.hours?.length) {
    const bot = await ensureBot(env);
    made.hoursIds = await saveHoursChanges(env, answer.hours, { sourceUrl: item.link, createdBy: bot.id });
  }
  await finishItem(env, item.id, { status: "hotovo", reason: answer.reason, ...made });
  return { ok: true, status: "hotovo" };
}

// Stáhne RSS a nové zprávy si zapamatuje. Rychlé, takže běží i přímo po kliknutí.
async function collect(env, settings, fetchImpl, { manual = false } = {}) {
  const feed = await fetchFeed(settings.feedUrl, { fetchImpl });
  if (!feed.ok) {
    await writeImportStatus(env, { status: "error", note: feed.error });
    return feed;
  }
  const today = pragueNow().date;
  const isOld = (item) => !isFresh(importSourceDate(item, today), today, settings.freshDays);
  return { ok: true, added: await rememberItems(env, feed.items, { manual, isOld }) };
}

// Další zpráva z fronty. Automatická, která mezitím zestárla (třeba po dlouhé pauze), jde stranou mezi starší.
async function nextFresh(env, settings, manualOnly) {
  const today = pragueNow().date;
  for (;;) {
    const [item] = await waitingItems(env, 1, { manualOnly });
    if (!item || item.manual || isFresh(importSourceDate(item, today), today, settings.freshDays)) return item;
    await env.DB.prepare("update import_items set status = 'stare', reason = ? where id = ?").bind(STALE_REASON, item.id).run();
  }
}

async function writeBatch(env, settings, { added, fetchImpl, ask, budgetMs, max, manualOnly = false }) {
  const results = await drain({
    next: () => nextFresh(env, settings, manualOnly),
    handle: (item) => processItem(env, item, settings, { fetchImpl, ask }),
    budgetMs,
    max,
  });
  const result = importSummary(results, added, await countWaitingItems(env));
  await writeImportStatus(env, result);
  return result;
}

// Cron každé čtyři hodiny. Se zapnutým importem stáhne RSS a zpracuje nové zprávy,
// vždy dopíše to, co redakce ručně vybrala (s datem ze zdroje).
export async function runImport(env, { fetchImpl = fetch, ask = askClaude } = {}) {
  const settings = await loadImportSettings(env);
  const manualWaiting = await countWaitingItems(env, { manualOnly: true });
  if (!settings.enabled && !manualWaiting) return { ok: true, skipped: true };
  const lock = await lockImport(env, CRON_LOCK_SECONDS);
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
    await unlockImport(env, lock);
  }
}

// Tlačítko „Zkontrolovat teď“: jen načte nové zprávy. Zpracuje se až to, co redakce vybere.
export async function checkImportNow(env, request, { fetchImpl = fetch } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const settings = await loadImportSettings(env);
  const lock = await lockImport(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const collected = await collect(env, settings, fetchImpl, { manual: true });
    if (!collected.ok) return collected;
    const note = collected.added ? `Načteno nových zpráv: ${collected.added}. Vyberte, které má Drběna zpracovat.` : "Nic nového.";
    await writeImportStatus(env, { status: "ok", note });
    return { ok: true, added: collected.added };
  } finally {
    await unlockImport(env, lock);
  }
}

// Ručně vybrané zprávy zpracuje na pozadí po krátkých dávkách. Volá se po výběru i při každém otevření stránky
// Munipolis, takže se vybrané dopisují, dokud je stránka otevřená (sama se obnovuje).
export async function continueImport(env, { ctx = null, fetchImpl = fetch, ask = askClaude } = {}) {
  if (!(await countWaitingItems(env, { manualOnly: true }))) return { ok: true, idle: true };
  const lock = await lockImport(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: true, busy: true };
  const settings = await loadImportSettings(env);
  const work = async () => {
    try {
      await writeBatch(env, settings, { added: 0, fetchImpl, ask, budgetMs: CLICK_BUDGET_MS, max: BATCH_CLICK, manualOnly: true });
    } finally {
      await unlockImport(env, lock);
    }
  };
  if (inBackground(ctx, work)) return { ok: true, background: true };
  await work();
  return { ok: true };
}

// Redakce zaškrtla zprávy (nebo klikla na „Zpracovat teď“ u jedné). Hotové se znovu nezpracují.
export async function selectImport(env, request, ids, options = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const marked = await selectImportItems(env, ids);
  if (!marked) return { ok: false, error: "Vyberte aspoň jednu zprávu, která ještě není zpracovaná." };
  const started = await continueImport(env, options);
  return { ok: true, marked, background: Boolean(started.background || started.busy) };
}
