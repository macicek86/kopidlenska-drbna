// Chat s Drběnou: veřejné adresy. POST /chat/zacit (Turnstile → lístek) a POST /chat/zeptat (otázka → odpověď).
import { facebookUrl } from "../copy.js";
import { loadCopy, loadPublic } from "../db.js";
import { loadDrbena } from "../drbena-db.js";
import { formatLong } from "../format.js";
import { messagePage } from "../messages-db.js";
import { isBot } from "../visits.js";
import { dayVisitor } from "../visits-db.js";
import { pragueNow } from "../waste.js";
import { askDrbena, usageCost } from "./ai.js";
import { loadArchive } from "./archive.js";
import { RECENT_ARTICLES, runChatTool, siteOverview } from "./context.js";
import { issuePass, readPass, turnstileConfig, verifyTurnstile } from "./pass.js";
import { chatInstructions } from "./prompt.js";
import { chatLimit, countQuestion, countStop, loadChatSettings, recordAnswer } from "./store.js";

export const QUESTION_MAX = 500;
const HISTORY_ITEMS = 8;
const HISTORY_TEXT_MAX = 1500;
const BODY_MAX = 20_000;

export const CHAT_SAYS = {
  off: "Drběna teď v chatu není. Zkuste to později.",
  restart: "Rozhovor vypršel, začínám znovu.",
  robot: "Nepodařilo se ověřit, že nejste robot. Zkuste to znovu.",
  empty: "Napište otázku.",
  den: "Dneska už jsem toho napovídala tolik, že mám pusu unavenou. Zeptejte se zítra.",
  mesic: "Na tenhle měsíc už mám vyčerpáno. Zase příští měsíc.",
  ty: "Dnes už jste se zeptali na hodně. Další otázky zase zítra.",
  refusal: "Na tohle vám neodpovím. Zeptejte se mě na něco z Kopidlna.",
  busy: "Teď se mě ptá moc lidí najednou. Zkuste to za chvilku.",
  broken: "Něco se mi zamotalo do rohů a odpověď se nepovedla. Zkuste to prosím znovu.",
};

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readJson(request) {
  if (!String(request.headers.get("content-type") ?? "").startsWith("application/json")) return null;
  const text = await request.text();
  if (text.length > BODY_MAX) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function clean(value, max) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

// Předchozí rozhovor z prohlížeče: posledních pár zpráv, oříznutých, a vždy začíná otázkou.
export function readHistory(value) {
  const items = (Array.isArray(value) ? value : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .map((item) => ({ role: item.role, text: clean(item.text, HISTORY_TEXT_MAX) }))
    .filter((item) => item.text)
    .slice(-HISTORY_ITEMS);
  while (items.length && items[0].role !== "user") items.shift();
  return items;
}

async function chatSystem(env, request) {
  const origin = new URL(request.url).origin;
  const [data, copy, drbena, settings] = await Promise.all([loadPublic(env), loadCopy(env), loadDrbena(env), loadChatSettings(env)]);
  const ctx = { path: "/", mainOrigin: origin, origin, copy };
  const archive = await loadArchive(env, { skip: RECENT_ARTICLES, limit: settings.archive });
  const now = pragueNow();
  return [
    { type: "text", text: chatInstructions(drbena, settings.persona, facebookUrl(copy)) },
    { type: "text", text: `<prehled_drbny>\n${siteOverview(data, ctx, { ads: settings.ads, archive })}\n</prehled_drbny>`, cache_control: { type: "ephemeral" } },
    { type: "text", text: `<ted>${formatLong(now.date)} ${now.date.slice(0, 4)}, ${now.time} (${now.date})</ted>\nPodle toho víš, co už skončilo a co teprve bude.` },
  ];
}

export async function chatPost(path, request, env, execution) {
  if (path !== "/chat/zacit" && path !== "/chat/zeptat") return null;
  const settings = await loadChatSettings(env);
  if (!settings.enabled) return reply({ error: CHAT_SAYS.off }, 403);
  const body = await readJson(request);
  if (!body) return reply({ error: CHAT_SAYS.empty }, 400);
  if (isBot(request.headers.get("user-agent"))) return reply({ error: CHAT_SAYS.robot }, 403);
  const day = pragueNow().date;

  if (path === "/chat/zacit") {
    const turnstile = turnstileConfig(env);
    if (turnstile && !(await verifyTurnstile(turnstile, body.token, request.headers.get("cf-connecting-ip")))) {
      await countStop(env, day, "blocked");
      return reply({ error: CHAT_SAYS.robot }, 403);
    }
    return reply({ pass: await issuePass(settings.secret) });
  }

  const conversation = await readPass(settings.secret, body.pass);
  if (!conversation) return reply({ error: CHAT_SAYS.restart, restart: true }, 401);
  const question = clean(body.question, QUESTION_MAX);
  if (!question) return reply({ error: CHAT_SAYS.empty }, 400);
  const who = { day, visitor: await dayVisitor(env, request, day), conversation };
  const limit = await chatLimit(env, settings, who);
  if (limit) {
    await countStop(env, day, "limited");
    return reply({ error: CHAT_SAYS[limit], limit }, 429);
  }
  const left = await countQuestion(env, settings, who);
  const history = [...readHistory(body.history), { role: "user", text: question }];
  // Vzkazy redakci potřebují vědět, kdo píše a z jaké stránky.
  // E-mail o vzkazu odchází na pozadí, ať Drběna s odpovědí nečeká.
  const writer = {
    ...who,
    page: messagePage(body.page),
    log: [],
    defer: execution?.waitUntil ? (promise) => execution.waitUntil(promise) : null,
  };
  const result = await askDrbena(
    env,
    { modelKey: settings.model, system: await chatSystem(env, request), history },
    { runTool: (toolEnv, name, input) => runChatTool(toolEnv, name, input, writer) },
  );
  const cost = usageCost(result.usage, settings.model);
  const answer = result.ok ? result.text : CHAT_SAYS[result.error] ?? CHAT_SAYS.broken;
  const saving = recordAnswer(env, settings, {
    day,
    conversation,
    question,
    answer: result.ok ? result.text : `(chyba: ${result.error})`,
    ok: result.ok,
    usage: result.usage,
    cost,
    lookups: writer.log,
  }).catch(() => {});
  if (execution?.waitUntil) execution.waitUntil(saving);
  else await saving;
  if (!result.ok) return reply({ error: answer }, 502);
  return reply({ answer, left });
}
