// Příjem akcí ze zdroje, který Cloudflare nepustí (kzmj.cz vrací Workerům 500). Stahuje ho úloha na GitHubu
// (.github/workflows/okoli-relay.yml, scripts/okoli-relay.mjs) stejnou čtečkou a posílá sem:
// GET  /okoli/prijem?zdroj=kzmj  → { known: { guid: stamp } }, ať úloha stahuje jen nové a změněné stránky,
// POST /okoli/prijem?zdroj=kzmj  ← { items, listed, complete, warning } jako fetchEvents.
// Přihlášení tajemstvím OKOLI_RELAY_TOKEN (Bearer); bez něj adresa vrací 503.
import { NEARBY_SOURCES } from "./sources.js";
import { knownStamps, rememberNearby } from "./store.js";
import { noteNearby } from "./run.js";

export const RELAY_PATH = "/okoli/prijem";
const MAX_BODY = 3_000_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{2}:\d{2})?$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sameText(a, b) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

const relaySource = (tag) => NEARBY_SOURCES.find((source) => source.relay && source.tag === tag) ?? null;

function hostOf(link) {
  try {
    const url = new URL(String(link ?? ""));
    return url.protocol === "https:" ? url.hostname : "";
  } catch {
    return "";
  }
}

// Co úloha poslala, bere drbna jen ve tvaru, jaký dává čtečka zdroje; ostatní zahodí.
export function readRelayFeed(body, source) {
  const prefix = `${source.tag}:`;
  const own = (guid) => typeof guid === "string" && guid.startsWith(prefix) && guid.length <= 200;
  const items = [];
  for (const item of Array.isArray(body?.items) ? body.items.slice(0, 1000) : []) {
    if (!own(item?.guid)) continue;
    const stamp = String(item.stamp ?? "").slice(0, 60);
    if (item.unchanged) {
      items.push({ guid: item.guid, stamp, unchanged: true });
      continue;
    }
    const host = hostOf(item.link);
    if (!source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) continue;
    if (!DAY.test(String(item.startsOn ?? "")) || !String(item.title ?? "").trim()) continue;
    items.push({
      guid: item.guid,
      stamp,
      link: String(item.link),
      title: String(item.title),
      kind: ["divadlo", "kino", "akce"].includes(item.kind) ? item.kind : "akce",
      startsOn: item.startsOn,
      endsOn: DAY.test(String(item.endsOn ?? "")) ? item.endsOn : "",
      startsTime: CLOCK.test(String(item.startsTime ?? "")) ? String(item.startsTime ?? "") : "",
      endsTime: CLOCK.test(String(item.endsTime ?? "")) ? String(item.endsTime ?? "") : "",
      place: String(item.place ?? ""),
      description: String(item.description ?? ""),
      soldOut: Boolean(item.soldOut),
    });
  }
  const listed = Array.isArray(body?.listed) ? body.listed.filter(own).slice(0, 5000) : [];
  return { ok: true, items, listed, complete: Boolean(body?.complete) && listed.length > 0, warning: String(body?.warning ?? "").slice(0, 200) };
}

export async function okoliRelay(request, env) {
  const token = String(env.OKOLI_RELAY_TOKEN ?? "");
  if (!token) return json({ error: "Příjem není nastavený." }, 503);
  const header = request.headers.get("authorization") ?? "";
  if (!sameText(header, `Bearer ${token}`)) return json({ error: "Špatný klíč." }, 401);
  const source = relaySource(new URL(request.url).searchParams.get("zdroj") ?? "");
  if (!source) return json({ error: "Takový zdroj tu není." }, 404);
  const known = await knownStamps(env, source);
  if (request.method === "GET") return json({ known: Object.fromEntries(known) });
  if (request.method !== "POST") return json({ error: "Metoda není povolená." }, 405);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: "Moc velká zpráva." }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Zpráva není JSON." }, 400);
  }
  const feed = readRelayFeed(body, source);
  await noteNearby(env, source, feed);
  const saved = await rememberNearby(env, source, feed, known);
  return json({ ok: true, ...saved });
}
