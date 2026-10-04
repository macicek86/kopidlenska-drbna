// Pomocník při psaní: POST /redakce/pomocnik (JSON z formuláře zprávy → nový nadpis, perex, text, rubrika, fotka).
// Nic neukládá. Přispěvatel potřebuje oprávnění a hlídají ho limity, hlavní redaktor smí vždy.
import { requireUser, userCan } from "../db-core.js";
import { loadDrbena } from "../drbena-db.js";
import { voiceFor } from "../drbena.js";
import { prepareArticleBody } from "../rich.js";
import { loadStock } from "../stock-db.js";
import { pragueNow } from "../waste.js";
import { askAssist, ASSIST_MODES, ASSIST_TEXT_MIN } from "./ai.js";
import { ASSIST_PERMISSION, assistLimit, countAssist, loadAssistSettings, recordAssist } from "./store.js";

export const ASSIST_PATH = "/redakce/pomocnik";
const BODY_MAX = 60_000;

export const ASSIST_SAYS = {
  login: "Přihlaste se do redakce.",
  denied: "Na pomocníka při psaní nemáte oprávnění.",
  bad: "Formulář se nepodařilo přečíst. Obnovte stránku.",
  empty: "Napište nejdřív, co víte. Stačí pár vět nebo body.",
  den: "Na dnešek jste pomocníka vyčerpali. Zítra zase.",
  mesic: "Pomocník má na tenhle měsíc vyčerpaný rozpočet. Řekněte hlavnímu redaktorovi.",
};

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
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

function line(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Co poslal formulář. Text je HTML z editoru, projde stejným čištěním jako při uložení.
export function readAssistInput(value) {
  if (!value || !Object.hasOwn(ASSIST_MODES, value.mode)) return null;
  const prepared = prepareArticleBody(String(value.body ?? "").slice(0, 20000));
  return {
    mode: value.mode,
    title: line(value.title, 200),
    excerpt: line(value.excerpt, 400),
    body: prepared.html,
    length: `${line(value.title, 200)} ${line(value.excerpt, 400)} ${prepared.text}`.trim().length,
    rubricId: Number(value.rubricId) || 0,
    wantsPhoto: Boolean(value.wantsPhoto),
  };
}

async function loadRubrics(env) {
  const rows = (await env.DB.prepare("select id, parent_id, name, slug from rubrics order by sort_order asc, id asc").all()).results ?? [];
  return rows.map((row) => ({ id: Number(row.id), parentId: row.parent_id ? Number(row.parent_id) : null, name: String(row.name), slug: String(row.slug) }));
}

// Fotka z tématu, která byla nejdéle nepoužitá. Jen se navrhne, započítá se až uložením zprávy.
function stockSuggestion(stock, slug) {
  const topic = stock.topics.find((row) => row.slug === slug && row.images.length);
  if (!topic) return null;
  const [image] = [...topic.images].sort((a, b) => (a.usedAt || "").localeCompare(b.usedAt || ""));
  return { id: image.id, topic: topic.name };
}

export async function assistPost(path, request, env, { ask = askAssist } = {}) {
  if (path !== ASSIST_PATH) return null;
  const gate = await requireUser(env, request);
  if (!gate.ok) return reply({ ok: false, error: ASSIST_SAYS.login }, 401);
  const user = gate.user;
  if (!userCan(user, ASSIST_PERMISSION)) return reply({ ok: false, error: ASSIST_SAYS.denied }, 403);
  const input = readAssistInput(await readJson(request));
  if (!input) return reply({ ok: false, error: ASSIST_SAYS.bad }, 400);
  if (input.length < ASSIST_TEXT_MIN) return reply({ ok: false, error: ASSIST_SAYS.empty });

  const chief = user.role === "hlavni";
  const day = pragueNow().date;
  const settings = await loadAssistSettings(env);
  if (!chief) {
    const stop = await assistLimit(env, settings, { day, userId: user.id });
    if (stop) return reply({ ok: false, error: ASSIST_SAYS[stop] });
  }
  const left = await countAssist(env, settings, { day, userId: user.id, chief });

  const [drbena, rubrics, stock] = await Promise.all([loadDrbena(env), loadRubrics(env), loadStock(env)]);
  const topics = stock.topics.filter((topic) => topic.images.length);
  const current = rubrics.find((row) => row.id === input.rubricId);
  const answer = await ask(env, { input, voice: voiceFor(drbena), today: day, rubrics, topics, rubric: current?.slug ?? "" });
  await recordAssist(env, { day, userId: user.id, ok: answer.ok, cost: answer.cost });
  if (!answer.ok) return reply({ ok: false, error: answer.error });

  return reply({
    ok: true,
    title: answer.title,
    excerpt: answer.excerpt,
    body: answer.body,
    rubricId: rubrics.find((row) => row.slug === answer.rubric)?.id ?? null,
    stock: input.wantsPhoto ? stockSuggestion(stock, answer.imageTopic) : null,
    note: answer.note,
    left: chief ? null : left,
  });
}
