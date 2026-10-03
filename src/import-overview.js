// Přehled toho, co už na drbně je, jako text pro Claude (Munipolis, Deník, školy, NDIC; zprávy a návrhy i fotbal).
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

// Zprávy a návrhy z přehledu (sdílí je i fotbal).
export function addArticles(add, known) {
  add("Zprávy na webu za poslední týdny", (known.articles ?? []).map((row) => articleLine(row, "zprava")));
  if (known.older?.length) add("Starší zprávy (jen nadpis a klíčová slova)", known.older.map((row) => articleLine(row, "zprava")));
  add("Návrhy, které čekají na schválení", (known.proposals ?? []).map((row) => articleLine(row, "navrh")));
}

// Přehled toho, co už na drbně je. Značky v hranatých závorkách vrací Claude v duplicate_of.
export function contextText(known) {
  const parts = [];
  const add = (heading, rows) => parts.push(`${heading}:\n${rows.length ? rows.join("\n") : "(nic)"}`);
  addArticles(add, known);
  add(
    "Akce v kalendáři",
    (known.events ?? []).map(
      (row) => `[akce:${row.id}] ${row.startsOn}${row.startsTime ? ` ${row.startsTime}` : ""} · ${line(row.title, 140)} · ${line(row.place, 80)}`,
    ),
  );
  add(
    "Odstávky vody a uzavírky",
    (known.notices ?? []).map(
      (row) => `[odstavka:${row.id}] ${row.kind} ${row.startsOn}${row.startsTime ? ` ${row.startsTime}` : ""} · ${line(row.title, 100)} · ${line(row.places.join(", "))}`,
    ),
  );
  add(
    "Uzavírky silnic z Dopravního info (NDIC), už na webu",
    (known.closures ?? []).map(({ ref, articleId, proposalId, notice }) => {
      const written = [articleId && `zprava:${articleId}`, proposalId && `navrh:${proposalId}`].filter(Boolean).join(", ");
      return `[ndic:${ref}] ${notice.startsOn}${notice.endsOn ? ` až ${notice.endsOn}` : notice.openEnded ? " do odvolání" : ""} · ${line(notice.title, 100)} · ${line(notice.places.join(", "))}${written ? ` · článek ${written}` : ""}`;
    }),
  );
  add(
    "Dřívější převzaté zprávy (Munipolis, Deník, školy)",
    (known.imports ?? []).map((row) => `[${row.tag ?? "munipolis"}:${row.id}] ${row.publishedOn} · ${line(row.title, 140)} · ${row.outcome}`),
  );
  parts.push(hoursContext(known));
  return parts.join("\n\n");
}
