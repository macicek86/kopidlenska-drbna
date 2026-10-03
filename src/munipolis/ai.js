// Claude roztřídí zprávu z Munipolisu, pozná duplicitu a přepíše ji hlasem kozy Drběny.
import { callClaude, MODEL } from "../claude.js";
import { prepareArticleBody } from "../rich.js";
import { isoDate, clockTime, parseNoticeInput } from "../notices.js";
import { DEFAULT_VOICE } from "../drbena.js";
import { HOURS_RULES, hoursContext, hoursSchema, readHours } from "./hours.js";
import { topicsText } from "../stock.js";

export { MODEL, DEFAULT_VOICE };
const MAX_IMAGE_BYTES = 3_700_000;

// Obrázek u článku: vlastní fotka jen když stojí za to, jinak ilustrační z knihovny obrázků.
const IMAGE_RULES = `- image_use: "vlastni" jen tehdy, když je přiložená skutečná fotka, která je sama o sobě pěkná nebo zajímavá (lidé, místo, akce, příroda) a nese málo textu. Plakát, leták, pozvánka, vyhláška, tabulka, mapa nebo logo jsou "knihovna", i když jsou barevné. Když nic přiložené není, taky "knihovna".
- image_topic: téma z knihovny obrázků, které ke zprávě nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné.
- image_caption: krátký popisek vlastní fotky, nebo prázdný text. U "knihovna" vždy prázdný.`;

