// Fronta importu po kliknutí: otevřená stránka redakce pošle POST na …/pokracovat a čeká, než Drběna dopíše jednu
// krátkou dávku (public/admin.js, data-continue). Na požadavek, na který prohlížeč čeká, se 30s limit `waitUntil` nevztahuje.
// Práce je navíc i ve `waitUntil`: když redakce mezitím odejde jinam, Cloudflare ji nezruší hned, dá jí ještě 30 s.
import { requireChief } from "./db-core.js";
import { json } from "./http.js";

export async function continueResponse(env, request, ctx, run) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return json({ ok: false, error: gate.error }, 403);
  const work = run();
  ctx?.waitUntil?.(work.catch(() => {}));
  const result = await work;
  return json({ ok: true, idle: Boolean(result.idle), busy: Boolean(result.busy) });
}
