// Vložený příspěvek (`paste.js`): Drběna napíše koncept a nic dalšího nevznikne. Redakce ho v okně zveřejní,
// naplánuje, otevře v běžném formuláři zprávy, nechá přepsat s poznámkou, vrátí předchozí verzi, nebo zahodí.
// Zpráva, akce i změna akce v kalendáři (`event-change.js`) se uloží až zveřejněním. Fotku ke zprávě vybírá redakce.
import { saveBotArticle } from "../bot-article.js";
import { clip, pragueStamp, requireChief, sqlStamp } from "../db-core.js";
import { loadDrbena } from "../drbena-db.js";
import { voiceFor } from "../drbena.js";
import { memoryOn, withMemory } from "../drbena-memory.js";
import { noteEventChange } from "../event-change.js";
import { saveBotEvent } from "../events-db.js";
import { followupReason } from "../followup.js";
import { knownContent, rubricMap } from "../import-context.js";
import { noteReads } from "../import-tools.js";
import { readPublishTime } from "../publish-time.js";
import { formImage, loadStockTopics, pickStockImage } from "../stock-db.js";
import { pragueNow } from "../waste.js";
import { askSkola, followSkola } from "./ai.js";
import { loadKeptImages, releaseKeptImages } from "./defer.js";
import { photoCaption, skolaSource } from "./run.js";
import { finishSkolaItem, loadSkolaItem } from "./store.js";

export const PUBLISH_ACTIONS = ["zverejnit", "naplanovat", "upravit"];
const GONE = "Ten příspěvek už tu není.";

