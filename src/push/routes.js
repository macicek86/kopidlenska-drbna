// Adresy upozornění: stránka /upozorneni a JSON pro public/push.js a public/sw.js.
// Odběr pozná podle adresy služby prohlížeče (endpoint), kterou zná jen ten prohlížeč.
import { loadDoctors, loadRubrics, loadYards } from "../db.js";
import { html } from "../http.js";
import { loadPlaces } from "../places-db.js";
import { pragueNow } from "../waste.js";
import { vapidReady } from "./crypto.js";
import { pushPage } from "./page.js";
import { sendOutcome, sendPush } from "./send.js";
import { findSubscription, loadPushSettings, markTested, readSubscription, removeSubscription, renewSubscription, saveSubscription } from "./store.js";

export const PUSH_PAGE = "/upozorneni";
// Zkušební upozornění nejvýš jednou za minutu.
const TEST_GAP_MS = 60_000;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export async function pushPageHtml(env, ctx) {
  const today = pragueNow().date;
  const [settings, rubrics, places, doctors, yards] = await Promise.all([
    loadPushSettings(env),
    loadRubrics(env),
    loadPlaces(env, { publicOnly: true, today }),
    loadDoctors(env, { publicOnly: true, today }),
    loadYards(env, { publicOnly: true, today }),
  ]);
  const lists = {
    rubrics,
    places: places.map((item) => ({ id: item.id, label: item.name })),
    doctors: doctors.map((item) => ({ id: item.id, label: [item.name, item.specialty].filter(Boolean).join(", ") })),
    yards: yards.map((item) => ({ id: item.id, label: item.name })),
  };
  return html(pushPage(ctx, { lists, settings, publicKey: vapidReady(env) ? env.VAPID_PUBLIC_KEY : "" }));
}

export const TEST_MESSAGE = {
  title: "Upozornění fungují",
  body: "Takhle vám drbna dá vědět. Zdraví koza Drběna!",
  url: PUSH_PAGE,
  tag: "zkouska",
};

async function testPush(env, sub, now = new Date()) {
  if (sub.testedAt && now.getTime() - Date.parse(`${sub.testedAt.replace(" ", "T")}Z`) < TEST_GAP_MS) {
    return reply({ ok: false, error: "Zkušební upozornění jde poslat jen jednou za minutu." }, 429);
  }
  await markTested(env, sub.id, now);
  const outcome = sendOutcome(await sendPush(env, sub, TEST_MESSAGE));
  if (outcome === "ok") return reply({ ok: true });
  if (outcome === "gone") {
    await removeSubscription(env, sub.endpoint);
    return reply({ ok: false, gone: true, error: "Prohlížeč upozornění zrušil. Zapněte je prosím znovu." }, 410);
  }
  return reply({ ok: false, error: "Upozornění se teď nepodařilo poslat. Zkuste to za chvíli." }, 502);
}

// POST /upozorneni/… (JSON), jinak null.
export async function pushPost(path, request, env) {
  if (!path.startsWith(`${PUSH_PAGE}/`)) return null;
  if (!vapidReady(env)) return reply({ ok: false, error: "Upozornění teď nejdou." }, 503);
  let input;
  try {
    input = await request.json();
  } catch {
    return reply({ ok: false, error: "Nečitelný požadavek." }, 400);
  }
  if (path === `${PUSH_PAGE}/ulozit`) {
    const sub = readSubscription(input?.subscription);
    if (!sub) return reply({ ok: false, error: "Tenhle prohlížeč upozornění neumí." }, 400);
    const saved = await saveSubscription(env, sub, input?.prefs);
    return reply({ ok: true, prefs: saved.prefs });
  }
  if (path === `${PUSH_PAGE}/obnovit`) {
    const sub = readSubscription(input?.subscription);
    if (!sub) return reply({ ok: false }, 400);
    await renewSubscription(env, String(input?.oldEndpoint ?? ""), sub);
    return reply({ ok: true });
  }
  const found = await findSubscription(env, input?.endpoint);
  if (path === `${PUSH_PAGE}/nacist`) return found ? reply({ ok: true, prefs: found.prefs }) : reply({ ok: false }, 404);
  if (path === `${PUSH_PAGE}/zrusit`) {
    if (found) await removeSubscription(env, found.endpoint);
    return reply({ ok: true });
  }
  if (path === `${PUSH_PAGE}/zkusit`) return found ? testPush(env, found) : reply({ ok: false, error: "Upozornění tu nejsou zapnutá." }, 404);
  return reply({ ok: false }, 404);
}
