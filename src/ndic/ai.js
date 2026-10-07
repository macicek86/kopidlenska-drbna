// Claude přepíše uzavírku z NDIC lidsky, pozná duplicitu a k delší uzavírce napíše článek jako u Munipolisu.
import { callClaude } from "../claude.js";
import { DEFAULT_VOICE } from "../drbena.js";
import { KEYWORDS_RULE } from "../keywords.js";
import { contentText, importContent } from "../import-overview.js";
import { outputSchema, readArticle } from "../munipolis/ai.js";
import { noticeSpan, placeLines } from "../notices.js";
import { topicsText } from "../stock.js";
import { closureNotice } from "./closures.js";

const RULES = `Dostaneš jednu uzavírku nebo omezení silnice v okolí Kopidlna z Národního dopravního informačního centra (NDIC) a přehled toho, co už na webu Kopidlenská drbna je.

Rozhodni (pole decision):
- "duplicita": stejná uzavírka už na drbně je, třeba jako oznámení od města nebo redakce, zpráva, čekající návrh nebo jiná uzavírka z NDIC. Do duplicate_of dej její značku z přehledu, třeba "odstavka:4" nebo "zprava:12". Stejná je, když jde o stejnou silnici nebo místo a termíny se překrývají, i když je popsaná jinými slovy.
- "vytvorit": všechno ostatní.

Co vytvořit:
- notice: oznámení na stránku Odstávky a uzavírky, pro lidi z Kopidlna srozumitelně a bez úředních zkratek.
  - title: krátce, co a kde, do 80 znaků. Třeba "Zavřený most přes Mrlinu u Ledkova" nebo "Kyvadlový provoz mezi Kopidlnem a Mlýncem".
  - places: úseky, obce nebo ulice, každé zvlášť. Číslo silnice nech, ale přidej, odkud kam vede, pokud to ze zdroje plyne.
  - note: jedna až dvě věty: proč, pro koho platí (třeba jen pro nákladní auta) a kudy objížďka. Jen to, co je ve zdroji.
  - Data a časy nepiš, ty drbna vezme přesně z NDIC.
- article: jen když zadání říká, že má být článek. Krátký článek v praktické rubrice (rubric "prakticke", když je v seznamu): co je zavřené, odkdy dokdy, pro koho a kudy jezdit. Jinak include false.

Pravidla:
- Silnice, obce, data, časy, objížďky a omezení opiš přesně podle zdroje. Nic nevymýšlej. Co ve zdroji není, nepiš.
- Zdroj nejmenuj a odkaz nepiš: ani NDIC, ani Dopravní info.
- image_topic: téma z knihovny obrázků, které k uzavírce nejlíp sedí (značka ze seznamu témat). Když nesedí žádné, nech prázdné. image_caption nech prázdný.
- title článku: do 90 znaků, bez emoji. excerpt: jedna až dvě věty, do 220 znaků.
${KEYWORDS_RULE}
- body_html: dva až čtyři krátké odstavce. Smíš použít jen <p>, <strong>, <em>, <ul>, <li> a <h3>.
- Datum v textu piš česky (třeba 12. října), ne jako RRRR-MM-DD.
- reason: jedna věta pro redakci, proč jsi tak rozhodla.`;

const KIND_LABEL = {
  uzavirka: "uzavírka",
  kyvadlo: "kyvadlový provoz",
  pruh: "omezení jízdních pruhů",
  omezeni: "omezení provozu",
};

function stringField() {
  return { type: "string" };
}

export function ndicSchema(rubricSlugs, topics = []) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["decision", "reason", "duplicate_of", "notice", "article"],
    properties: {
      decision: { type: "string", enum: ["vytvorit", "duplicita"] },
      reason: stringField(),
      duplicate_of: stringField(),
      notice: {
        type: "object",
        additionalProperties: false,
        required: ["title", "places", "note"],
        properties: {
          title: stringField(),
          places: { type: "array", items: stringField() },
          note: stringField(),
        },
      },
      article: outputSchema(rubricSlugs, { topics, ownImage: false }).properties.article,
    },
  };
}

