// Co Drběna v chatu ví: stránky drbny jako text (z D1 přes stejné funkce jako web) a nástroje na zprávy.
import { aboutPage } from "../about.js";
import { formatShort } from "../format.js";
import { binsPage, doctorsPage, eventsPage, outagesPage, placesPage, yardsPage } from "../view.js";
import { htmlText } from "./prompt.js";

const PAGE_MAX = 6000;
const RECENT_ARTICLES = 30;
const SEARCH_POOL = 400;
const SEARCH_HITS = 6;
const ARTICLE_MAX = 6000;
const SOURCE_MAX = 5000;

function clipText(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Stránky vykreslí bez reklam, ať v textu nejsou.
export function sitePages(data, ctx) {
  const bare = { ...data, ads: [], ad: null };
  const page = { ...ctx, chat: null, minimal: false };
  return [
    ["Svoz odpadu (/popelnice)", binsPage(data.waste, { ...page, path: "/popelnice" }, { showExternal: true, standaloneTitle: false })],
    ["Sběrné dvory (/sberne-dvory)", yardsPage(bare, { ...page, path: "/sberne-dvory" })],
    ["Lékaři (/lekari)", doctorsPage(bare, { ...page, path: "/lekari" })],
    ["Otevírací doba (/oteviraci-doba)", placesPage(bare, { ...page, path: "/oteviraci-doba" })],
    ["Odstávky vody a elektřiny (/odstavky)", outagesPage(bare, { ...page, path: "/odstavky" })],
    ["Akce (/akce)", eventsPage(bare, { ...page, path: "/akce" })],
    ["O nás a kontakt na redakci (/o-nas)", aboutPage(bare, { ...page, path: "/o-nas" })],
  ].map(([title, html]) => `## ${title}\n${clipText(htmlText(html), PAGE_MAX)}`);
}

function articleLine(article) {
  const rubric = article.parentName ? `${article.parentName} / ${article.category}` : article.category;
  return `- ${formatShort(article.createdOn)} · ${rubric} · ${article.title} (/zpravy/${article.slug}): ${article.excerpt}`;
}

// Přehled pro pokyny. Mění se jen se změnou dat, ne s časem, ať se dá uložit do cache.
export function siteOverview(data, ctx) {
  const articles = (data.articles ?? []).slice(0, RECENT_ARTICLES).map(articleLine);
  return `# Co je teď na drbně

## Nejnovější zprávy (/zpravy), starší najdeš nástrojem hledat_zpravy
${articles.length ? articles.join("\n") : "Zatím žádné zprávy."}

${sitePages(data, ctx).join("\n\n")}`;
}

// Bez diakritiky a malými písmeny, ať „knihovně“ najde „knihovna“.
export function fold(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Slova dotazu jako kmeny: české koncovky se mění, prvních pět písmen většinou stačí.
export function searchStems(query) {
  return [...new Set(fold(query).split(/[^a-z0-9]+/).filter((word) => word.length >= 3))]
    .map((word) => (word.length > 6 ? word.slice(0, 5) : word))
    .slice(0, 8);
}

export function scoreArticle(article, stems) {
  const title = fold(article.title);
  const excerpt = fold(article.excerpt);
  const body = fold(article.body);
  let score = 0;
  for (const stem of stems) {
    if (title.includes(stem)) score += 3;
    if (excerpt.includes(stem)) score += 2;
    if (body.includes(stem)) score += 1;
  }
  return score;
}

async function poolArticles(env) {
  const rows = await env.DB.prepare(
    `select a.slug, a.title, a.excerpt, a.body, a.created_at, coalesce(r.name, a.category) as rubric
     from articles a left join rubrics r on r.id = a.rubric_id
     where a.published = 1 order by a.created_at desc, a.id desc limit ?`,
  )
    .bind(SEARCH_POOL)
    .all();
  return (rows.results ?? []).map((row) => ({
    slug: String(row.slug),
    title: String(row.title),
    excerpt: String(row.excerpt),
    body: htmlText(String(row.body ?? "")),
    createdOn: String(row.created_at ?? "").slice(0, 10),
    rubric: String(row.rubric ?? ""),
  }));
}

// Zdroje importů, které na drbně (zatím) nejsou: čekají, přeskočené, duplicity. Deník ne: jeho podmínky
// nedovolují citace ani převzaté věty.
const SOURCES = {
  mesto: { table: "import_items", date: "published_at", label: "oznámení města (Munipolis)" },
  fotbal: { table: "football_items", date: "published_on", label: "web FK Kopidlno" },
};
const SOURCE_POOL = 200;

async function poolSources(env) {
  const lists = await Promise.all(
    Object.entries(SOURCES).map(async ([tag, source]) => {
      const rows = await env.DB.prepare(
        `select id, title, text, ${source.date} as day from ${source.table} where article_id is null order by id desc limit ?`,
      )
        .bind(SOURCE_POOL)
        .all();
      return (rows.results ?? []).map((row) => {
        const body = htmlText(String(row.text ?? ""));
        return {
          ref: `${tag}-${row.id}`,
          label: source.label,
          title: String(row.title),
          excerpt: clipText(body.replace(/\n/g, " "), 200),
          body,
          createdOn: String(row.day ?? "").slice(0, 10),
        };
      });
    }),
  );
  return lists.flat();
}

function rank(items, stems) {
  return items
    .map((item) => ({ item, score: scoreArticle(item, stems) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.item.createdOn.localeCompare(a.item.createdOn))
    .slice(0, SEARCH_HITS)
    .map((hit) => hit.item);
}

const shortDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatShort(iso) : "bez data");

export async function searchArticles(env, query) {
  const stems = searchStems(query);
  if (!stems.length) return "Zadej aspoň jedno slovo o třech a více písmenech.";
  const [articles, sources] = await Promise.all([poolArticles(env), poolSources(env)]);
  const found = rank(articles, stems);
  const extra = rank(sources, stems).slice(0, 4);
  if (!found.length && !extra.length) return `Na drbně jsem ke „${query}“ nic nenašla.`;
  const parts = [];
  if (found.length) {
    parts.push(
      `Zprávy na drbně:\n${found
        .map((article) => `- ${shortDate(article.createdOn)} · ${article.rubric} · ${article.title} (/zpravy/${article.slug}): ${article.excerpt}`)
        .join("\n")}`,
    );
  }
  if (extra.length) {
    parts.push(
      `Ze zdrojů, které na drbně zatím nejsou (můžeš z nich odpovědět a říct, odkud to víš; odkaz na ně nedávej, celý text vrátí precist_zdroj):\n${extra
        .map((item) => `- [${item.ref}] ${shortDate(item.createdOn)} · ${item.label} · ${item.title}: ${item.excerpt}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export async function readSource(env, ref) {
  const [, tag, id] = String(ref ?? "").trim().match(/^\[?(mesto|fotbal)-(\d+)\]?$/) ?? [];
  if (!tag) return "Takový zdroj neznám. Označení vypadá třeba jako mesto-12.";
  const source = SOURCES[tag];
  const row = await env.DB.prepare(`select title, text, ${source.date} as day from ${source.table} where id = ?`).bind(Number(id)).first();
  if (!row) return "Takový zdroj už nemám.";
  return `${row.title}\n${shortDate(String(row.day ?? "").slice(0, 10))} · ${source.label} (na drbně zatím není)\n\n${clipText(htmlText(String(row.text ?? "")), SOURCE_MAX)}`;
}

export function slugFrom(address) {
  const value = String(address ?? "").trim();
  const path = value.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  const slug = path.replace(/^\/?zpravy\//, "").replace(/^\/+|\/+$/g, "");
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export async function readArticle(env, address) {
  const slug = slugFrom(address);
  if (!slug) return "Chybí adresa zprávy.";
  const row = await env.DB.prepare(
    `select a.id, a.slug, a.title, a.excerpt, a.body, a.created_at, coalesce(r.name, a.category) as rubric
     from articles a left join rubrics r on r.id = a.rubric_id where a.slug = ? and a.published = 1`,
  )
    .bind(slug)
    .first();
  if (!row) return `Zprávu /zpravy/${slug} na drbně nemám.`;
  const text = clipText(htmlText(String(row.body ?? "")), ARTICLE_MAX);
  const source = await sourceText(env, Number(row.id));
  return `${row.title} (/zpravy/${row.slug})\n${formatShort(String(row.created_at).slice(0, 10))} · ${row.rubric}\n${row.excerpt}\n\n${text}${source}`;
}

// Zprávy z Munipolisu a fotbalu napsala Drběna ze zdroje; původní text bývá v údajích úplnější.
async function sourceText(env, articleId) {
  const parts = [];
  for (const source of Object.values(SOURCES)) {
    const row = await env.DB.prepare(`select title, text from ${source.table} where article_id = ? order by id desc limit 1`).bind(articleId).first();
    const text = htmlText(String(row?.text ?? ""));
    if (text) parts.push(`\n\n--- Původní text (${source.label}), ze kterého zpráva vznikla. Údaje ber odsud, když jsou přesnější; neopisuj ho ---\n${row.title}\n${clipText(text, SOURCE_MAX)}`);
  }
  return parts.join("");
}

export const CHAT_TOOLS = [
  {
    name: "hledat_zpravy",
    description:
      "Hledá ve všech zveřejněných zprávách drbny (i starších, než jsou v přehledu) podle slov v nadpisu, perexu a textu. Vrátí nanejvýš šest zpráv s datem, adresou a perexem. Projde i oznámení města a web FK Kopidlno, ze kterých drbna čerpá, i když z nich zpráva ještě není.",
    input_schema: {
      type: "object",
      properties: { dotaz: { type: "string", description: "Pár klíčových slov, třeba „hasiči ples“ nebo „uzavírka Husova“." } },
      required: ["dotaz"],
      additionalProperties: false,
    },
  },
  {
    name: "precist_zpravu",
    description: "Vrátí celý text jedné zprávy drbny podle adresy, třeba /zpravy/drakiada-2026.",
    input_schema: {
      type: "object",
      properties: { adresa: { type: "string", description: "Adresa zprávy z přehledu nebo z hledání." } },
      required: ["adresa"],
      additionalProperties: false,
    },
  },
  {
    name: "precist_zdroj",
    description: "Vrátí celý text oznámení města nebo článku z webu FK Kopidlno, který našlo hledání a na drbně zatím není. Označení je třeba mesto-12.",
    input_schema: {
      type: "object",
      properties: { oznaceni: { type: "string", description: "Označení zdroje z hledání, třeba mesto-12 nebo fotbal-7." } },
      required: ["oznaceni"],
      additionalProperties: false,
    },
  },
];

export async function runChatTool(env, name, input) {
  if (name === "hledat_zpravy") return searchArticles(env, String(input?.dotaz ?? ""));
  if (name === "precist_zpravu") return readArticle(env, input?.adresa);
  if (name === "precist_zdroj") return readSource(env, input?.oznaceni);
  return "Takový nástroj nemám.";
}
