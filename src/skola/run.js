// Jeden průchod webu školy: stáhnout články, nové dát Claudovi a výsledek uložit jako zprávu (návrh) nebo akci.
// Všechny funkce berou školu ze `sources.js` (bez ní ZŠ a MŠ).
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
import { fetchImage, storeImageBytes } from "../images.js";
import { importSourceDate, importSummary, knownContent, rubricMap } from "../import-context.js";
import { visibleImages } from "../munipolis/ai.js";
import { pragueNow } from "../waste.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { askSkola } from "./ai.js";
import { SCHOOLS } from "./sources.js";
import {
  countWaitingSkola,
  finishSkolaItem,
  loadSkolaSettings,
  lockSkola,
  rememberSkolaItems,
  selectSkolaItems,
  unlockSkola,
  waitingSkolaItems,
  writeSkolaStatus,
} from "./store.js";

export const BATCH_CRON = 5;
export const BATCH_CLICK = 2;
const BUSY = "Drběna už web školy čte. Počkejte, stránka se sama obnoví.";

export function skolaSource(link, source = SCHOOLS.skola) {
  if (!link) return `<p><em>Zdroj: web ${source.name}</em></p>`;
  const href = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<p><em>Zdroj: <a href="${href}" target="_blank" rel="noopener noreferrer">web ${source.name}</a></em></p>`;
}

// Fotka je z webu školy, i když ji škole dal někdo jiný (autora uvede Drběna v popisku, když ho škola zmíní).
export function photoCaption(caption, source = SCHOOLS.skola) {
  const credit = `foto: web ${source.name}`;
  return caption ? `${caption} (${credit})` : `F${credit.slice(1)}`;
}

async function downloadImages(urls, fetchImpl) {
  const images = [];
  for (const url of urls.slice(0, 2)) {
    const image = await fetchImage(url, { fetchImpl });
    if (image) images.push(image);
  }
  return images;
}

// Fotku ze školního webu jen se zapnutým nastavením a když ji Drběna vybrala (i pěkný plakát, ořízne se jako fotka), jinak ilustrační z knihovny.
export async function skolaImage(env, article, images, ownPhotos, source = SCHOOLS.skola) {
  const [own] = visibleImages(images);
  if (ownPhotos && article.imageUse !== "knihovna" && own) {
    return { key: await storeImageBytes(env, own), focus: "", caption: photoCaption(article.imageCaption, source) };
  }
  return pickStockImage(env, article.imageTopic);
}

// Ručně vybraný článek Drběna zpracuje vždy (redakce rozhodla) a zpráva dostane datum ze zdroje. Cron píše s dnešním datem.
export async function processSkolaItem(env, source, item, settings, { fetchImpl = fetch, ask = askSkola } = {}) {
  const today = pragueNow().date;
  const rubrics = await rubricMap(env);
  const images = await downloadImages(item.images, fetchImpl);
  const answer = await ask(env, {
    source,
    item,
    known: await knownContent(env, { itemId: item.id, today, table: source.itemsTable }),
    images,
    topics: await loadStockTopics(env),
    rubricSlugs: [...rubrics.keys()],
    voice: voiceFor(await loadDrbena(env)),
    today,
    force: item.manual,
    ownPhotos: settings.ownPhotos,
  });
  if (!answer.ok) {
    await finishSkolaItem(env, source, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error };
  }
  if (answer.decision === "doplneni") {
    const made = await saveFollowup(env, answer, {
      image: await pickStockImage(env, answer.article.imageTopic),
      sourceHtml: skolaSource(item.link, source),
      autoPublish: settings.autoPublish,
      rubrics,
      publishOn: item.manual ? importSourceDate(item, today) : "",
    });
    await finishSkolaItem(env, source, item.id, {
      status: "hotovo",
      reason: followupReason(answer),
      duplicateOf: answer.duplicateOf,
      eventId: item.eventId,
      ...made,
    });
    return { ok: true, status: "hotovo" };
  }
  if (answer.decision !== "vytvorit") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    await finishSkolaItem(env, source, item.id, { status, reason: answer.reason, duplicateOf: answer.duplicateOf });
    return { ok: true, status };
  }

  const made = {};
  if (answer.article) {
    Object.assign(
      made,
      await saveBotArticle(env, {
        article: answer.article,
        image: await skolaImage(env, answer.article, images, settings.ownPhotos, source),
        sourceHtml: skolaSource(item.link, source),
        autoPublish: settings.autoPublish,
        rubric: rubrics.get(answer.article.rubric),
        publishOn: item.manual ? importSourceDate(item, today) : "",
      }),
    );
  }
  if (answer.event || item.eventId) {
    // K akci patří zpráva (nebo návrh), kterou Drběna napsala ze stejného článku.
    // Při novém zpracování smazané zprávy zůstává stará akce, nová se nezakládá.
    made.eventId = await saveBotEvent(env, answer.event, {
      existingId: item.eventId,
      published: settings.autoPublish,
      articleId: made.articleId,
      proposalId: made.proposalId,
    });
  }
  await finishSkolaItem(env, source, item.id, { status: "hotovo", reason: answer.reason, ...made });
  return { ok: true, status: "hotovo" };
}

// Stáhne RSS a nové články si zapamatuje. Rychlé, takže běží i přímo po kliknutí.
async function collect(env, source, settings, fetchImpl, { manual = false } = {}) {
  const feed = await source.fetchItems(settings.feedUrls, { fetchImpl });
  if (!feed.ok) {
    await writeSkolaStatus(env, source, { status: "error", note: feed.error });
    return feed;
  }
  const today = pragueNow().date;
  const isOld = (item) => !isFresh(importSourceDate(item, today), today, settings.freshDays);
  return { ok: true, warning: feed.warning, added: await rememberSkolaItems(env, source, feed.items, { manual, isOld }) };
}

// Další článek z fronty. Automatický, který mezitím zestárl (třeba po dlouhé pauze), jde stranou mezi starší.
async function nextFresh(env, source, settings, manualOnly) {
  const today = pragueNow().date;
  for (;;) {
    const [item] = await waitingSkolaItems(env, source, 1, { manualOnly });
    if (!item || item.manual || isFresh(importSourceDate(item, today), today, settings.freshDays)) return item;
    await env.DB.prepare(`update ${source.itemsTable} set status = 'stare', reason = ? where id = ?`).bind(STALE_REASON, item.id).run();
  }
}

async function writeBatch(env, source, settings, { added, warning = "", fetchImpl, ask, budgetMs, max, manualOnly = false }) {
  const results = await drain({
    next: () => nextFresh(env, source, settings, manualOnly),
    handle: (item) => processSkolaItem(env, source, item, settings, { fetchImpl, ask }),
    budgetMs,
    max,
  });
  const result = importSummary(results, added, await countWaitingSkola(env, source));
  if (warning) result.note = `${result.note} Jeden kanál nejde: ${warning}`;
  await writeSkolaStatus(env, source, result);
  return result;
}

// Cron každé čtyři hodiny. Se zapnutým importem stáhne RSS a zpracuje nové články,
// vždy dopíše to, co redakce ručně vybrala (s datem ze zdroje).
export async function runSkola(env, source, { fetchImpl = fetch, ask = askSkola } = {}) {
  const settings = await loadSkolaSettings(env, source);
  const manualWaiting = await countWaitingSkola(env, source, { manualOnly: true });
  if (!settings.enabled && !manualWaiting) return { ok: true, skipped: true };
  const lock = await lockSkola(env, source, CRON_LOCK_SECONDS);
  if (!lock) return { ok: true, skipped: true };
  try {
    let added = 0;
    let warning = "";
    if (settings.enabled) {
      const collected = await collect(env, source, settings, fetchImpl);
      if (!collected.ok) return collected;
      ({ added, warning } = collected);
    }
    const result = await writeBatch(env, source, settings, {
      added,
      warning,
      fetchImpl,
      ask,
      budgetMs: CRON_BUDGET_MS,
      max: BATCH_CRON,
      manualOnly: !settings.enabled,
    });
    return { ok: result.status !== "error", note: result.note };
  } finally {
    await unlockSkola(env, source, lock);
  }
}

// Tlačítko „Zkontrolovat teď“: jen načte nové články. Zpracuje se až to, co redakce vybere.
export async function checkSkolaNow(env, request, source, { fetchImpl = fetch } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const settings = await loadSkolaSettings(env, source);
  const lock = await lockSkola(env, source, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const collected = await collect(env, source, settings, fetchImpl, { manual: true });
    if (!collected.ok) return collected;
    const found = collected.added ? `Načteno nových článků: ${collected.added}. Vyberte, které má Drběna zpracovat.` : "Nic nového.";
    await writeSkolaStatus(env, source, { status: collected.warning ? "partial" : "ok", note: collected.warning ? `${found} Jeden kanál nejde: ${collected.warning}` : found });
    return { ok: true, added: collected.added };
  } finally {
    await unlockSkola(env, source, lock);
  }
}

// Ručně vybrané zpracuje na pozadí po krátkých dávkách. Volá se po výběru i při každém otevření stránky školy.
export async function continueSkola(env, source, { ctx = null, fetchImpl = fetch, ask = askSkola } = {}) {
  if (!(await countWaitingSkola(env, source, { manualOnly: true }))) return { ok: true, idle: true };
  const lock = await lockSkola(env, source, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: true, busy: true };
  const settings = await loadSkolaSettings(env, source);
  const work = async () => {
    try {
      await writeBatch(env, source, settings, { added: 0, fetchImpl, ask, budgetMs: CLICK_BUDGET_MS, max: BATCH_CLICK, manualOnly: true });
    } finally {
      await unlockSkola(env, source, lock);
    }
  };
  if (inBackground(ctx, work)) return { ok: true, background: true };
  await work();
  return { ok: true };
}

export async function selectSkola(env, request, source, ids, options = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const marked = await selectSkolaItems(env, source, ids);
  if (!marked) return { ok: false, error: "Vyberte aspoň jeden článek, který ještě není zpracovaný." };
  const started = await continueSkola(env, source, options);
  return { ok: true, marked, background: Boolean(started.background || started.busy) };
}