export function ndicPrompt(voice) {
  const style = String(voice ?? "").trim() || DEFAULT_VOICE;
  return `${RULES}\n\nHlas a styl textů (u uzavírek hlavně věcně a jasně, povaha jen lehce):\n${style}`;
}

export function closureText(row, settings) {
  const notice = closureNotice(row, settings);
  return [
    `Druh: ${KIND_LABEL[row.kind] ?? "omezení provozu"}`,
    `Termín: ${noticeSpan(notice)}`,
    row.roads.length ? `Silnice: ${row.roads.join(", ")}` : "",
    row.distanceKm != null ? `Vzdálenost od Kopidlna: asi ${String(row.distanceKm).replace(".", ",")} km` : "Poloha: neznámá",
    `Nadpis z dat: ${row.title}`,
    row.comments.length ? `Popis ze zdroje: ${row.comments.join(" ")}` : "Popis ze zdroje: (žádný)",
    row.detour.length ? `Objížďka: ${row.detour.join(" ")}` : "",
    row.articleId || row.proposalId
      ? `K téhle uzavírce už Drběna napsala ${row.articleId ? `zprava:${row.articleId}` : `navrh:${row.proposalId}`}. To duplicita není, jde o stejnou uzavírku.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function daysText(days) {
  if (days === 1) return "1 den";
  return `${days} ${days >= 2 && days <= 4 ? "dny" : "dní"}`;
}

// Uzavírky přicházejí po dávkách, přehled jde napřed kvůli cache (importContent).
export function ndicContent(row, known, { today, settings, wantArticle, topics = [] }) {
  return importContent(known, {
    today,
    topics: topicsText(topics),
    tail: [
      `Uzavírka z NDIC:\n${closureText(row, settings)}`,
      wantArticle
        ? `Uzavírka je delší (${daysText(settings.articleDays)} a víc): napiš k ní i článek (article include true), pokud nejde o duplicitu.`
        : "Uzavírka je krátká: článek nepiš (article include false), stačí oznámení.",
    ],
  });
}

export function ndicText(row, known, options) {
  return contentText(ndicContent(row, known, options));
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const REF = /^(zprava|navrh|akce|odstavka|ndic|munipolis|denik|skola|zahradka|webmesta|vlozene):\d+$/;

// Ověří odpověď. U duplicity stačí značka, jinak musí být aspoň nadpis oznámení.
export function readNdicDecision(raw, { rubricSlugs, wantArticle }) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Claude nevrátil rozhodnutí." };
  const decision = ["vytvorit", "duplicita"].includes(raw.decision) ? raw.decision : "";
  if (!decision) return { ok: false, error: "Claude nevrátil rozhodnutí." };
  const reason = clean(raw.reason, 400);
  if (decision === "duplicita") {
    const duplicateOf = String(raw.duplicate_of ?? "").trim();
    if (!REF.test(duplicateOf)) return { ok: false, error: "Claude uzavírku označil za duplicitu, ale neřekl s čím." };
    return { ok: true, decision, reason, duplicateOf };
  }
  const title = clean(raw.notice?.title, 120);
  if (title.length < 3) return { ok: false, error: "Claude nevrátil nadpis uzavírky." };
  return {
    ok: true,
    decision,
    reason,
    notice: { title, places: placeLines(raw.notice?.places).slice(0, 12), note: clean(raw.notice?.note, 600) },
    article: wantArticle ? readArticle(raw.article, rubricSlugs) : null,
  };
}

export async function askNdic(env, { row, known, settings, wantArticle, topics = [], rubricSlugs, voice, today }) {
  const schema = ndicSchema(rubricSlugs, topics.map((topic) => topic.slug));
  const answer = await callClaude(env, {
    system: ndicPrompt(voice),
    content: ndicContent(row, known, { today, settings, wantArticle, topics }),
    schema,
  });
  if (!answer.ok) return answer;
  return readNdicDecision(answer.raw, { rubricSlugs, wantArticle });
}
