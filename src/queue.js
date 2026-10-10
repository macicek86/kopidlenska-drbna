// Fronta úloh (Cloudflare Queues, binding JOBS ve wrangler.toml): práce, která se má stát později nebo
// bez čekání na požadavek. Zpráva je JSON s `type`, zpracování podle typu je v src/queue-run.js.
// Bez bindingu (testy, místní běh bez fronty) `enqueue` nic neudělá a vrací false: každý typ má proto
// jinou cestu, kterou ho dožene cron (u e-mailů na otevírací dobu `applyDue` v src/mailin/pending.js).

// Nejdelší zpoždění, které Cloudflare Queues dovolí.
const MAX_DELAY_SECONDS = 86400;

export function queueReady(env) {
  return typeof env?.JOBS?.send === "function";
}

export async function enqueue(env, message, delaySeconds = 0) {
  if (!queueReady(env)) return false;
  try {
    const options = delaySeconds > 0 ? { delaySeconds: Math.min(Math.round(delaySeconds), MAX_DELAY_SECONDS) } : undefined;
    await env.JOBS.send(message, options);
    return true;
  } catch {
    return false;
  }
}
