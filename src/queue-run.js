// Příjem zpráv z fronty úloh (handler `queue` v src/index.js). Typy úloh jsou v `HANDLERS`: nový typ
// = nový řádek. Úloha musí být idempotentní, Cloudflare může zprávu doručit víckrát.
import { applyPending } from "./mailin/pending.js";

const HANDLERS = {
  "mailin.apply": (env, body) => applyPending(env, Number(body.id)),
};

export async function handleQueue(batch, env) {
  for (const message of batch.messages) {
    const handler = HANDLERS[message.body?.type];
    if (!handler) {
      message.ack();
      continue;
    }
    try {
      await handler(env, message.body);
      message.ack();
    } catch {
      // Zkusí se znovu za minutu; po vyčerpání pokusů zbude cron.
      message.retry({ delaySeconds: 60 });
    }
  }
}