// Co Drběna dostane navíc, když ji redakce nechá psát znovu: předchozí verzi a poznámku.
export function redoText(item) {
  const previous = item.previousDraft?.article;
  if (!previous && !item.redoNote) return "";
  return [
    previous ? `Tenhle příspěvek jsi už jednou zpracovala. Tvoje předchozí verze:\nNadpis: ${previous.title}\nPerex: ${previous.excerpt}\nText:\n${previous.body}` : "",
    item.redoNote
      ? `Redakce k tomu píše: ${item.redoNote}\nPodle toho napiš novou verzi. Co redakce doplnila, ber jako ověřené údaje.`
      : "Redakce chce jinou verzi. Napiš to jinak.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function draftOf(answer) {
  return {
    decision: answer.decision,
    reason: answer.decision === "doplneni" ? followupReason(answer) : answer.reason,
    duplicateOf: answer.duplicateOf ?? "",
    article: answer.article,
    event: answer.event ?? null,
    eventChange: answer.eventChange ?? null,
    target: answer.target ? { id: answer.target.id, title: answer.target.title, rubricSlug: answer.target.rubricSlug ?? "" } : null,
  };
}

async function saveDraft(env, source, id, draft) {
  await env.DB.prepare(
    `update ${source.itemsTable} set status = 'napsano', draft = ?, reason = ?, duplicate_of = ?, redo_note = '', attempts = 0,
       processed_at = datetime('now') where id = ?`,
  )
    .bind(JSON.stringify(draft), clip(draft.reason, 400), draft.duplicateOf, id)
    .run();
}

// Zpracování z fronty (`processSkolaItem`). Fotky Claude vidí jen se zaškrtnutým „Ukázat fotky Drběně“.
export async function draftPastedItem(env, source, item, { ask = askSkola, follow = followSkola } = {}) {
  const today = pragueNow().date;
  const rubrics = await rubricMap(env);
  const rubricSlugs = [...rubrics.keys()];
  const topics = await loadStockTopics(env);
  const drbena = await loadDrbena(env);
  const memory = memoryOn(drbena, "", today);
  const voice = withMemory(voiceFor(drbena), memory);
  const extra = redoText(item);
  const answer = item.followOf
    ? await follow(env, { source, item, followOf: item.followOf, rubricSlugs, topics, voice, today, extra })
    : await ask(env, {
        source,
        item,
        known: await knownContent(env, { itemId: item.id, today, table: source.itemsTable, recall: memory, about: item }),
        images: item.showPhotos ? await loadKeptImages(env, item.keptImages) : [],
        topics,
        rubricSlugs,
        voice,
        today,
        force: item.manual,
        later: extra,
        ownPhotos: false,
      });
  if (!answer.ok) {
    await finishSkolaItem(env, source, item.id, { status: "chyba", reason: answer.error });
    return { ok: false, error: answer.error, usage: answer.usage };
  }
  if (answer.decision !== "vytvorit" && answer.decision !== "doplneni") {
    const status = answer.decision === "duplicita" ? "duplicita" : "preskoceno";
    await finishSkolaItem(env, source, item.id, { status, reason: noteReads(answer.reason, answer), duplicateOf: answer.duplicateOf });
    return { ok: true, status, usage: answer.usage };
  }
  if (!answer.article) {
    const reason = "Drběna nevrátila článek. Zkuste Napsat znovu.";
    await finishSkolaItem(env, source, item.id, { status: "chyba", reason });
    return { ok: false, error: reason, usage: answer.usage };
  }
  const draft = draftOf(answer);
  draft.reason = noteReads(draft.reason, answer);
  await saveDraft(env, source, item.id, draft);
  return { ok: true, status: "napsano", usage: answer.usage };
}

async function rubricFor(env, input, draft) {
  const id = Number(input.rubricId);
  if (Number.isInteger(id) && id > 0) {
    const row = await env.DB.prepare("select id, name from rubrics where id = ?").bind(id).first();
    if (row) return { id: Number(row.id), name: String(row.name) };
  }
  const rubrics = await rubricMap(env);
  return rubrics.get(draft.article.rubric) ?? rubrics.get(draft.target?.rubricSlug ?? "") ?? [...rubrics.values()][0] ?? null;
}

const hasFile = (file) => file instanceof File && file.size > 0;

// Fotka ke zprávě podle okna: nahraná, vybraná z knihovny, jedna z vložených, z knihovny podle tématu, nebo žádná.
export async function chosenImage(env, source, item, input) {
  const caption = photoCaption(clip(input.photoCaption, 200), source, item.section);
  if (hasFile(input.image) || input.stockId) {
    const picked = await formImage(env, { image: input.image, stockId: input.stockId });
    if (picked.error) return { error: picked.error };
    if (hasFile(input.image)) return { key: picked.key, focus: "", caption };
    return { key: picked.key, focus: picked.photo.imageFocus ?? "", caption: picked.photo.imageCaption ?? "" };
  }
  const choice = String(input.photoChoice ?? "");
  if (choice.startsWith("vlozena:")) {
    const key = choice.slice("vlozena:".length);
    if (!item.keptImages.includes(key)) return { error: "Ta vložená fotka už tu není." };
    return { key, focus: "", caption };
  }
  if (choice === "tema") return pickStockImage(env, item.draft.article.imageTopic);
  return null;
}

// Den a čas naplánovaného zveřejnění, nebo chyba. Musí být v budoucnu.
export function readSchedule(input, now = new Date()) {
  const day = String(input.publishDate ?? "").trim();
  const time = readPublishTime(input.publishTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !time) return { error: "Vyberte den a čas, kdy má zpráva vyjít." };
  const moment = pragueStamp(day, time);
  if (!moment || moment <= sqlStamp(now)) return { error: "Den a čas musí být v budoucnu." };
  return { day, time };
}

export async function publishPasted(env, request, source, input, { now = new Date() } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const item = input.id ? await loadSkolaItem(env, source, input.id) : null;
  if (!item?.draft || item.status !== "napsano") return { ok: false, error: "Ten příspěvek už nečeká na zveřejnění." };
  const action = PUBLISH_ACTIONS.includes(input.pasteAction) ? input.pasteAction : "";
  if (!action) return { ok: false, error: "Nevím, co se zprávou udělat." };
  const schedule = action === "naplanovat" ? readSchedule(input, now) : {};
  if (schedule.error) return { ok: false, error: schedule.error };
  const draft = item.draft;
  const rubric = await rubricFor(env, input, draft);
  if (!rubric) return { ok: false, error: "Na drbně není žádná rubrika." };
  const image = await chosenImage(env, source, item, input);
  if (image?.error) return { ok: false, error: image.error };
  const publish = action !== "upravit";
  const reason = await noteEventChange(env, draft);
  const made = await saveBotArticle(env, {
    article: draft.article,
    image,
    source: skolaSource(item.link, source, item.section),
    autoPublish: publish,
    rubric,
    publishOn: schedule.day ?? "",
    publishTime: schedule.time ?? "",
    followsId: draft.target?.id ?? null,
  });
  if (draft.event || item.eventId) {
    made.eventId = await saveBotEvent(env, draft.event, { existingId: item.eventId, published: publish, articleId: made.articleId, proposalId: made.proposalId });
  }
  await finishSkolaItem(env, source, item.id, { status: "hotovo", reason, duplicateOf: draft.duplicateOf, ...made });
  await env.DB.prepare(`update ${source.itemsTable} set draft = '', previous_draft = '' where id = ?`).bind(item.id).run();
  await releaseKeptImages(env, source, item);
  return { ok: true, action, ...made };
}

// Napsat znovu s poznámkou. U duplicity „nova“ napíše samostatnou zprávu, „navazat“ navazující ke zprávě z duplicity.
// Redakce rozhodla, takže Drběna už nesmí přeskočit (`manual`).
export async function redoPasted(env, request, source, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const item = input.id ? await loadSkolaItem(env, source, input.id) : null;
  if (!item || ["hotovo", "zruseno", "nove"].includes(item.status)) return { ok: false, error: GONE };
  const follow = /^zprava:(\d+)$/.exec(item.duplicateOf);
  const followOf = input.pasteAction === "navazat" && follow ? Number(follow[1]) : input.pasteAction === "nova" ? null : item.followOf;
  await env.DB.prepare(
    `update ${source.itemsTable} set status = 'nove', manual = 1, attempts = 0, redo_note = ?, follow_of = ?,
       previous_draft = case when draft != '' then draft else previous_draft end, draft = '' where id = ?`,
  )
    .bind(clip(input.redoNote, 1000), followOf, item.id)
    .run();
  return { ok: true, id: item.id };
}

// Vrátit předchozí verzi: koncept a předchozí verze se prohodí.
export async function restorePasted(env, request, source, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const item = input.id ? await loadSkolaItem(env, source, input.id) : null;
  if (!item?.previousDraft || item.status !== "napsano") return { ok: false, error: "Předchozí verze tu není." };
  await env.DB.prepare(`update ${source.itemsTable} set draft = previous_draft, previous_draft = draft, reason = ? where id = ?`)
    .bind(clip(item.previousDraft.reason, 400), item.id)
    .run();
  return { ok: true, id: item.id };
}

// Zahodit: nic nevznikne, vložené fotky se smažou. V seznamu zůstane jako zahozený.
export async function discardPasted(env, request, source, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const item = input.id ? await loadSkolaItem(env, source, input.id) : null;
  if (!item || ["hotovo", "zruseno"].includes(item.status)) return { ok: false, error: GONE };
  await env.DB.prepare(`update ${source.itemsTable} set status = 'zruseno', draft = '', previous_draft = '', reason = 'Redakce příspěvek zahodila.' where id = ?`)
    .bind(item.id)
    .run();
  await releaseKeptImages(env, source, item);
  return { ok: true };
}
