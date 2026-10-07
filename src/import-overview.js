// Přehled toho, co už na drbně je, jako text pro Claude (Munipolis, Deník, školy, web města, NDIC; zprávy a návrhy i fotbal).
// Značky v hranatých závorkách vrací Claude v duplicate_of. Data skládá `knownContent` v import-context.js.
import { hoursContext } from "./munipolis/hours.js";

function line(value, max = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

// Řádek zprávy nebo návrhu v přehledu: nadpis, perex, klíčová slova a jestli na něco navazuje nebo už má doplnění.
export function articleLine(row, tag) {
  return [
    `[${tag}:${row.id}] ${row.createdOn}`,
    line(row.title, 140),
    row.excerpt ? line(row.excerpt) : "",
    row.keywords ? `klíčová slova: ${line(row.keywords, 200)}` : "",
    row.followsId ? `navazuje na zprava:${row.followsId}` : "",
    row.followups ? `doplněno už ${row.followups}×` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Konec odstávky nebo uzavírky, ať Drběna pozná, jestli ještě trvá.
function noticeEnd(row) {
  return row.endsOn ? ` až ${row.endsOn}${row.endsTime ? ` ${row.endsTime}` : ""}` : "";
}

// Akce z posledních dní pro paměť Drběny (src/drbena-memory.js); sdílí je i fotbal.
export function recentSection(rows) {
  if (!rows?.length) return "";
  return `Akce, které nedávno proběhly a Drběna na nich byla:\n${rows
    .map((row) => `[akce:${row.id}] ${row.startsOn} · ${line(row.title, 140)} · ${line(row.place, 80)}`)
    .join("\n")}`;
}

// Zprávy a návrhy z přehledu (sdílí je i fotbal).
export function addArticles(add, known) {
  add("Zprávy na webu za poslední týdny", (known.articles ?? []).map((row) => articleLine(row, "zprava")));
  if (known.older?.length) add("Starší zprávy (jen nadpis a klíčová slova)", known.older.map((row) => articleLine(row, "zprava")));
  add("Návrhy, které čekají na schválení", (known.proposals ?? []).map((row) => articleLine(row, "navrh")));
}

// Přehled toho, co už na drbně je, ve třech dílech podle toho, jak často se mění. Mezi články jedné dávky
// se nemění `fixed` (akce, odstávky, otevírací doba), `articles` jen když Drběna něco napíše a `imports` po každém článku.
export function contextSections(known) {
  const section = (heading, rows) => `${heading}:\n${rows.length ? rows.join("\n") : "(nic)"}`;
  const fixed = [];
  const add = (heading, rows) => fixed.push(section(heading, rows));
  add(
    "Akce v kalendáři",
    (known.events ?? []).map(
      (row) => `[akce:${row.id}] ${row.startsOn}${row.startsTime ? ` ${row.startsTime}` : ""} · ${line(row.title, 140)} · ${line(row.place, 80)}${row.cancelled ? " · ZRUŠENO" : ""}`,
    ),
  );
  if (known.recent?.length) fixed.push(recentSection(known.recent));
  add(
    "Odstávky vody a uzavírky",
    (known.notices ?? []).map(
      (row) =>
        `[odstavka:${row.id}] ${row.kind} ${row.startsOn}${row.startsTime ? ` ${row.startsTime}` : ""}${noticeEnd(row)} · ${line(row.title, 100)} · ${line(row.places.join(", "))}`,
    ),
  );
  add(
    "Uzavírky silnic z Dopravního info (NDIC), už na webu",
    (known.closures ?? []).map(({ ref, articleId, proposalId, notice }) => {
      const written = [articleId && `zprava:${articleId}`, proposalId && `navrh:${proposalId}`].filter(Boolean).join(", ");
      return `[ndic:${ref}] ${notice.startsOn}${notice.endsOn ? ` až ${notice.endsOn}` : notice.openEnded ? " do odvolání" : ""} · ${line(notice.title, 100)} · ${line(notice.places.join(", "))}${written ? ` · článek ${written}` : ""}`;
    }),
  );
  fixed.push(hoursContext(known));
  const articles = [];
  addArticles((heading, rows) => articles.push(section(heading, rows)), known);
  const imports = section(
    "Dřívější převzaté zprávy (Munipolis, Deník, školy, web města, vložené příspěvky)",
    (known.imports ?? []).map((row) => `[${row.tag ?? "munipolis"}:${row.id}] ${row.publishedOn} · ${line(row.title, 140)} · ${row.outcome}`),
  );
  return { fixed: fixed.join("\n\n"), articles: articles.join("\n\n"), imports };
}

// Přehled toho, co už na drbně je. Značky v hranatých závorkách vrací Claude v duplicate_of.
export function contextText(known) {
  const { fixed, articles, imports } = contextSections(known);
  return [fixed, articles, imports].join("\n\n");
}

const CACHED = { type: "ephemeral" };

// Dotaz importu po blocích. Napřed to, co mají články jedné dávky společné, se značkami pro cache
// (další článek pak tuhle část platí za zlomek ceny), potom převzaté zprávy, obrázky a nakonec věci jen pro tuhle položku.
// `media` jsou hotové bloky obrázků, `tail` texty položky (prázdné se vynechají).
export function importContent(known, { today, topics = "", media = [], tail = [] }) {
  const { fixed, articles, imports } = contextSections(known);
  const related = relatedSection(known.related);
  const head = [`Dnes je ${today}.`, topics, fixed].filter(Boolean).join("\n\n");
  return [
    { type: "text", text: head, cache_control: CACHED },
    { type: "text", text: articles, cache_control: CACHED },
    { type: "text", text: imports },
    ...media,
    { type: "text", text: [related, ...tail].filter(Boolean).join("\n\n") },
  ];
}

// Starší zprávy, které k téhle položce našlo hledání v celém archivu (jen pro jednu položku, proto až za cache).
export function relatedSection(rows) {
  if (!rows?.length) return "";
  return `Možná souvisí (starší zprávy, které k téhle položce našlo hledání v celém archivu drbny; nemusí jít o stejnou věc, rozhodni podle obsahu; zpráva stará měsíce bývá jiný ročník nebo jiná událost, ne duplicita):\n${rows
    .map((row) => articleLine(row, "zprava"))
    .join("\n")}`;
}

// Text dotazu bez obrázků (testy, ukázka v redakci).
export function contentText(content) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}
