// Vložený příspěvek: redakce zkopíruje text (a fotky) třeba z Facebooku města, kam se drbna sama nedostane.
// Položka jde do fronty zdroje s `pasted` (`sources.js`) a Drběna z ní napíše koncept (`paste-run.js`).
// Fotky čekají v R2 v `kept_images` (`defer.js`); Claude je vidí jen se `show_photos`, ke zprávě je vybírá redakce.
import { readSource } from "../article-source.js";
import { clip, requireChief } from "../db-core.js";
import { releaseImage, shrinkImage, storeImageBytes } from "../images.js";
import { pragueNow } from "../waste.js";

export const MAX_PASTED_PHOTOS = 4;
export const MAX_PASTED_TEXT = 10_000;
const FROM_MAX = 80;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_STORED_BYTES = 4 * 1024 * 1024;

// Odkud příspěvek je (`section`), bez vyplnění výchozí zdroj.
export const pastedFrom = (source, section) => String(section ?? "").trim() || source.defaultFrom;

// Nadpis do seznamu v redakci: první řádek textu, ořezaný na celé slovo. Na web jde nadpis od Drběny.
export function pastedTitle(text) {
  const line = String(text ?? "")
    .split("\n")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(Boolean);
  if (!line) return "Příspěvek s obrázkem";
  if (line.length <= 90) return line;
  const cut = line.slice(0, 90);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 90)}…`;
}

// Den zveřejnění z formuláře (RRRR-MM-DD). Prázdný je dnešek, budoucí neplatí.
export function readPostDate(value, today) {
  const day = String(value ?? "").trim();
  if (!day) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) || day > today) return "";
  return day;
}

async function storePhotos(env, files) {
  const keys = [];
  const fail = async (error) => {
    for (const key of keys) await releaseImage(env, key);
    return { error };
  };
  for (const [index, file] of files.entries()) {
    const name = file.name || `${index + 1}`;
    if (!PHOTO_TYPES.includes(file.type)) return fail(`Fotka ${name} musí být JPG, PNG, WEBP nebo GIF.`);
    if (file.size > MAX_PHOTO_BYTES) return fail(`Fotka ${name} je moc velká.`);
    const image = await shrinkImage(env, { bytes: await file.arrayBuffer(), type: file.type });
    if (image.bytes.byteLength > MAX_STORED_BYTES) return fail(`Fotka ${name} má i po zmenšení přes 4 MB.`);
    keys.push(await storeImageBytes(env, image));
  }
  return { keys };
}

export async function pasteSkolaItem(env, request, source, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  return savePastedItem(env, source, input);
}

export async function savePastedItem(env, source, input, { today = pragueNow().date } = {}) {
  const text = String(input.postText ?? "").replace(/\r\n?/g, "\n").trim();
  const files = (input.images ?? []).filter((file) => file instanceof File && file.size > 0);
  if (!text && !files.length) return { ok: false, error: "Vložte text příspěvku nebo aspoň fotku." };
  if (text.length > MAX_PASTED_TEXT) return { ok: false, error: "Text je moc dlouhý. Vložte jen jeden příspěvek." };
  if (files.length > MAX_PASTED_PHOTOS) return { ok: false, error: `Fotky můžou být nejvýš ${MAX_PASTED_PHOTOS}.` };
  const link = String(input.postLink ?? "").trim();
  if (link && !/^https:\/\/\S+$/i.test(link)) return { ok: false, error: "Odkaz musí začínat https://." };
  const day = readPostDate(input.postDate, today);
  if (!day) return { ok: false, error: "Den zveřejnění nesedí. Nesmí být v budoucnu." };
  const photos = await storePhotos(env, files);
  if (photos.error) return { ok: false, error: photos.error };
  // S dnešním dnem čas vložení, jinak poledne toho dne (importSourceDate z něj vezme den v Praze).
  const publishedAt = day === today ? new Date().toISOString() : `${day}T10:00:00Z`;
  const from = clip(readSource(input.postFrom), FROM_MAX) || source.defaultFrom;
  const result = await env.DB.prepare(
    `insert into ${source.itemsTable} (guid, link, title, text, section, published_at, status, kept_images, show_photos) values (?, ?, ?, ?, ?, ?, 'nove', ?, ?)`,
  )
    .bind(`vlozeno:${crypto.randomUUID()}`, link, pastedTitle(text), text, from, publishedAt, JSON.stringify(photos.keys), input.showPhotos && photos.keys.length ? 1 : 0)
    .run();
  return { ok: true, id: Number(result?.meta?.last_row_id ?? 0) };
}

// Odkud byl poslední vložený příspěvek: formulář ho nabídne znovu.
export function lastPastedFrom(source, entries) {
  return entries.find((entry) => entry.section)?.section || source.defaultFrom;
}
