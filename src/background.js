// Práce importů na pozadí: zámek, který sám vyprší, a předání práce Workeru po odpovědi.
// Cloudflare nechá Worker po odpovědi doběhnout asi 30 s, proto se po kliknutí píše jen krátká dávka.

// Zámek nese čas, kdy vyprší. Když Worker uprostřed práce skončí, nezůstane import zamčený dlouho.
export async function lockRow(env, table, seconds) {
  const now = new Date();
  const until = new Date(now.getTime() + seconds * 1000).toISOString();
  const token = `${until}-${crypto.randomUUID()}`;
  const result = await env.DB.prepare(
    `update ${table} set running_at = ? where id = 1 and (running_at is null or running_at = '' or running_at < ?)`,
  )
    .bind(token, now.toISOString())
    .run();
  return Number(result?.meta?.changes ?? 0) > 0 ? token : "";
}

export async function unlockRow(env, table, token) {
  if (!token) return;
  await env.DB.prepare(`update ${table} set running_at = null where id = 1 and running_at = ?`).bind(token).run();
}

export function lockHeld(runningAt, now = new Date()) {
  return Boolean(runningAt) && String(runningAt) > now.toISOString();
}

// Vrací true, když práci převzal Worker na pozadí. Bez kontextu (testy) ji musí volající udělat sám.
export function inBackground(ctx, work) {
  if (!ctx?.waitUntil) return false;
  ctx.waitUntil(work().catch(() => {}));
  return true;
}

// Zpracovává jednu položku za druhou. Další začne jen tehdy, když od začátku neuplynul `budgetMs`.
export async function drain({ next, handle, budgetMs, max, clock = Date.now }) {
  const started = clock();
  const results = [];
  while (results.length < max && (!results.length || clock() - started < budgetMs)) {
    const item = await next();
    if (!item) break;
    results.push(await handle(item));
  }
  return results;
}

// Fronta importu (import_items, football_items). Čekají nové a ty s chybou, které se ještě nevzdaly.
// Ručně vybrané (manual = 1) mají přednost a píšou se s datem ze zdroje.
export function queuedWhere(manualOnly) {
  return `(status = 'nove' or (status = 'chyba' and attempts < ?))${manualOnly ? " and manual = 1" : ""}`;
}

export async function countQueued(env, table, maxAttempts, { manualOnly = false } = {}) {
  const row = await env.DB.prepare(`select count(*) as n from ${table} where ${queuedWhere(manualOnly)}`).bind(maxAttempts).first();
  return Number(row?.n ?? 0);
}

// Redakce vybrala, co zpracovat. Hotové se znovu nepíšou.
export async function markManual(env, table, ids) {
  const clean = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (!clean.length) return 0;
  const marks = clean.map(() => "?").join(", ");
  const result = await env.DB.prepare(
    `update ${table} set manual = 1, status = 'nove', attempts = 0, reason = '' where status != 'hotovo' and id in (${marks})`,
  )
    .bind(...clean)
    .run();
  return Number(result?.meta?.changes ?? 0);
}

// Automatika bere jen čerstvé položky (podle data ve zdroji), ať se po prvním spuštění nebo dlouhé pauze
// drbna nenaplní starými věcmi s dnešním datem. Starší počkají, až je redakce vybere ručně.
export function isFresh(sourceDay, today, days) {
  if (!sourceDay) return true;
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - days);
  return sourceDay >= limit.toISOString().slice(0, 10);
}

export function readFreshDays(value, fallback) {
  const days = Number(String(value ?? "").trim());
  return Number.isInteger(days) && days >= 1 && days <= 60 ? days : fallback;
}

export const STALE_REASON = "Ve zdroji je starší, než kolik dní bere automatika. Zaškrtněte ji, pokud ji chcete zpracovat.";

export const CLICK_LOCK_SECONDS = 90;
export const CLICK_BUDGET_MS = 8_000;
export const CRON_LOCK_SECONDS = 14 * 60;
export const CRON_BUDGET_MS = 8 * 60_000;
