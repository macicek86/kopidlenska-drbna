// Web města zve na akce s velkým předstihem (i dva měsíce). Akce jde do kalendáře hned, pozvánku Drběna napíše až
// `ahead_days` dní před ní: položka čeká jako `odlozeno` s dnem `write_on` a ten den ji cron vezme znovu jako čerstvou.
// Do té doby mezitím třeba přijde stejná pozvánka z Munipolisu a Drběna ji pozná jako duplicitu.
// Akce, které podle termínu ve zdroji už proběhly, automatika přeskočí bez Claude. Platí pro zdroje s `defer` (`sources.js`).
import { readFreshDays } from "../background.js";

export const DEFAULT_AHEAD_DAYS = 10;
export const PAST_REASON = "Akce podle termínu na webu už proběhla, pozvánka nemá smysl.";

export const readAheadDays = (value) => readFreshDays(value, DEFAULT_AHEAD_DAYS);

function isoDay(day, month, year) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month) - 1) return "";
  return date.toISOString().slice(0, 10);
}

// Termín z Antee („13. 10. 2026“ nebo „13. 10. 2026 až 14. 10. 2026“) jako { from, to } (RRRR-MM-DD), jinak null.
export function termDays(term) {
  const days = [...String(term ?? "").matchAll(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/g)].map((match) => isoDay(match[1], match[2], match[3]));
  if (!days.length || days.some((day) => !day)) return null;
  return { from: days[0], to: days.at(-1) };
}

export function termOver(term, today) {
  const days = termDays(term);
  return Boolean(days) && days.to < today;
}

export function shiftDay(day, delta) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Den, kdy psát pozvánku na akci `startsOn`, nebo "", když se má psát hned. Odkládá se jen jednou (`writeOn` už je).
export function deferDay(item, startsOn, aheadDays, today) {
  if (item.writeOn || !/^\d{4}-\d{2}-\d{2}$/.test(String(startsOn ?? ""))) return "";
  const day = shiftDay(startsOn, -aheadDays);
  return day > today ? day : "";
}

// Druhé čtení odložené položky: akci Drběna dala do kalendáře sama, za duplicitu ji mít nesmí.
export function laterNote(item) {
  if (!item.writeOn) return "";
  const event = item.eventId ? ` (akce:${item.eventId})` : "";
  return `Akci z tohohle článku jsi dřív dala do kalendáře${event} a pozvánku sis nechala na dnešek. Ta akce sama duplicita není: napiš k ní pozvánku a event dej include false. Duplicita je jen zpráva nebo návrh o téže akci, třeba ze zpráv města v Munipolisu.`;
}

// Cron: odložené položky, kterým nastal den, vrátí do fronty jako automatické (bez vynucení, s dnešním datem).
export async function reopenDeferred(env, source, today) {
  await env.DB.prepare(`update ${source.itemsTable} set status = 'nove', manual = 0, attempts = 0 where status = 'odlozeno' and write_on <= ?`)
    .bind(today)
    .run();
}

export async function deferSkolaItem(env, source, id, { writeOn, eventId, reason }) {
  await env.DB.prepare(
    `update ${source.itemsTable} set status = 'odlozeno', write_on = ?, event_id = ?, reason = ?, duplicate_of = '', article_id = null, proposal_id = null,
       manual = 0, attempts = 0, processed_at = datetime('now') where id = ?`,
  )
    .bind(writeOn, eventId ?? null, String(reason ?? "").slice(0, 400), id)
    .run();
}
