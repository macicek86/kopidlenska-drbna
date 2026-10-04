// Rejstřík starších zpráv pro chat: zprávy za 30 nejnovějšími, každá jen na jednom řádku s nadpisem a klíčovými slovy
// (src/keywords.js). Drběna tak ví, o čem drbna kdy psala, a celý text si přečte nástrojem precist_zpravu.
// Kolik zpráv v něm je, nastavuje redakce chatu (`archive`); každý řádek je asi 40 tokenů v pokynech.
import { liveArticle } from "../db-core.js";
import { formatShort } from "../format.js";
import { shownKeywords } from "../keywords.js";

export async function loadArchive(env, { skip, limit }) {
  if (!limit) return [];
  const rows = await env.DB.prepare(
    `select a.slug, a.title, a.keywords, a.created_at, coalesce(r.name, a.category) as rubric
     from articles a left join rubrics r on r.id = a.rubric_id
     where ${liveArticle()} order by a.created_at desc, a.id desc limit ? offset ?`,
  )
    .bind(limit, skip)
    .all();
  return (rows.results ?? []).map((row) => ({
    slug: String(row.slug),
    title: String(row.title),
    keywords: shownKeywords(row.keywords),
    createdOn: String(row.created_at ?? "").slice(0, 10),
    rubric: String(row.rubric ?? ""),
  }));
}

export function archiveLine(article) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(article.createdOn) ? formatShort(article.createdOn) : "bez data";
  const keywords = article.keywords ? ` · ${article.keywords}` : "";
  return `- ${date} · ${article.rubric} · ${article.title} (/zpravy/${article.slug})${keywords}`;
}

export function archiveText(articles) {
  if (!articles?.length) return "";
  return `## Starší zprávy (jen nadpis a klíčová slova, celý text vrátí precist_zpravu)\n${articles.map(archiveLine).join("\n")}`;
}
