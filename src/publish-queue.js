// Fronta zveřejnění: zprávy, které importy píšou samy (Munipolis, Deník, školy, web města, fotbal, navazující zprávy),
// nejdou na web najednou, ale s náhodným rozestupem a jen v denní době. Článek se uloží hned, `published_at` dostane
// první volný okamžik (`liveArticle` ho do té doby schová). Volno je okamžik, kolem kterého žádná zpráva
// nevyšla a nevyjde dřív než za `gapMin` minut; když se přisune k jiné, dostane od ní náhodně `gapMin` až `gapMax`.
// Po `to` se přesune na další den od `from`. Co redakce pustí ručně, uzavírky z NDIC a Kam vyrazit (vlastní čas) jdou mimo frontu.
import { pragueStamp, sqlStamp } from "./db-core.js";
import { addDays, pragueNow } from "./waste.js";

const MINUTE = 60_000;

export const SPREAD_DEFAULTS = { on: true, from: "07:00", to: "21:00", gapMin: 40, gapMax: 120 };
export const GAP_BOUNDS = { min: 5, max: 600 };

const stampTime = (stamp) => Date.parse(`${String(stamp).replace(" ", "T")}Z`);

// Okamžik `at` (ms) posunutý do denní doby: před `from` na `from` toho dne, po `to` na `from` dalšího dne.
function inWindow(at, { from, to }) {
  const local = pragueNow(new Date(at));
  if (local.time < from) return stampTime(pragueStamp(local.date, from));
  if (local.time > to) return stampTime(pragueStamp(addDays(local.date, 1), from));
  return at;
}

// Kdy má vyjít další zpráva. `taken` jsou `published_at` zpráv, které vyšly nedávno nebo teprve vyjdou.
// Vrací { day, publishedAt }: pražský den (datum zprávy) a okamžik v UTC.
export function spreadMoment(taken, now, settings, random = Math.random) {
  const { gapMin, gapMax } = settings;
  const gap = () => (gapMin + Math.round(random() * (gapMax - gapMin))) * MINUTE;
  const times = taken.map(stampTime).filter(Number.isFinite).sort((a, b) => a - b);
  let at = inWindow(Math.ceil(now.getTime() / MINUTE) * MINUTE, settings);
  for (const time of times) {
    if (at > time - gapMin * MINUTE && at < time + gapMin * MINUTE) at = inWindow(time + gap(), settings);
  }
  const moment = new Date(at);
  return { day: pragueNow(moment).date, publishedAt: sqlStamp(moment) };
}

export async function queuedMoment(env, settings, now = new Date()) {
  const since = sqlStamp(new Date(now.getTime() - settings.gapMax * MINUTE));
  const rows = await env.DB.prepare("select published_at from articles where published = 1 and published_at >= ? order by published_at")
    .bind(since)
    .all();
  return spreadMoment((rows.results ?? []).map((row) => row.published_at), now, settings);
}
