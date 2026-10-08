// Jeden průchod webu školy nebo města: stáhnout články, nové dát Claudovi a výsledek uložit jako zprávu (návrh) nebo akci.
// Všechny funkce berou školu ze `sources.js` (bez ní ZŠ a MŠ).
import { sourceEntry } from "../article-source.js";
import { saveBotEvent } from "../events-db.js";
import {
  CLICK_BUDGET_MS,
  CLICK_LOCK_SECONDS,
  CRON_BUDGET_MS,
  CRON_LOCK_SECONDS,
  drain,
  isFresh,
  STALE_REASON,
} from "../background.js";
import { saveBotArticle } from "../bot-article.js";
import { noteEventChange } from "../event-change.js";
import { followupReason, saveFollowup, saveFollowupEvent } from "../followup.js";
import { requireChief } from "../db-core.js";
import { loadDrbena } from "../drbena-db.js";
import { voiceFor } from "../drbena.js";
import { memoryOn, withMemory } from "../drbena-memory.js";
import { fetchImage, storeImageBytes } from "../images.js";
import { noteReads } from "../import-tools.js";
import { importSourceDate, importSummary, knownContent, rubricMap } from "../import-context.js";
import { visibleImages } from "../munipolis/ai.js";
import { pragueNow } from "../waste.js";
import { loadStockTopics, pickStockImage } from "../stock-db.js";
import { askSkola } from "./ai.js";
import { DESK_SECTION, fetchDocuments } from "./deska.js";
import { deferDay, deferSkolaItem, laterNote, loadKeptImages, PAST_REASON, releaseKeptImages, reopenDeferred, termOver } from "./defer.js";
import { pastedFrom } from "./paste.js";
import { draftPastedItem } from "./paste-run.js";
import { SCHOOLS } from "./sources.js";
import { noteOff, noteSource } from "../health/store.js";
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
// Řádek na stránce Stav (src/health/).
function healthRow(source) {
  return { key: source.tag, label: source.page, page: `/redakce/${source.tag}` };
}

const BUSY = "Drběna už ten web čte. Počkejte, stránka se sama obnoví.";

// Zdroj pod čarou (src/article-source.js). Dokument z úřední desky se jmenuje podle desky, vložený příspěvek podle toho, odkud je.
export function skolaSource(link, source = SCHOOLS.skola, section = "") {
  if (source.pasted) return sourceEntry(pastedFrom(source, section), link);
  const label = section === DESK_SECTION ? `úřední deska ${source.name}` : `web ${source.name}`;
  return sourceEntry(label, link);
}

// Fotka je z webu zdroje, i když ji škole (městu) dal někdo jiný (autora uvede Drběna v popisku, když ho škola zmíní).
export function photoCaption(caption, source = SCHOOLS.skola, section = "") {
  const credit = source.pasted ? `foto: ${pastedFrom(source, section)}` : `foto: web ${source.name}`;
  return caption ? `${caption} (${credit})` : `F${credit.slice(1)}`;
}

async function downloadImages(env, urls, fetchImpl) {
  const images = [];
  for (const url of urls.slice(0, 2)) {
    const image = await fetchImage(env, url, { fetchImpl });
    if (image) images.push(image);
  }
  return images;
}

// Fotku z webu zdroje jen se zapnutým nastavením a když ji Drběna vybrala (i pěkný plakát, ořízne se jako fotka), jinak ilustrační z knihovny.
// Plakát uložený při odložení (`key`) se nenahrává znovu.
export async function skolaImage(env, article, images, ownPhotos, source = SCHOOLS.skola, section = "") {
  const [own] = visibleImages(images);
  if (ownPhotos && article.imageUse !== "knihovna" && own) {
    return { key: own.key ?? (await storeImageBytes(env, own)), focus: "", caption: photoCaption(article.imageCaption, source, section) };
  }
  return pickStockImage(env, article.imageTopic);
}

// Ručně vybraný článek Drběna zpracuje vždy (redakce rozhodla) a zpráva dostane datum ze zdroje. Cron píše s dnešním datem,
// stejně jako odloženou pozvánku (`defer.js`), i když ji redakce pustí dřív. Uložené plakáty odložené položky se po zpracování uklidí.
// Vložený příspěvek dostane jen koncept (`paste-run.js`), fotky počkají, až ho redakce zveřejní nebo zahodí.
export async function processSkolaItem(env, source, item, settings, options = {}) {
  if (source.pasted) return draftPastedItem(env, source, item, options);
  const result = await handleSkolaItem(env, source, item, settings, options);
  if (result.ok) await releaseKeptImages(env, source, item);
  return result;
}

