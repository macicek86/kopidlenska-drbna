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

export const CLICK_LOCK_SECONDS = 90;
export const CLICK_BUDGET_MS = 8_000;
export const CRON_LOCK_SECONDS = 14 * 60;
export const CRON_BUDGET_MS = 8 * 60_000;
