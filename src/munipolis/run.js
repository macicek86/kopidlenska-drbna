// Jeden průchod importu: stáhnout RSS, nové zprávy dát Claudovi a výsledek uložit jako návrh, akci nebo odstávku.
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
import { requireChief } from "../db-core.js";
import { fetchImage, storeImageBytes } from "../images.js";
import { insertNotice, loadNotices } from "../notices-db.js";
import { addDays, pragueNow } from "../waste.js";
import { askClaude } from "./ai.js";
import { fetchFeed } from "./feed.js";
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
const LOOKBACK_DAYS = 60;

export function sourceParagraph(link) {
  if (!link) return `<p><em>Zdroj: Munipolis města Kopidlna</em></p>`;
  const href = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<p><em>Zdroj: <a href="${href}" target="_blank" rel="noopener noreferrer">Munipolis města Kopidlna</a></em></p>`;
}

export function outcomeOf(item) {
  if (item.status === "hotovo") {
    const made = [
      item.articleId && `zprava:${item.articleId}`,
      item.proposalId && `navrh:${item.proposalId}`,
      item.eventId && `akce:${item.eventId}`,
      item.noticeId && `odstavka:${item.noticeId}`,
    ].filter(Boolean);
    return `zpracováno (${made.join(", ") || "nic"})`;
  }
  if (item.status === "duplicita") return `duplicita s ${item.duplicateOf || "něčím na webu"}`;
  if (item.status === "preskoceno") return "přeskočeno";
  return "";
}

async function rows(env, sql, ...binds) {
  const statement = env.DB.prepare(sql);
  const result = await (binds.length ? statement.bind(...binds) : statement).all();
  return result.results ?? [];
}

// Co už na drbně je, aby Claude poznal stejnou věc od někoho jiného.
async function knownContent(env, itemId, today) {
  const since = addDays(today, -LOOKBACK_DAYS);
  const articles = await rows(
    env,
    "select id, title, excerpt, created_at from articles where created_at >= ? order by created_at desc, id desc limit 60",
    since,
  );
  const proposals = await rows(
    env,
    "select id, title, excerpt, created_at from proposals where status = 'pending' order by id desc limit 30",
  );
  const events = await rows(
    env,
    "select id, title, place, starts_on, starts_time from events where starts_on >= ? order by starts_on asc limit 60",
    addDays(today, -30),
  );
  const notices = (await loadNotices(env)).filter((row) => (row.endsOn || row.startsOn) >= addDays(today, -30));
  const imports = await rows(
    env,
    `select id, title, published_at, status, duplicate_of, article_id, proposal_id, event_id, notice_id from import_items
     where id != ? and status in ('hotovo', 'duplicita', 'preskoceno') and published_at >= ? order by published_at desc limit 40`,
    itemId,
    since,
  );
  return {
    articles: articles.map((row) => ({ id: row.id, title: row.title, excerpt: row.excerpt, createdOn: String(row.created_at).slice(0, 10) })),
    proposals: proposals.map((row) => ({ id: row.id, title: row.title, excerpt: row.excerpt, createdOn: String(row.created_at).slice(0, 10) })),
    events: events.map((row) => ({ id: row.id, title: row.title, place: row.place, startsOn: row.starts_on, startsTime: row.starts_time })),
    notices,
    imports: imports.map((row) => ({
      id: row.id,
      title: row.title,
      publishedOn: String(row.published_at).slice(0, 10),
      outcome: outcomeOf({
        status: row.status,
        duplicateOf: row.duplicate_of,
        articleId: row.article_id,
        proposalId: row.proposal_id,
        eventId: row.event_id,
        noticeId: row.notice_id,
      }),
    })),
  };
}

async function rubricMap(env) {
  const list = await rows(env, "select id, name, slug from rubrics order by sort_order asc, id asc");
  return new Map(list.map((row) => [String(row.slug), { id: Number(row.id), name: String(row.name) }]));
}

async function downloadImages(urls, fetchImpl) {
  const images = [];
  for (const url of urls.slice(0, 2)) {
    const image = await fetchImage(url, { fetchImpl });
    if (image) images.push(image);
  }
  return images;
}

// Datum zveřejnění zprávy v Munipolisu jako pražský den, nebo prázdné (pak dnešek).
export function importSourceDate(item, today) {
  const parsed = Date.parse(item.publishedAt);
  if (!Number.isFinite(parsed)) return "";
  const day = pragueNow(new Date(parsed)).date;
  return day <= today ? day : "";
}

// Ručně vybranou zprávu Drběna zpracuje vždy (redakce rozhodla) a článek dostane datum ze zdroje. Cron píše s dnešním datem.
export async function processItem(env, item, settings, { fetchImpl = fetch, ask = askClaude } = {}) {
  const today = pragueNow().date;
  const force = item.manual;
  const rubrics = await rubricMap(env);
  const images = await downloadImages(item.images, fetchImpl);
  const answer = await ask(env, {
    item,
    known: await knownContent(env, item.id, today),
    images,
    rubricSlugs: [...rubrics.keys()],
    voice: settings.voice,
    today,
    force,
  });
  if (!answer.ok) {
    await finishItem(env, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error };
  }
  if (answer.decision !== "vytvorit") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    await finishItem(env, item.id, { status, reason: answer.reason, duplicateOf: answer.duplicateOf });
    return { ok: true, status };
  }

  const made = {};
  if (answer.article) {
    const imageKey = images[0] ? await storeImageBytes(env, images[0]) : null;
    Object.assign(
      made,
      await saveBotArticle(env, {
        article: answer.article,
        imageKey,
        sourceHtml: sourceParagraph(item.link),
        autoPublish: settings.autoPublish,
        rubric: rubrics.get(answer.article.rubric),
        publishOn: item.manual ? importSourceDate(item, today) : "",
      }),
    );
  }
  if (answer.event) {
    const event = answer.event;
    const result = await env.DB.prepare(
      "insert into events (title, place, starts_on, starts_time, description, published) values (?, ?, ?, ?, ?, ?)",
    )
      .bind(event.title, event.place, event.startsOn, event.startsTime, event.description, settings.autoPublish ? 1 : 0)
      .run();
    made.eventId = Number(result.meta.last_row_id);
  }
  if (answer.notice) {
    made.noticeId = await insertNotice(env, { ...answer.notice, sourceUrl: item.link, published: settings.autoPublish });
  }
  await finishItem(env, item.id, { status: "hotovo", reason: answer.reason, ...made });
  return { ok: true, status: "hotovo" };
}

function summary(results, added, waiting) {
  const done = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const parts = [];
  if (added) parts.push(`Nových zpráv: ${added}.`);
  if (done) parts.push(`Zpracováno: ${done}.`);
  if (failed.length) parts.push(`Nepovedlo se: ${failed.length} (${failed[0].error})`);
  if (waiting) parts.push(`Na zpracování čeká ještě ${waiting}.`);
  if (!parts.length) parts.push("Nic nového.");
  return { status: failed.length ? (done ? "partial" : "error") : "ok", note: parts.join(" ") };
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
  const result = summary(results, added, await countWaitingItems(env));
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
