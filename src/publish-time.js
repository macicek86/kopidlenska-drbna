// Čas zveřejnění článků, které cron píše v noci: článek se uloží hned, na web ale jde až v nastavenou hodinu
// (`articles.published_at` v budoucnu, `liveArticle` ho do té doby schová). Teď ho má Kam vyrazit (src/okoli/),
// další import ho dostane takhle:
// - sloupec `publish_time` v tabulce nastavení: `addColumn(env, names, "publish_time", publishTimeColumn("…_settings"))`,
// - ve formuláři redakce `publishTimeField(settings.publishTime)` (src/admin/publish-time.js), při uložení `readPublishTime`,
// - `saveBotArticle(env, { …, publishTime })` (jen u automatiky; co redakce spustí ručně, jde ven hned),
// - do poznámky o výsledku `publishNote(made.publishedAt)`.
import { pragueNow } from "./waste.js";
import { publishMoment, pragueStamp, sqlStamp } from "./db-core.js";

export const DEFAULT_PUBLISH_TIME = "07:00";

export const publishTimeColumn = (table) => `alter table ${table} add column publish_time text not null default '${DEFAULT_PUBLISH_TIME}'`;

// „7“, „7:00“, „07:00“ → „07:00“; prázdné nebo nesmysl → "" (zveřejnit hned).
export function readPublishTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!match) return "";
  const [hours, minutes] = [Number(match[1]), Number(match[2] ?? 0)];
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Kdy zpráva s datem `day` půjde na web: v čas `time` toho dne, a když už minul (nebo čas není), jako dosud.
export function scheduledMoment(day, time, now = new Date()) {
  const moment = time ? pragueStamp(day, time) : "";
  return moment && moment > sqlStamp(now) ? moment : publishMoment(day, now);
}

// Pražský čas „7:00“, když `published_at` ještě nenastal, jinak "".
export function pendingTime(publishedAt, now = new Date()) {
  if (!publishedAt || publishedAt <= sqlStamp(now)) return "";
  return pragueNow(new Date(`${publishedAt.replace(" ", "T")}Z`)).time.replace(/^0/, "");
}

// Věta do poznámky importu: „vyšel“, nebo „vyjde v 7:00“.
export function publishNote(publishedAt, now = new Date()) {
  const time = pendingTime(publishedAt, now);
  return time ? `vyjde v ${time}` : "vyšel";
}
