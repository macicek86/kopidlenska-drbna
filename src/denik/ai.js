// Claude vybere z článku Jičínského deníku jen to důležité o Kopidlnu a napíše to vlastními slovy hlasem kozy Drběny.
// Deník to dovolil s podmínkou: žádné citace jeho textu, žádné „jak píše Deník“, ne celý článek, jen podstatné věci.
import { callClaude } from "../claude.js";
import { clubRules } from "../clubs.js";
import { EVENT_CHANGE_RULE } from "../event-change.js";
import { DEFAULT_VOICE } from "../drbena.js";
import { writeFollowup } from "../followup.js";
import { FOLLOWUP_DECISION } from "../followup-rules.js";
import { KEYWORDS_RULE } from "../keywords.js";
import { URGENT_RULE } from "../publish-queue.js";
import { contentText, importContent } from "../import-overview.js";
import { importLookup, withLookups } from "../import-tools.js";
import { outputSchema, readArticle, readDecision } from "../munipolis/ai.js";
import { topicsText } from "../stock.js";

const RULES = `Dostaneš jeden článek z Jičínského deníku, který zmiňuje Kopidlno nebo jeho části (Drahoraz, Mlýnec, Pševes, Ledkov), a přehled toho, co už na webu Kopidlenská drbna je.

Deník drbně dovolil brát z článků informace, ale jen za těchto podmínek. Dodrž je bez výjimky:
- Nepřebírej jeho text. Žádné citace, žádné opsané věty ani jejich části, žádné převzaté mezititulky. Všechno napiš úplně vlastními slovy a vlastní stavbou vět.
- Deník ani jiná média nikde nezmiňuj. Žádné „jak píše Jičínský deník“, „podle Deníku“, „uvádí server“, „informovala média“ a podobně. Nepiš ani jména novinářů.
- Nepřepisuj celý článek. Vyber jen to podstatné pro sousedy z Kopidlna: co se stalo nebo stane, kdy, kde a koho se to týká. Vynech podrobnosti, které s Kopidlnem nesouvisejí.
- Přímé řeči z článku nepřebírej. Když je důležité, co někdo řekl, shrň to jednou větou vlastními slovy.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy (třeba ze zpráv města). Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když článek přináší podstatnou novinku (jiný termín, zrušení, výsledek), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a novinku zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": Kopidlno je v článku jen okrajově (třeba jedna obec z dlouhého výčtu), nebo článek pro sousedy z Kopidlna nemá smysl.
- "vytvorit": článek je o Kopidlnu nebo jeho částech a sousedy bude zajímat.

Co vytvořit:
- Pozvánka na akci s datem: event a k tomu krátký článek s pozvánkou.
- Odstávka vody: notice s kind "voda". Uzavírka silnice nebo objížďka: notice s kind "uzavirka" a k tomu článek v praktické rubrice.
- Cokoli jiného: článek.

Pravidla:
- Data, časy, místa, jména, čísla a výsledky musí sedět se zdrojem. Nic nevymýšlej. Když údaj chybí, nech pole prázdné. Rok doplň podle data zveřejnění článku.
- Článek může končit uprostřed (zbytek je placený). Piš jen z toho, co máš, a nedomýšlej, jak to pokračuje.
- title: do 90 znaků, vlastní, ne nadpis Deníku. Bez emoji a bez psaní velkými písmeny.
- excerpt: jedna až dvě věty, do 220 znaků.
- body_html: jeden až tři krátké odstavce. Smíš použít jen <p>, <strong>, <em>, <ul> a <li>. Odkaz na zdroj nepiš.
- event.description: prostý text, jedna až tři věty.
${KEYWORDS_RULE}
${URGENT_RULE}
- image_topic: téma z knihovny obrázků, které k článku nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné. image_caption nech prázdné, fotky z Deníku se neberou.
- Datum piš jako RRRR-MM-DD a čas jako HH:MM.
- U části, kterou nevytváříš, dej include false a ostatní pole nech prázdná.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const FORCE = "Redakce chce tenhle článek zpracovat, i když jsi ho předtím přeskočila nebo měla za duplicitu. Nevracej \"preskocit\" ani \"duplicita\".";

export function denikPrompt(voice, { rubricSlugs = null } = {}) {
  const style = String(voice ?? "").trim() || DEFAULT_VOICE;
  const clubs = clubRules(rubricSlugs);
  return `${RULES}\n${EVENT_CHANGE_RULE}${clubs ? `\n\n${clubs}` : ""}\n\nHlas a styl textů:\n${style}`;
}

export function denikItemText(item) {
  return [
    `Článek z Jičínského deníku (zveřejněno ${item.publishedAt ? item.publishedAt.slice(0, 10) : "neznámo kdy"}):`,
    `Nadpis: ${item.title}`,
    `Text:\n${item.text || "(jen nadpis)"}`,
  ].join("\n\n");
}

export function denikContent(item, known, { today, force = false, retry = "", topics = [] }) {
  return importContent(known, { today, topics: topicsText(topics), tail: [denikItemText(item), force ? FORCE : "", retry] });
}

export function denikText(item, known, options) {
  return contentText(denikContent(item, known, options));
}

// Zmínky o Deníku nebo jiných médiích, které podmínky Deníku zakazují.
const MEDIA = /den[ií]k|podle\s+(?:médií|novin|serveru|webu|tisku)|(?:jak|podle)\s+(?:píše|píší|uvádí|uvedl\p{L}*|informuje|informoval\p{L}*)|(?:server|médi|novinář|reportér|redaktor)\p{L}*[^.]{0,40}(?:píš|psal|uvád|informoval|napsal)/iu;

function words(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Nejdelší úsek, který Drběna převzala ze zdroje slovo od slova (aspoň `size` slov), nebo prázdný text.
export function copiedRun(written, source, size = 8) {
  const own = words(written);
  const from = words(source);
  if (own.length < size || from.length < size) return "";
  const runs = new Set();
  for (let i = 0; i + size <= from.length; i += 1) runs.add(from.slice(i, i + size).join(" "));
  for (let i = 0; i + size <= own.length; i += 1) {
    const run = own.slice(i, i + size).join(" ");
    if (runs.has(run)) return run;
  }
  return "";
}

// Ověří, že výsledek dodržuje podmínky Deníku. Vrací větu pro redakci, nebo prázdný text.
export function denikProblem(decision, item) {
  const texts = [
    decision.article?.title,
    decision.article?.excerpt,
    decision.article?.body,
    decision.article?.imageCaption,
    decision.event?.title,
    decision.event?.description,
    decision.notice?.title,
    decision.notice?.note,
  ].filter(Boolean);
  const all = texts.join("\n");
  const media = all.replace(/<[^>]+>/g, " ").match(MEDIA);
  if (media) return `Drběna zmínila zdroj („${media[0]}“), a to Deník nechce.`;
  if (decision.article && words(decision.article.title).join(" ") === words(item.title).join(" ")) return "Drběna převzala nadpis Deníku.";
  const copied = copiedRun(all, `${item.title}\n${item.text}`);
  if (copied) return `Drběna opsala z Deníku kus textu („${copied}“).`;
  return "";
}

// Jedno volání Claude, a když výsledek poruší podmínky Deníku, ještě jedno s upozorněním.
export async function askDenik(env, { item, known, topics = [], rubricSlugs, voice, today, force = false }) {
  const slugs = topics.map((topic) => topic.slug);
  const schema = outputSchema(rubricSlugs, { topics: slugs, ownImage: false, followup: true });
  const system = denikPrompt(voice, { rubricSlugs });
  let retry = "";
  let problem = "";
  // Co si Drběna přečetla a kolik to stálo, za oba pokusy.
  let spent = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const content = denikContent(item, known, { today, force, retry, topics });
    const answer = await callClaude(env, { system, content, schema, lookup: importLookup(env) });
    if (!answer.ok) return withLookups(answer, spent);
    const decision = withLookups(readDecision(answer.raw, { rubricSlugs, force }), withLookups(answer, spent));
    spent = decision;
    if (decision.ok && decision.decision === "doplneni") {
      // I navazující zpráva musí dodržet podmínky Deníku.
      const written = await writeFollowup(env, decision, {
        system,
        sourceText: denikItemText(item),
        articleSchema: outputSchema(rubricSlugs, { topics: slugs, ownImage: false }).properties.article,
        readArticle: (raw) => readArticle(raw, rubricSlugs),
        topics,
        today,
        check: (result) => denikProblem(result, item),
      });
      return withLookups(written, decision);
    }
    if (!decision.ok || decision.decision !== "vytvorit") return decision;
    problem = denikProblem(decision, item);
    if (!problem) return decision;
    retry = `Minulý pokus nešel použít: ${problem} Napiš to znovu, úplně vlastními slovy a bez zmínky o zdroji.`;
  }
  return withLookups({ ok: false, error: `${problem} Zkusí to znovu příště.` }, spent);
}
