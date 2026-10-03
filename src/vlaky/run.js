// Průchod: zeptá se ČD na trať 061 na dnešek a každý z příštích dní, uloží výluky a dočte jejich detail.
// Běží ve vlastním cronu (22 dotazů by jinak ubraly z limitu ostatním importům) a z tlačítka v redakci.
import { requireChief } from "../db-core.js";
import { addDays, pragueNow } from "../waste.js";
import { fetchDay, fetchDetail, fetchTrackId } from "./cd.js";
import { loadTrainSettings, noteScan, rowsWithoutDetail, saveDetail, saveScan, saveTrackId } from "./store.js";

// ČD se ptáme po pár dnech najednou, ne všemi dotazy naráz.
const PARALLEL = 4;
const DETAILS_PER_RUN = 6;

async function scanDays(days, trackId, fetchImpl) {
  const results = [];
  for (let i = 0; i < days.length; i += PARALLEL) {
    results.push(...(await Promise.all(days.slice(i, i + PARALLEL).map((day) => fetchDay(day, trackId, fetchImpl)))));
  }
  return results;
}

function failureNote(failed, total) {
  if (!failed.length) return "";
  if (failed.length === total) return `Přehled výluk se nenačetl: ${failed[0].error}`;
  return `U ${failed.length} z ${total} dní se přehled nenačetl (${failed[0].error}). Výluky z ostatních dní jsou uložené.`;
}

export async function refreshTrains(env, { fetchImpl = fetch, now = new Date() } = {}) {
  const settings = await loadTrainSettings(env);
  if (!settings.enabled) return { ok: true, skipped: true };
  const today = pragueNow(now).date;
  let trackId = settings.trackId;
  // Číslo trati v rozhraní ČD ověřit jednou denně (s novým jízdním řádem se může změnit).
  if (settings.trackCheckedOn !== today) {
    const found = await fetchTrackId(fetchImpl);
    await saveTrackId(env, found, today);
    if (found) trackId = found;
  }
  const days = Array.from({ length: settings.daysAhead + 1 }, (_, i) => addDays(today, i));
  const results = await scanDays(days, trackId, fetchImpl);
  const items = new Map();
  for (const result of results) for (const item of result.items ?? []) items.set(item.id, item);
  const failed = results.filter((result) => !result.ok);
  // Když neodpověděl ani jeden den, nic se nemaže ani nepřepisuje.
  if (failed.length < results.length) await saveScan(env, [...items.values()], { complete: !failed.length, now });
  for (const row of await rowsWithoutDetail(env, DETAILS_PER_RUN)) {
    const detail = await fetchDetail(row.link, fetchImpl);
    if (detail) await saveDetail(env, row, detail);
  }
  const error = failureNote(failed, results.length);
  await noteScan(env, { count: items.size, error });
  return { ok: failed.length < results.length, count: items.size, error };
}

// Tlačítko „Zkontrolovat teď“ v redakci.
export async function refreshTrainsNow(env, request, options = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const settings = await loadTrainSettings(env);
  if (!settings.enabled) return { ok: false, error: "Výluky vlaků jsou vypnuté. Zapněte je v nastavení." };
  const result = await refreshTrains(env, options);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, warn: result.error };
}
