// Akce v kalendáři v D1. Akce může mít zprávu (`article_id`), návrh zprávy od Drběny, který čeká na schválení
// (`proposal_id`, po schválení se z něj stane `article_id`), a odkaz jinam (`link`, přidává jen redakce).
import { addColumn, asBool, clip, liveArticle, requireChief } from "./db-core.js";

const eventFields = () => `e.id, e.title, e.place, e.starts_on, e.starts_time, e.description, e.published, e.link,
  e.article_id, a.slug as article_slug, a.title as article_title, (${liveArticle()}) as article_published,
  e.proposal_id, p.title as proposal_title, p.status as proposal_status, e.created_at`;
const EVENT_FROM = "events e left join articles a on a.id = e.article_id left join proposals p on p.id = e.proposal_id";
const EVENT_ORDER = "order by e.starts_on asc, e.starts_time asc, e.id asc";

export async function ensureEventColumns(env) {
  const info = await env.DB.prepare("pragma table_info(events)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "article_id", "alter table events add column article_id integer");
  await addColumn(env, names, "proposal_id", "alter table events add column proposal_id integer");
  await addColumn(env, names, "link", "alter table events add column link text not null default ''");
  // Drběna už na akci v článku vzpomněla (src/drbena-memory.js), podruhé ne.
  await addColumn(env, names, "recalled", "alter table events add column recalled integer not null default 0");
  // Kdy akce přibyla (UTC), pro feed nových akcí. Akce, které už v kalendáři byly, dostanou čas přidání sloupce.
  if (!names.has("created_at")) {
    await addColumn(env, names, "created_at", "alter table events add column created_at text not null default ''");
    await env.DB.prepare("update events set created_at = datetime('now') where created_at = ''").run();
  }
}

function optionalId(value) {
  return value == null || value === "" ? null : Number(value);
}

export function mapEvent(row) {
  const articlePublished = asBool(row.article_published);
  return {
    id: Number(row.id),
    title: String(row.title),
    place: String(row.place),
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    startsTime: String(row.starts_time ?? ""),
    description: String(row.description ?? ""),
    published: asBool(row.published),
    link: String(row.link ?? ""),
    articleId: optionalId(row.article_id),
    articleTitle: String(row.article_title ?? ""),
    // Na webu se odkazuje jen na zveřejněnou zprávu.
    articleSlug: articlePublished && row.article_slug ? String(row.article_slug) : "",
    articlePublished,
    proposalId: row.proposal_status === "pending" ? optionalId(row.proposal_id) : null,
    proposalTitle: row.proposal_status === "pending" ? String(row.proposal_title ?? "") : "",
    createdAt: String(row.created_at ?? ""),
  };
}

export async function loadEvents(env, { publicOnly = false } = {}) {
  const where = publicOnly ? "where e.published = 1" : "";
  const rows = await env.DB.prepare(`select ${eventFields()} from ${EVENT_FROM} ${where} ${EVENT_ORDER}`).all();
  return (rows.results ?? []).map(mapEvent);
}

// Odkaz jinam: jen celá adresa http(s). Prázdné je v pořádku.
export function readEventLink(value) {
  const raw = clip(value, 500);
  if (!raw) return { link: "" };
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:") return { link: url.href };
  } catch {
    // níž
  }
  return { error: "Odkaz musí být celá adresa, třeba https://kopidlno.cz/…" };
}

async function articleExists(env, id) {
  if (!id) return true;
  return Boolean(await env.DB.prepare("select id from articles where id = ?").bind(id).first());
}

export async function saveEvent(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const title = clip(input.title, 160);
  const place = clip(input.place, 160);
  const description = clip(input.description, 4000);
  const startsTime = clip(input.startsTime, 8);
  const startsOn = clip(input.startsOn, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return { ok: false, error: "Doplňte datum." };
  if (title.length < 3) return { ok: false, error: "Doplňte název akce." };
  if (place.length < 2) return { ok: false, error: "Doplňte místo." };
  const link = readEventLink(input.link);
  if (link.error) return { ok: false, error: link.error };
  const articleId = input.eventArticleId ?? null;
  if (!(await articleExists(env, articleId))) return { ok: false, error: "Ta zpráva už tu není." };
  const published = input.published ? 1 : 0;
  if (input.id) {
    // Návrh od Drběny drží akce dál, dokud redakce nevybere jinou zprávu.
    await env.DB.prepare(
      `update events set title = ?, place = ?, starts_on = ?, starts_time = ?, description = ?, published = ?, link = ?,
         article_id = ?, proposal_id = case when ? is null then proposal_id else null end
       where id = ?`,
    )
      .bind(title, place, startsOn, startsTime, description, published, link.link, articleId, articleId, input.id)
      .run();
    return { ok: true, id: input.id };
  }
  const result = await env.DB.prepare(
    "insert into events (title, place, starts_on, starts_time, description, published, link, article_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
  )
    .bind(title, place, startsOn, startsTime, description, published, link.link, articleId)
    .run();
  return { ok: true, id: Number(result.meta?.last_row_id) };
}

export async function removeEvent(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  await env.DB.prepare("delete from events where id = ?").bind(id).run();
  return { ok: true };
}

// Akce od Drběny z importu. Odkaz jinam nepřidává, jen zprávu (nebo návrh), kterou k ní napsala.
export async function insertBotEvent(env, event, { published, articleId = null, proposalId = null }) {
  const result = await env.DB.prepare(
    `insert into events (title, place, starts_on, starts_time, description, published, article_id, proposal_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(event.title, event.place, event.startsOn, event.startsTime, event.description, published ? 1 : 0, articleId ?? null, proposalId ?? null)
    .run();
  return Number(result.meta.last_row_id);
}

// Akce k položce importu. Když ji položka už má (zpráva z ní byla smazaná a Drběna ji píše znovu) a akce v kalendáři
// pořád je, připojí k ní novou zprávu a nechá ji, jak je (redakce ji mohla upravit). Jinak založí novou, je-li z čeho.
export async function saveBotEvent(env, event, { existingId = null, published, articleId = null, proposalId = null }) {
  const existing = existingId ? await env.DB.prepare("select id from events where id = ?").bind(existingId).first() : null;
  if (existing) {
    await env.DB.prepare("update events set article_id = ?, proposal_id = ? where id = ?")
      .bind(articleId ?? null, proposalId ?? null, existing.id)
      .run();
    return Number(existing.id);
  }
  return event ? insertBotEvent(env, event, { published, articleId, proposalId }) : null;
}

// Zpráva napsaná v redakci k akci (tlačítko „Napsat zprávu“ u akce).
export async function attachArticle(env, eventId, articleId) {
  if (!eventId || !articleId) return;
  await env.DB.prepare("update events set article_id = ?, proposal_id = null where id = ?").bind(articleId, eventId).run();
}

// Schválený návrh: akce dostane hotovou zprávu.
export async function linkEventsToArticle(env, proposalId, articleId) {
  if (!articleId) return;
  await env.DB.prepare("update events set article_id = ?, proposal_id = null where proposal_id = ? and article_id is null")
    .bind(articleId, proposalId)
    .run();
}

export async function forgetProposal(env, proposalId) {
  await env.DB.prepare("update events set proposal_id = null where proposal_id = ?").bind(proposalId).run();
}

export async function forgetArticle(env, articleId) {
  await env.DB.prepare("update events set article_id = null where article_id = ?").bind(articleId).run();
}
