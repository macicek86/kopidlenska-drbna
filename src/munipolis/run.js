// Jeden průchod importu: stáhnout RSS, nové zprávy dát Claudovi a výsledek uložit jako návrh, akci nebo odstávku.
import { saveBotArticle } from "../bot-article.js";
import { requireChief } from "../db-core.js";
import { fetchImage, storeImageBytes } from "../images.js";
import { insertNotice, loadNotices } from "../notices-db.js";
import { addDays, pragueNow } from "../waste.js";
import { askClaude } from "./ai.js";
import { fetchFeed } from "./feed.js";
import {
  finishItem,
  loadImportItem,
  loadImportSettings,
  lockImport,
  rememberItems,
  unlockImport,
  waitingItems,
  writeImportStatus,
} from "./store.js";

// Kolik zpráv se zpracuje najednou. Cron má času dost, kliknutí v redakci čeká na odpověď.
export const BATCH_CRON = 5;
export const BATCH_CLICK = 2;
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

export async function processItem(env, item, settings, { force = false, fetchImpl = fetch, ask = askClaude } = {}) {
  const today = pragueNow().date;
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

function summary(results, added) {
  const done = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const parts = [];
  if (added) parts.push(`Nových zpráv: ${added}.`);
  if (done) parts.push(`Zpracováno: ${done}.`);
  if (failed.length) parts.push(`Nepovedlo se: ${failed.length} (${failed[0].error})`);
  if (!parts.length) parts.push("Nic nového.");
  return { status: failed.length ? (done ? "partial" : "error") : "ok", note: parts.join(" ") };
}

// Cron i tlačítko „Zkontrolovat teď“. Bez zapnutého importu ho cron přeskočí.
export async function runImport(env, { request = null, fetchImpl = fetch, ask = askClaude } = {}) {
  if (request) {
    const gate = await requireChief(env, request);
    if (!gate.ok) return gate;
  }
  const settings = await loadImportSettings(env);
  if (!request && !settings.enabled) return { ok: true, skipped: true };
  const lock = await lockImport(env);
  if (!lock) return { ok: false, error: "Import už běží. Zkuste to za chvíli." };
  try {
    const feed = await fetchFeed(settings.feedUrl, { fetchImpl });
    if (!feed.ok) {
      await writeImportStatus(env, { status: "error", note: feed.error });
      return { ok: false, error: feed.error };
    }
    const added = await rememberItems(env, feed.items, settings.since);
    const batch = await waitingItems(env, request ? BATCH_CLICK : BATCH_CRON);
    const results = [];
    for (const item of batch) results.push(await processItem(env, item, settings, { fetchImpl, ask }));
    const result = summary(results, added);
    await writeImportStatus(env, result);
    return { ok: result.status !== "error", error: result.note, note: result.note };
  } finally {
    await unlockImport(env, lock);
  }
}

// Ruční zpracování jedné zprávy z redakce. Přeskočenou nebo duplicitní zpracuje i proti Claudovu názoru.
export async function runOne(env, request, id, { fetchImpl = fetch, ask = askClaude } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const item = id ? await loadImportItem(env, id) : null;
  if (!item) return { ok: false, error: "Tahle zpráva v importu není." };
  if (item.status === "hotovo") return { ok: false, error: "Tahle zpráva už je zpracovaná." };
  const lock = await lockImport(env);
  if (!lock) return { ok: false, error: "Import už běží. Zkuste to za chvíli." };
  try {
    const settings = await loadImportSettings(env);
    const force = item.status === "preskoceno" || item.status === "duplicita";
    return await processItem(env, item, settings, { force, fetchImpl, ask });
  } finally {
    await unlockImport(env, lock);
  }
}