async function handleSkolaItem(env, source, item, settings, { fetchImpl = fetch, ask = askSkola } = {}) {
  const today = pragueNow().date;
  if (source.defer && !item.manual && termOver(item.term, today)) {
    await finishSkolaItem(env, source, item.id, { status: "preskoceno", reason: PAST_REASON });
    return { ok: true, status: "preskoceno" };
  }
  const publishOn = item.manual && !item.writeOn ? importSourceDate(item, today) : "";
  const rubrics = await rubricMap(env);
  const kept = item.keptImages?.length ? await loadKeptImages(env, item.keptImages) : [];
  const images = kept.length ? kept : await downloadImages(env, item.images, fetchImpl);
  const documents = item.documents?.length ? await fetchDocuments(item.documents, { fetchImpl }) : [];
  if (item.documents?.length && !documents.length) {
    const reason = "Přílohu z úřední desky nejde stáhnout. Zkusí se to příště.";
    await finishSkolaItem(env, source, item.id, { status: "chyba", reason });
    return { ok: false, error: reason };
  }
  const drbena = await loadDrbena(env);
  const memory = memoryOn(drbena, publishOn, today);
  const answer = await ask(env, {
    source,
    item,
    known: await knownContent(env, { itemId: item.id, today, table: source.itemsTable, recall: memory, about: item }),
    images,
    documents,
    topics: await loadStockTopics(env),
    rubricSlugs: [...rubrics.keys()],
    voice: withMemory(voiceFor(drbena), memory),
    today,
    force: item.manual,
    later: laterNote(item),
    ownPhotos: settings.ownPhotos,
  });
  if (!answer.ok) {
    await finishSkolaItem(env, source, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error, usage: answer.usage };
  }
  // Zrušení nebo změna akce v kalendáři (src/event-change.js) a věta o ní do zdůvodnění.
  answer.reason = await noteEventChange(env, answer);
  if (answer.decision === "doplneni") {
    const made = await saveFollowup(env, answer, {
      image: await pickStockImage(env, answer.article.imageTopic),
      source: skolaSource(item.link, source, item.section),
      autoPublish: settings.autoPublish,
      rubrics,
      publishOn,
      spread: !item.manual,
    });
    await finishSkolaItem(env, source, item.id, {
      status: "hotovo",
      reason: noteReads(followupReason(answer), answer),
      duplicateOf: answer.duplicateOf,
      eventId: await saveFollowupEvent(env, answer, item, made, settings.autoPublish),
      ...made,
    });
    return { ok: true, status: "hotovo", usage: answer.usage };
  }
  if (answer.decision !== "vytvorit") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    // Akce z dřívějšího čtení (odložená pozvánka) v kalendáři zůstává.
    await finishSkolaItem(env, source, item.id, { status, reason: noteReads(answer.reason, answer), duplicateOf: answer.duplicateOf, eventId: item.eventId });
    return { ok: true, status, usage: answer.usage };
  }

  const later = source.defer && answer.event ? deferDay(item, answer.event.startsOn, settings.aheadDays, today) : "";
  if (later) {
    // Akce bez článku jde na web hned i bez „Rovnou zveřejňovat“: pozvánka přijde až za dlouho a schvaluje se jen ona.
    const eventId = await saveBotEvent(env, answer.event, { existingId: item.eventId, published: true });
    await deferSkolaItem(env, source, item.id, { writeOn: later, eventId, reason: noteReads(answer.reason, answer), images });
    return { ok: true, status: "odlozeno", usage: answer.usage };
  }

  const made = {};
  if (answer.article) {
    Object.assign(
      made,
      await saveBotArticle(env, {
        article: answer.article,
        image: await skolaImage(env, answer.article, images, settings.ownPhotos, source, item.section),
        source: skolaSource(item.link, source, item.section),
        autoPublish: settings.autoPublish,
        rubric: rubrics.get(answer.article.rubric),
        publishOn,
        spread: !item.manual,
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
  await finishSkolaItem(env, source, item.id, { status: "hotovo", reason: noteReads(answer.reason, answer), ...made });
  return { ok: true, status: "hotovo", usage: answer.usage };
}

// Stáhne RSS a nové články si zapamatuje. Rychlé, takže běží i přímo po kliknutí.
async function collect(env, source, settings, fetchImpl) {
  const feed = await source.fetchItems(settings.feedUrls, { fetchImpl });
  await noteSource(env, { ...healthRow(source), items: feed.ok ? feed.items.length : null, error: feed.ok ? feed.warning ?? "" : feed.error });
  if (!feed.ok) {
    await writeSkolaStatus(env, source, { status: "error", note: feed.error });
    return feed;
  }
  const today = pragueNow().date;
  // Odložené pozvánky, kterým nastal den (`defer.js`), jdou zpátky do fronty.
  if (source.defer) await reopenDeferred(env, source, today);
  const isOld = (item) => !isFresh(importSourceDate(item, today), today, settings.freshDays);
  return { ok: true, warning: feed.warning, added: await rememberSkolaItems(env, source, feed.items, { isOld }) };
}

// Další článek z fronty. Automatický, který mezitím zestárl (třeba po dlouhé pauze), jde stranou mezi starší.
// Vložený příspěvek vybrala redakce, ten se píše vždy.
async function nextFresh(env, source, settings, manualOnly) {
  const today = pragueNow().date;
  for (;;) {
    const [item] = await waitingSkolaItems(env, source, 1, { manualOnly });
    if (!item || source.pasted || item.manual || item.writeOn || isFresh(importSourceDate(item, today), today, settings.freshDays)) return item;
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
// vždy dopíše to, co redakce ručně vybrala (s datem ze zdroje). Vložené příspěvky nic nestahují, cron jen dopíše frontu.
export async function runSkola(env, source, { fetchImpl = fetch, ask = askSkola } = {}) {
  const settings = await loadSkolaSettings(env, source);
  const reading = settings.enabled && !source.pasted;
  if (!settings.enabled && !source.pasted) await noteOff(env, source.tag);
  const waiting = await countWaitingSkola(env, source, { manualOnly: !source.pasted });
  if (!reading && !waiting) return { ok: true, skipped: true };
  const lock = await lockSkola(env, source, CRON_LOCK_SECONDS);
  if (!lock) return { ok: true, skipped: true };
  try {
    let added = 0;
    let warning = "";
    if (reading) {
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
      manualOnly: !reading && !source.pasted,
    });
    return { ok: result.status !== "error", note: result.note };
  } finally {
    await unlockSkola(env, source, lock);
  }
}

// Tlačítko „Zkontrolovat teď“ udělá totéž co cron: stáhne nové články, starší odloží stranou. Čerstvé pak píše
// otevřená stránka (`continueSkola` přes /pokracovat).
export async function checkSkolaNow(env, request, source, { fetchImpl = fetch } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const settings = await loadSkolaSettings(env, source);
  const lock = await lockSkola(env, source, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const collected = await collect(env, source, settings, fetchImpl);
    if (!collected.ok) return collected;
    const found = collected.added ? `Načteno nových článků: ${collected.added}. Drběna je teď zpracuje.` : "Nic nového.";
    await writeSkolaStatus(env, source, { status: collected.warning ? "partial" : "ok", note: collected.warning ? `${found} Jeden kanál nejde: ${collected.warning}` : found });
    return { ok: true, added: collected.added };
  } finally {
    await unlockSkola(env, source, lock);
  }
}


// Čekající články (z cronu, Zkontrolovat teď i ručně puštěné v detailu) zpracuje po krátké dávce. Volá ji otevřená stránka školy
// požadavkem na /pokracovat a čeká na odpověď, takže práci Cloudflare po 30 s neutne jako `waitUntil`.
export async function continueSkola(env, source, { fetchImpl = fetch, ask = askSkola } = {}) {
  if (!(await countWaitingSkola(env, source))) return { ok: true, idle: true };
  const lock = await lockSkola(env, source, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: true, busy: true };
  const settings = await loadSkolaSettings(env, source);
  try {
    await writeBatch(env, source, settings, { added: 0, fetchImpl, ask, budgetMs: CLICK_BUDGET_MS, max: BATCH_CLICK });
  } finally {
    await unlockSkola(env, source, lock);
  }
  return { ok: true };
}

export async function selectSkola(env, request, source, ids) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const marked = await selectSkolaItems(env, source, ids);
  if (!marked) return { ok: false, error: "Vyberte aspoň jeden článek, který ještě není zpracovaný." };
  return { ok: true, marked };
}
