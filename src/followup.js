// Navazující zpráva (doplnění): o věci už na drbně zpráva je, ale nová položka ze zdroje přináší víc.
// Import nejdřív jen rozhodne „doplneni“ (stejné volání jako duplicita), teprve pak druhé volání dostane celou starou
// zprávu a napíše novou, která na ni navazuje. Jde jako návrh, rovnou na web jen se zapnutým nastavením na stránce Koza Drběna.
import { saveBotArticle } from "./bot-article.js";
import { saveBotEvent } from "./events-db.js";
import { pragueNow } from "./waste.js";
import { addUsage, callClaude } from "./claude.js";
import { loadDrbena } from "./drbena-db.js";
import { prepareArticleBody } from "./rich.js";
import { MAX_FOLLOWUPS } from "./followup-rules.js";
import { topicsText } from "./stock.js";

const WRITE_RULES = `Teď píšeš navazující zprávu. O téže věci už na drbně zpráva je (celá je níž) a nová zpráva ze zdroje přináší něco navíc.

Rozhodni (pole decision):
- "doplneni": napiš navazující zprávu.
- "duplicita": když po přečtení celé staré zprávy vidíš, že nová nepřináší nic podstatného navíc.

Jak psát navazující zprávu:
- Začni tím, že na starou zprávu navazuješ, vlastními slovy podle své povahy (třeba „Drběna už psala…“, „Drběna slíbila, že se ozve…“). O sobě piš v celé zprávě ve stejné osobě, jakou určuje povaha, i v téhle větě. Jednou větou připomeň, o co šlo.
- Pak hlavně to nové. Co už ve staré zprávě je, neopakuj.
- title: nový nadpis, který říká tu novinku, ne nadpis staré zprávy.
- Odkaz na starou zprávu nepiš, drbna ho doplní sama.
- rubric: stejná jako u staré zprávy, pokud je v seznamu.
- U události, oznámení a otevírací doby nic nevytvářej, jde jen o článek.`;

function stringField() {
  return { type: "string" };
}

function followupSchema(articleSchema) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reason", "article"],
    properties: {
      decision: { type: "string", enum: ["doplneni", "duplicita"] },
      reason: stringField(),
      article: articleSchema,
    },
  };
}

// Stará zpráva, na kterou se navazuje, nebo null, když už není na webu.
export async function loadFollowTarget(env, id) {
  const row = await env.DB.prepare(
    `select a.id, a.slug, a.title, a.body, a.created_at, a.published, r.slug as rubric_slug,
       (select count(*) from articles f where f.follows_id = a.id)
       + (select count(*) from proposals fp where fp.follows_id = a.id and fp.status = 'pending') as followups
     from articles a left join rubrics r on r.id = a.rubric_id where a.id = ?`,
  )
    .bind(id)
    .first();
  // Naplánovaná zpráva ještě není na webu, navázat na ni nejde.
  if (!row || !Number(row.published) || String(row.created_at).slice(0, 10) > pragueNow().date) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title: String(row.title),
    text: prepareArticleBody(String(row.body ?? "")).text.trim(),
    createdOn: String(row.created_at).slice(0, 10),
    rubricSlug: String(row.rubric_slug ?? ""),
    followups: Number(row.followups ?? 0),
  };
}

export function followupText(target, sourceText, { today, topics = [], retry = "" }) {
  return [
    `Dnes je ${today}.`,
    topicsText(topics),
    `Stará zpráva na drbně (zprava:${target.id}, vyšla ${target.createdOn}, rubrika ${target.rubricSlug || "neznámá"}):\nNadpis: ${target.title}\nText:\n${target.text.slice(0, 6000)}`,
    sourceText,
    retry,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const DOUBLE = (reason, ref) => ({ ok: true, decision: "duplicita", reason, duplicateOf: ref, article: null, event: null, notice: null, hours: [] });

// Druhé volání: navazující zpráva. `decision` je odpověď prvního volání s `followOf` (id staré zprávy).
// `system` jsou pokyny zdroje (fakta, podmínky Deníku, povaha), `sourceText` popis nové zprávy ze zdroje,
// `readArticle` převede článek z odpovědi, `check` vrátí problém (Deník: citace, zmínka o zdroji), nebo prázdný text.
// Zrušení nebo změna akce z prvního volání (`eventChange`) platí, i když druhé volání řekne duplicita.
export async function writeFollowup(env, decision, options) {
  const result = await writeFollowupBase(env, decision, options);
  return result.ok ? { ...result, eventChange: decision.eventChange ?? null } : result;
}

async function writeFollowupBase(env, decision, { system, sourceText, articleSchema, readArticle, topics = [], today, check = () => "" }) {
  const ref = `zprava:${decision.followOf}`;
  const target = await loadFollowTarget(env, decision.followOf);
  if (!target) return DOUBLE(decision.reason, ref);
  if (target.followups >= MAX_FOLLOWUPS) return DOUBLE(`${decision.reason} Ke zprávě už je doplnění dost.`, ref);
  let retry = "";
  let problem = "";
  let usage = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await callClaude(env, {
      system: `${system}\n\n${WRITE_RULES}`,
      content: [{ type: "text", text: followupText(target, sourceText, { today, topics, retry }) }],
      schema: followupSchema(articleSchema),
    });
    if (!answer.ok) return { ...answer, usage };
    usage = addUsage(usage, answer.usage);
    const reason = String(answer.raw?.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || decision.reason;
    if (answer.raw?.decision === "duplicita") return { ...DOUBLE(reason, ref), usage };
    const article = readArticle({ ...answer.raw?.article, include: true });
    if (!article) return { ok: false, error: "Claude chtěl napsat doplnění, ale nevrátil článek, který by šel uložit." };
    const written = { ok: true, decision: "doplneni", reason, duplicateOf: ref, article, target, event: decision.event ?? null, notice: null, hours: [], usage };
    problem = check(written);
    if (!problem) return written;
    retry = `Minulý pokus nešel použít: ${problem} Napiš to znovu, úplně vlastními slovy a bez zmínky o zdroji.`;
  }
  return { ok: false, error: `${problem} Zkusí to znovu příště.`, usage };
}

// Uloží navazující zprávu. Odkaz na starou zprávu dá web pod čáru podle `follows_id` (src/article-source.js). Rovnou na web jen když import zveřejňuje rovnou a redakce to u doplnění dovolila.
export async function saveFollowup(env, answer, { image, source, autoPublish, rubrics, publishOn = "", spread = false }) {
  const { followupPublish } = await loadDrbena(env);
  const rubric = rubrics.get(answer.article.rubric) ?? rubrics.get(answer.target.rubricSlug) ?? [...rubrics.values()][0];
  return saveBotArticle(env, {
    article: answer.article,
    image,
    source,
    autoPublish: autoPublish && followupPublish,
    rubric,
    publishOn,
    followsId: answer.target.id,
    spread,
  });
}

// Akce, kterou doplnění přineslo (den, který v kalendáři chyběl), s navazující zprávou (`made` z `saveFollowup`).
// Položka, která už akci má (zpracovaná znovu), ji nemění.
export async function saveFollowupEvent(env, answer, item, made, published) {
  if (item.eventId || !answer.event) return item.eventId ?? null;
  return saveBotEvent(env, answer.event, { published, articleId: made.articleId, proposalId: made.proposalId });
}

// Poznámka k položce importu pro redakci.
export function followupReason(answer) {
  return `Doplnění ke zprávě zprava:${answer.target.id}. ${answer.reason}`.trim();
}