const RULES = `Dostaneš jednu zprávu z městského Munipolisu Kopidlna a přehled toho, co už na webu Kopidlenská drbna je.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy. Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když nová zpráva přináší podstatnou změnu (jiný termín, zrušení, nové místo), není to duplicita: zvol "vytvorit" a změnu zmiň v reason.
- "preskocit": zpráva nemá pro čtenáře drbny smysl, nebo jde o odstávku elektřiny (tu drbna bere automaticky od ČEZ).
- "vytvorit": všechno ostatní.

Co vytvořit:
- Odstávka vody: notice s kind "voda". Každou ulici nebo část obce dej do places zvlášť. Článek jen tehdy, když zpráva říká víc než samotnou odstávku.
- Uzavírka silnice nebo objížďka: notice s kind "uzavirka" a k tomu článek v praktické rubrice.
- Pozvánka na akci s datem: event a k tomu krátký článek s pozvánkou.
- Zavření nebo jiná otevírací doba: hours, viz níže.
- Cokoli jiného: článek.

${HOURS_RULES}

Pravidla:
- Data, časy, místa, jména, ceny a telefony opiš přesně podle zdroje. Nic nevymýšlej. Když údaj chybí, nech pole prázdné. Rok doplň podle data zveřejnění zprávy.
- Je-li přiložený plakát nebo fotka, vytáhni z něj údaje, které v textu chybí.
${IMAGE_RULES}
- title: do 90 znaků, bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: dva až pět krátkých odstavců. Smíš použít jen <p>, <strong>, <em>, <ul>, <li> a <h3>. Odkaz na zdroj nepiš, drbna ho doplní sama.
- event.description: prostý text, jedna až tři věty.
- Datum piš jako RRRR-MM-DD a čas jako HH:MM.
- U části, kterou nevytváříš, dej include false a ostatní pole nech prázdná.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const FORCE = "Redakce chce tuhle zprávu zpracovat, i když jsi ji předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

function stringField() {
  return { type: "string" };
}

// `hours` přidá pole s otevírací dobou (jen Munipolis, Deník ho nemá). `topics` jsou značky témat knihovny obrázků,
// `ownImage` dovolí vybrat vlastní fotku (Deník fotky nedává, tam je obrázek vždy z knihovny).
export function outputSchema(rubricSlugs, { hours = false, topics = [], ownImage = true } = {}) {
  const slugs = rubricSlugs.length ? rubricSlugs : ["zpravy"];
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reason", "duplicate_of", "article", "event", "notice"],
    properties: {
      decision: { type: "string", enum: ["vytvorit", "preskocit", "duplicita"] },
      reason: stringField(),
      duplicate_of: stringField(),
      article: {
        type: "object",
        additionalProperties: false,
        required: ["include", "title", "excerpt", "body_html", "rubric", "image_caption", "image_topic"],
        properties: {
          include: { type: "boolean" },
          title: stringField(),
          excerpt: stringField(),
          body_html: stringField(),
          rubric: { type: "string", enum: slugs },
          image_caption: stringField(),
          image_topic: { type: "string", enum: [...new Set([...topics, ""])] },
        },
      },
      event: {
        type: "object",
        additionalProperties: false,
        required: ["include", "title", "place", "date", "time", "description"],
        properties: {
          include: { type: "boolean" },
          title: stringField(),
          place: stringField(),
          date: stringField(),
          time: stringField(),
          description: stringField(),
        },
      },
      notice: {
        type: "object",
        additionalProperties: false,
        required: ["include", "kind", "title", "starts_on", "starts_time", "ends_on", "ends_time", "places", "note"],
        properties: {
          include: { type: "boolean" },
          kind: { type: "string", enum: ["voda", "uzavirka"] },
          title: stringField(),
          starts_on: stringField(),
          starts_time: stringField(),
          ends_on: stringField(),
          ends_time: stringField(),
          places: { type: "array", items: stringField() },
          note: stringField(),
        },
      },
    },
  };
  if (ownImage) {
    schema.properties.article.required.push("image_use");
    schema.properties.article.properties.image_use = { type: "string", enum: ["vlastni", "knihovna"] };
  }
  if (hours) {
    schema.required.push("hours");
    schema.properties.hours = hoursSchema();
  }
  return schema;
}

export function systemPrompt(voice) {
  const style = String(voice ?? "").trim() || DEFAULT_VOICE;
  return `${RULES}\n\nHlas a styl textů:\n${style}`;
}

function line(value, max = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Přehled toho, co už na drbně je. Značky v hranatých závorkách vrací Claude v duplicate_of.
export function contextText(known) {
  const parts = [];
  const add = (heading, rows) => parts.push(`${heading}:\n${rows.length ? rows.join("\n") : "(nic)"}`);
  add(
    "Zprávy na webu za poslední týdny",
    (known.articles ?? []).map((row) => `[zprava:${row.id}] ${row.createdOn} · ${line(row.title, 140)} · ${line(row.excerpt)}`),
  );
  add(
    "Návrhy, které čekají na schválení",
    (known.proposals ?? []).map((row) => `[navrh:${row.id}] ${row.createdOn} · ${line(row.title, 140)} · ${line(row.excerpt)}`),
  );
  add(
    "Akce v kalendáři",
    (known.events ?? []).map(
      (row) => `[akce:${row.id}] ${row.startsOn}${row.startsTime ? ` ${row.startsTime}` : ""} · ${line(row.title, 140)} · ${line(row.place, 80)}`,
    ),
  );
  add(
    "Odstávky vody a uzavírky",
    (known.notices ?? []).map(
      (row) => `[odstavka:${row.id}] ${row.kind} ${row.startsOn}${row.startsTime ? ` ${row.startsTime}` : ""} · ${line(row.title, 100)} · ${line(row.places.join(", "))}`,
    ),
  );
  add(
    "Uzavírky silnic z Dopravního info (NDIC), už na webu",
    (known.closures ?? []).map(({ ref, articleId, proposalId, notice }) => {
      const written = [articleId && `zprava:${articleId}`, proposalId && `navrh:${proposalId}`].filter(Boolean).join(", ");
      return `[ndic:${ref}] ${notice.startsOn}${notice.endsOn ? ` až ${notice.endsOn}` : notice.openEnded ? " do odvolání" : ""} · ${line(notice.title, 100)} · ${line(notice.places.join(", "))}${written ? ` · článek ${written}` : ""}`;
    }),
  );
  add(
    "Dřívější převzaté zprávy (Munipolis, Deník, škola)",
    (known.imports ?? []).map((row) => `[${row.tag ?? "munipolis"}:${row.id}] ${row.publishedOn} · ${line(row.title, 140)} · ${row.outcome}`),
  );
  parts.push(hoursContext(known));
  return parts.join("\n\n");
}

export function userText(item, known, { today, force = false, topics = [], images = 0 }) {
  return [
    `Dnes je ${today}.`,
    contextText(known),
    topicsText(topics),
    `Nová zpráva z Munipolisu (zveřejněno ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    `Text:\n${item.text || "(bez textu, údaje jsou možná jen na obrázku)"}`,
    images ? `Přiložené obrázky: ${images}.` : "Bez přiloženého obrázku.",
    force ? FORCE : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const REF = /^(zprava|navrh|akce|odstavka|ndic|munipolis|denik|skola|misto|lekar):\d+$/;

// Článek z odpovědi Claude, nebo null, když ho nechtěl napsat nebo v něm něco chybí. Sdílí ho i Deník a NDIC.
export function readArticle(raw, rubricSlugs) {
  if (!raw?.include) return null;
  const prepared = prepareArticleBody(String(raw.body_html ?? "").slice(0, 20000));
  const title = clean(raw.title, 160);
  const excerpt = clean(raw.excerpt, 320);
  const rubric = rubricSlugs.includes(raw.rubric) ? raw.rubric : "";
  if (title.length < 3 || excerpt.length < 3 || prepared.text.length < 3 || !rubric) return null;
  const imageUse = raw.image_use === "vlastni" ? "vlastni" : "knihovna";
  return {
    title,
    excerpt,
    body: prepared.html,
    rubric,
    imageUse,
    imageTopic: clean(raw.image_topic, 60),
    imageCaption: imageUse === "vlastni" ? clean(raw.image_caption, 200) : "",
  };
}

// Ověří, co Claude vrátil, a převede to na tvar, který umí uložit drbna. Když něco nesedí, vrátí chybu.
export function readDecision(raw, { rubricSlugs, force = false }) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Claude nevrátil rozhodnutí." };
  let decision = ["vytvorit", "preskocit", "duplicita"].includes(raw.decision) ? raw.decision : "";
  if (!decision) return { ok: false, error: "Claude nevrátil rozhodnutí." };
  if (force) decision = "vytvorit";
  const reason = clean(raw.reason, 400);
  const duplicateOf = REF.test(String(raw.duplicate_of ?? "").trim()) ? String(raw.duplicate_of).trim() : "";
  if (decision !== "vytvorit") return { ok: true, decision, reason, duplicateOf, article: null, event: null, notice: null, hours: [] };

  let article = readArticle(raw.article, rubricSlugs);

  let event = null;
  if (raw.event?.include) {
    const date = isoDate(raw.event.date);
    const title = clean(raw.event.title, 160);
    const place = clean(raw.event.place, 160);
    if (date && title.length >= 3 && place.length >= 2) {
      event = { title, place, startsOn: date, startsTime: clockTime(raw.event.time), description: clean(raw.event.description, 4000) };
    }
  }

  let notice = null;
  if (raw.notice?.include) {
    const parsed = parseNoticeInput({
      kind: raw.notice.kind,
      title: raw.notice.title,
      startsOn: raw.notice.starts_on,
      startsTime: raw.notice.starts_time,
      endsOn: raw.notice.ends_on,
      endsTime: raw.notice.ends_time,
      places: raw.notice.places,
      note: raw.notice.note,
    });
    if (parsed.ok) notice = parsed.notice;
  }

  const hours = readHours(raw.hours);
  // Zavření a dočasná změna se jen propíšou, článek o nich redakce nechce. Článek zůstane u trvalé změny nebo u další novinky.
  if (hours.length && !hours.some((change) => change.kind === "trvala") && !event && !notice) article = null;

  if (!article && !event && !notice && !hours.length) {
    return { ok: false, error: "Claude chtěl zprávu zpracovat, ale nevrátil nic, co by šlo uložit." };
  }
  return { ok: true, decision, reason, duplicateOf: "", article, event, notice, hours };
}

export function base64(bytes) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

// API bere obrázek do 5 MB v base64. Větší obrázek Claude neuvidí, a tak ho ani nemůže vybrat jako vlastní fotku.
export function visibleImages(images) {
  return images.filter((image) => image.bytes.byteLength <= MAX_IMAGE_BYTES);
}

// Jedno volání Claude. `images` jsou už stažené obrázky ({ bytes, type }), `topics` témata knihovny obrázků.
export async function askClaude(env, { item, known, images = [], topics = [], rubricSlugs, voice, today, force = false }) {
  const shown = visibleImages(images);
  const content = [
    ...shown.map((image) => ({ type: "image", source: { type: "base64", media_type: image.type, data: base64(image.bytes) } })),
    { type: "text", text: userText(item, known, { today, force, topics, images: shown.length }) },
  ];
  const schema = outputSchema(rubricSlugs, { hours: true, topics: topics.map((topic) => topic.slug) });
  const answer = await callClaude(env, { system: systemPrompt(voice), content, schema });
  if (!answer.ok) return answer;
  return readDecision(answer.raw, { rubricSlugs, force });
}
