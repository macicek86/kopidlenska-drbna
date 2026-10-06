// Akce z okolí: stažení programů ze zdrojů a víkendový článek. Cron, tlačítka v redakci.
import { CLICK_LOCK_SECONDS, CRON_LOCK_SECONDS } from "../background.js";
import { requireChief } from "../db-core.js";
import { pragueNow } from "../waste.js";
import { NEARBY_SOURCES } from "./sources.js";
import { knownStamps, loadOkoliSettings, lockOkoli, pruneNearby, rememberNearby, saveWeekendResult, unlockOkoli, writeOkoliStatus } from "./store.js";
import { outingDue, outingFor } from "./outings.js";
import { writeWeekend } from "./weekend.js";

const BUSY = "Drběna už s akcemi z okolí pracuje. Zkuste to za chvíli.";

// Projde všechny zdroje. Zdroj, který nejde, ostatní nezastaví.
export async function collectNearby(env, { fetchImpl = fetch } = {}) {
  let added = 0;
  let removed = 0;
  const problems = [];
  for (const source of NEARBY_SOURCES) {
    // Zdroj přes GitHub (src/okoli/relay.js) Worker sám nestahuje.
    if (source.relay) continue;
    const known = await knownStamps(env, source);
    const feed = await source.fetchEvents({ env, fetchImpl, known });
    if (!feed.ok) {
      problems.push(`${source.name}: ${feed.error}`);
      continue;
    }
    if (feed.warning) problems.push(`${source.name}: ${feed.warning}`);
    const saved = await rememberNearby(env, source, feed, known);
    added += saved.added;
    removed += saved.removed;
  }
  await pruneNearby(env, pragueNow().date);
  const found = added ? `Nových akcí: ${added}.` : "Nic nového.";
  const gone = removed ? ` Zrušených: ${removed}.` : "";
  const note = `${found}${gone}${problems.length ? ` Nejde: ${problems.join(" ")}` : ""}`;
  const status = problems.length === NEARBY_SOURCES.filter((source) => !source.relay).length ? "error" : problems.length ? "partial" : "ok";
  await writeOkoliStatus(env, { status, note });
  return { ok: status !== "error", added, note };
}

async function finishWeekend(env, weekend, result) {
  if (!result.ok) {
    await writeOkoliStatus(env, { status: "error", note: `Víkendový článek: ${result.error}` });
    return result;
  }
  await saveWeekendResult(env, { key: weekend.key, note: result.note, articleId: result.articleId, proposalId: result.proposalId });
  return result;
}

// Cron každé čtyři hodiny: se zapnutým stahováním načte programy a v den, kdy na to přijde řada (pátek, den před
// volnem nebo svátkem, src/okoli/outings.js), napíše článek Kam vyrazit.
export async function runOkoli(env, { fetchImpl = fetch, ask, now = pragueNow() } = {}) {
  const settings = await loadOkoliSettings(env);
  const weekend = outingDue(settings, now);
  if (!settings.enabled && !weekend) return { ok: true, skipped: true };
  const lock = await lockOkoli(env, CRON_LOCK_SECONDS);
  if (!lock) return { ok: true, skipped: true };
  try {
    if (settings.enabled) await collectNearby(env, { fetchImpl });
    if (weekend) await finishWeekend(env, weekend, await writeWeekend(env, settings, weekend, { ask }));
    return { ok: true };
  } finally {
    await unlockOkoli(env, lock);
  }
}

// Tlačítko „Načíst akce teď“.
export async function checkOkoliNow(env, request, { fetchImpl = fetch } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const lock = await lockOkoli(env, CLICK_LOCK_SECONDS);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const result = await collectNearby(env, { fetchImpl });
    return result.ok ? result : { ok: false, error: result.note };
  } finally {
    await unlockOkoli(env, lock);
  }
}

// Tlačítko „Napsat článek teď“: na nejbližší víkend, i když už článek je. Píše se hned (Drběna potřebuje asi minutu).
export async function writeOkoliNow(env, request, { ask } = {}) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const lock = await lockOkoli(env, 5 * 60);
  if (!lock) return { ok: false, error: BUSY };
  try {
    const settings = await loadOkoliSettings(env);
    const weekend = outingFor(pragueNow().date);
    return await finishWeekend(env, weekend, await writeWeekend(env, settings, weekend, { ask }));
  } finally {
    await unlockOkoli(env, lock);
  }
}
