// Jeden průchod fotbalu: stáhnout aktuality FK Kopidlno (`collect.js`) a nechat Drběnu napsat článek.
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
import { loadDrbena } from "../drbena-db.js";
import { voiceFor } from "../drbena.js";
import { fetchImage, storeImageBytes } from "../images.js";
import { MAX_ATTEMPTS } from "../munipolis/store.js";
import { addDays, pragueNow } from "../waste.js";
import { askFootball } from "./ai.js";
import { collectNews, footballSourceDate } from "./collect.js";
import { checkDates } from "./dates.js";
import {
  countWaiting,
  finishFootballItem,
  selectFootballItems,
  footballDue,
  loadFootballSettings,
  lockFootball,
  saveCrest,
  unlockFootball,
  waitingFootballItems,
  writeFootballStatus,
} from "./store.js";

export const BATCH_CRON = 8;
export const BATCH_CLICK = 2;
const LOOKBACK_DAYS = 60;

export function clubSource(link) {
  if (!link) return `<p><em>Zdroj: web FK Kopidlno</em></p>`;
  const href = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<p><em>Zdroj: <a href="${href}" target="_blank" rel="noopener noreferrer">web FK Kopidlno</a></em></p>`;
}

async function rows(env, sql, ...binds) {
  const statement = env.DB.prepare(sql);
  const result = await (binds.length ? statement.bind(...binds) : statement).all();
  return result.results ?? [];
}

async function knownContent(env, today) {
  const articles = await rows(
    env,
    "select id, title, excerpt, created_at from articles where created_at >= ? order by created_at desc, id desc limit 60",
    addDays(today, -LOOKBACK_DAYS),
  );
  const proposals = await rows(env, "select id, title, excerpt, created_at from proposals where status = 'pending' order by id desc limit 30");
  const shape = (row) => ({ id: row.id, title: row.title, excerpt: row.excerpt, createdOn: String(row.created_at).slice(0, 10) });
  return { articles: articles.map(shape), proposals: proposals.map(shape) };
}

async function targetRubric(env, settings) {
  const chosen = settings.rubricId ? await env.DB.prepare("select id, name from rubrics where id = ?").bind(settings.rubricId).first() : null;
  const row =
    chosen ??
    (await env.DB.prepare("select id, name from rubrics where slug = 'sport'").first()) ??
    (await env.DB.prepare("select id, name from rubrics order by sort_order asc, id asc limit 1").first());
  return { id: Number(row.id), name: String(row.name) };
}

// Fotka z aktuality, jinak obrázek, který klub dává k aktualitám (znak). Ten se do R2 ukládá jen jednou a pak se sdílí.
async function articleImage(env, item, settings, fetchImpl) {
  const photo = item.images[0] ? await fetchImage(item.images[0], { fetchImpl }) : null;
  if (photo) return storeImageBytes(env, photo);
  const url = item.cover;
  if (!url || !settings.useCrest) return null;
  if (url === settings.crestUrl && settings.crestKey && (await env.BUCKET.head(settings.crestKey))) return settings.crestKey;
  const image = await fetchImage(url, { fetchImpl });
  if (!image) return null;
  const key = await storeImageBytes(env, image);
  await saveCrest(env, url, key);
  return key;
}

// Ručně vybranou aktualitu Drběna napíše vždy (redakce rozhodla) a s datem ze zdroje. Cron píše s dnešním datem.
// Když datum ve zdroji nesedí (den v týdnu, rozpis), článek jde jako návrh, i když se má rovnou zveřejňovat.
// Co opravily oficiální údaje z fotbalunas.cz, návrh nevynutí: Drběna píše správně a redakce se to dozví v poznámce.
export async function processFootball(env, item, settings, { fetchImpl = fetch, ask = askFootball } = {}) {
  const today = pragueNow().date;
  const force = item.manual;
  const { doubts, fixes } = checkDates(item);
  const known = await knownContent(env, today);
  const answer = await ask(env, { item, known, voice: voiceFor(await loadDrbena(env), "fotbal"), today, force, doubts, fixes });
  if (!answer.ok) {
    await finishFootballItem(env, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error };
  }
  if (answer.decision !== "vytvorit") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    await finishFootballItem(env, item.id, { status, reason: answer.reason, duplicateOf: answer.duplicateOf });
    return { ok: true, status };
  }
  const made = await saveBotArticle(env, {
    article: answer.article,
    image: { key: await articleImage(env, item, settings, fetchImpl) },
    sourceHtml: clubSource(item.link),
    autoPublish: settings.autoPublish && !doubts.length,
    rubric: await targetRubric(env, settings),
    publishOn: item.manual ? footballSourceDate(item, today) : "",
  });
  const reason = [
    fixes.length ? `Opraveno podle fotbalunas.cz: ${fixes.join(" ")}` : "",
    doubts.length ? `Zkontrolujte datum, ve zdroji nesedí: ${doubts.join(" ")}` : "",
    answer.reason,
  ]
    .filter(Boolean)
    .join(" ");
  await finishFootballItem(env, item.id, { status: "hotovo", reason, ...made });
  return { ok: true, status: "hotovo" };
}

function summary(results, added, waiting) {
  const done = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const parts = [];
  if (added) parts.push(`Nových aktualit: ${added}.`);
  if (done) parts.push(`Zpracováno: ${done}.`);
  if (failed.length) parts.push(`Nepovedlo se: ${failed.length} (${failed[0].error})`);
  if (waiting) parts.push(`Na zpracování čeká ještě ${waiting}.`);
  if (!parts.length) parts.push("Nic nového.");
  return { status: failed.length ? (done ? "partial" : "error") : "ok", note: parts.join(" ") };
}

// Další aktualita z fronty. Automatická, která mezitím zestárla (třeba po dlouhé pauze), jde stranou mezi starší.
async function nextFresh(env, settings, manualOnly) {
  const today = pragueNow().date;
  for (;;) {
    const [item] = await waitingFootballItems(env, 1, MAX_ATTEMPTS, { manualOnly });
    if (!item || item.manual || isFresh(footballSourceDate(item, today), today, settings.freshDays)) return item;
    await env.DB.prepare("update football_items set status = 'stare', reason = ? where id = ?").bind(STALE_REASON, item.id).run();
  }
}

async function writeBatch(env, settings, { added, checked, fetchImpl, ask, budgetMs, max, manualOnly = false }) {
  const results = await drain({
    next: () => nextFresh(env, settings, manualOnly),
    handle: (item) => processFootball(env, item, settings, { fetchImpl, ask }),
    budgetMs,
    max,
  });
  const result = summary(results, added, await countWaiting(env, MAX_ATTEMPTS));
  if (checked || results.length) await writeFootballStatus(env, { ...result, checked });
  return result;
}

const BUSY = "Drběna už na fotbale pracuje. Počkejte, stránka se sama obnoví.";

// Tlačítko „Zkontrolovat teď“: jen načte nové aktuality. Zpracuje se až to, co redakce vybere.
export async function checkFootballNow(env, request, { fetchImpl = fetch } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const settings = await loadFootballSettings(env);
  const lock = await lockFootball(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const collected = await collectNews(env, settings, { fetchImpl, manual: true });
    if (!collected.ok) {
      await writeFootballStatus(env, { status: "error", note: collected.error });
      return collected;
    }
    const note = collected.added ? `Načteno nových aktualit: ${collected.added}. Vyberte, které má Drběna zpracovat.` : "Nic nového.";
    await writeFootballStatus(env, { status: "ok", note });
    return { ok: true, added: collected.added };
  } finally {
    await unlockFootball(env, lock);
  }
}

// Ručně vybrané aktuality píše na pozadí po krátkých dávkách. Volá se po výběru i při každém otevření stránky Fotbal,
// takže se fronta vybraných dopisuje, dokud je stránka otevřená (sama se obnovuje).
export async function continueFootball(env, { ctx = null, fetchImpl = fetch, ask = askFootball } = {}) {
  if (!(await countWaiting(env, MAX_ATTEMPTS, { manualOnly: true }))) return { ok: true, idle: true };
  const lock = await lockFootball(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: true, busy: true };
  const settings = await loadFootballSettings(env);
  const work = async () => {
    try {
      await writeBatch(env, settings, { added: 0, checked: false, fetchImpl, ask, budgetMs: CLICK_BUDGET_MS, max: BATCH_CLICK, manualOnly: true });
    } finally {
      await unlockFootball(env, lock);
    }
  };
  if (inBackground(ctx, work)) return { ok: true, background: true };
  await work();
  return { ok: true };
}

// Redakce zaškrtla aktuality (nebo klikla na „Zpracovat teď“ u jedné). Hotové se znovu nepíšou.
export async function selectFootball(env, request, ids, options = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const marked = await selectFootballItems(env, ids);
  if (!marked) return { ok: false, error: "Vyberte aspoň jednu aktualitu, která ještě není zpracovaná." };
  const started = await continueFootball(env, options);
  return { ok: true, marked, background: Boolean(started.background || started.busy) };
}

// Cron každé čtyři hodiny: web klubu stáhne, jen když je čas (podle nastavení), frontu ale dopisuje pokaždé.
// Ručně vybrané má přednost a píše je s datem ze zdroje.
export async function runFootball(env, { fetchImpl = fetch, ask = askFootball } = {}) {
  const settings = await loadFootballSettings(env);
  const manualWaiting = await countWaiting(env, MAX_ATTEMPTS, { manualOnly: true });
  if (!settings.enabled && !manualWaiting) return { ok: true, skipped: true };
  const lock = await lockFootball(env, CRON_LOCK_SECONDS);
  if (!lock) return { ok: true, skipped: true };
  try {
    let added = 0;
    const checked = footballDue(settings);
    if (checked) {
      const collected = await collectNews(env, settings, { fetchImpl });
      if (!collected.ok) {
        await writeFootballStatus(env, { status: "error", note: collected.error });
        return { ok: false, error: collected.error };
      }
      added = collected.added;
    }
    const result = await writeBatch(env, settings, {
      added,
      checked,
      fetchImpl,
      ask,
      budgetMs: CRON_BUDGET_MS,
      max: BATCH_CRON,
      manualOnly: !settings.enabled,
    });
    return { ok: result.status !== "error", note: result.note };
  } finally {
    await unlockFootball(env, lock);
  }
}
