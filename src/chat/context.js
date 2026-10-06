// Co Drběna v chatu ví: stránky drbny jako text (z D1 přes stejné funkce jako web), nástroje na zprávy a vzkazy redakci.
import { aboutPage } from "../about.js";
import { liveArticle } from "../db-core.js";
import { formatShort } from "../format.js";
import { pragueNow } from "../waste.js";
import { addMessageContact, MESSAGE_KINDS, messageKind, messagePage, saveChatMessage } from "../messages-db.js";
import { notifyEditors } from "../notify.js";
import { binsPage } from "../bins-view.js";
import { doctorsPage, eventsPage, outagesPage, placesPage, yardsPage } from "../view.js";
import { fold, searchNews, searchStems } from "../search/query.js";
import { archiveText } from "./archive.js";
import { htmlText } from "./prompt.js";

const PAGE_MAX = 6000;
export const RECENT_ARTICLES = 30;
const SEARCH_HITS = 8;
const SOURCE_HITS = 4;
const ARTICLE_MAX = 6000;
const SOURCE_MAX = 5000;

function clipText(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Stránky vykreslí bez reklam, ať v textu nejsou, a bez aktuálního času (now: false): „Kdo má teď otevřeno“
// by měnilo pokyny každou minutu a cache by se nevyužila. Čas Drběna dostává zvlášť na konci pokynů.
export function sitePages(data, ctx) {
  const bare = { ...data, ads: [], ad: null, now: false };
  const page = { ...ctx, chat: null };
  // Seznamy, co místa nabízí, jdou zvlášť (offerSection), ať je neořízne PAGE_MAX.
  const withoutOffers = { ...bare, places: (data.places ?? []).map((place) => ({ ...place, offers: [] })) };
  const pages = [
    ["Svoz odpadu (/popelnice)", binsPage(data.waste, { ...page, path: "/popelnice" })],
    ["Sběrné dvory (/sberne-dvory)", yardsPage(bare, { ...page, path: "/sberne-dvory" })],
    ["Lékaři (/lekari)", doctorsPage(bare, { ...page, path: "/lekari" })],
    ["Otevírací doba (/oteviraci-doba)", placesPage(withoutOffers, { ...page, path: "/oteviraci-doba" })],
    ["Odstávky vody a elektřiny (/odstavky)", outagesPage(bare, { ...page, path: "/odstavky" })],
    ["Akce (/akce)", eventsPage(bare, { ...page, path: "/akce" })],
    ["O nás a kontakt na redakci (/o-nas)", aboutPage(bare, { ...page, path: "/o-nas" })],
  ].map(([title, html]) => `## ${title}\n${clipText(htmlText(html), PAGE_MAX)}`);
  const offers = offerSection(data.places);
  return offers ? [...pages, offers] : pages;
}

// Co se kde dá najít a vyřídit (seznamy u míst z otevírací doby).
export function offerSection(places) {
  const lines = (places ?? [])
    .filter((place) => place.offers?.length)
    .map((place) => `- ${place.name}${place.label ? ` (${place.label})` : ""}, /oteviraci-doba#misto-${place.id}: ${place.offers.join("; ")}`);
  if (!lines.length) return "";
  return `## Co se kde dá najít a vyřídit (u míst z /oteviraci-doba, otevírací dobu najdeš výš)\n${lines.join("\n")}`;
}

// Den zprávy, u novějších zpráv i čas, kdy vyšla (pražský), ať Drběna může říct „dnes ráno jsem psala“.
export function articleWhen(article) {
  const day = formatShort(article.createdOn);
  const at = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(article.publishedAt ?? "");
  if (!at) return day;
  const time = pragueNow(new Date(`${at[1]}T${at[2]}Z`)).time.replace(/^0/, "");
  return `${day} v ${time}`;
}

function articleLine(article) {
  const rubric = article.parentName ? `${article.parentName} / ${article.category}` : article.category;
  return `- ${articleWhen(article)} · ${rubric} · ${article.title} (/zpravy/${article.slug}): ${article.excerpt}`;
}

// Zapnuté reklamy (nabídky sousedů). Ukázkové ne, ty nikdo nenabízí doopravdy.
export function adLines(ads) {
  return (ads ?? [])
    .filter((ad) => !ad.sample)
    .map((ad) => `- ${ad.title} (/reklamy/${ad.slug}): ${ad.body}${ad.place ? ` · ${ad.place}` : ""}`);
}

// Přehled pro pokyny. Mění se jen se změnou dat, ne s časem, ať se dá uložit do cache.
// `archive` jsou starší zprávy pro rejstřík (src/chat/archive.js).
export function siteOverview(data, ctx, { ads: withAds = true, archive = [] } = {}) {
  const articles = (data.articles ?? []).slice(0, RECENT_ARTICLES).map(articleLine);
  const ads = withAds ? adLines(data.ads) : [];
  const older = archiveText(archive);
  return `# Co je teď na drbně

## Nejnovější zprávy (/zpravy), ${older ? "starší jsou v rejstříku níž a" : "starší"} najdeš nástrojem hledat_zpravy
${articles.length ? articles.join("\n") : "Zatím žádné zprávy."}
${older ? `\n${older}\n` : ""}
${sitePages(data, ctx).join("\n\n")}${ads.length ? `\n\n## Reklamy: nabídky sousedů a místních (/reklamy)\n${ads.join("\n")}` : ""}`;
}

// Zdroje se hledají postaru v paměti (jsou jich stovky): klíčová slova váží jako nadpis.
export function scoreArticle(article, stems) {
  const title = fold(article.title);
  const keywords = fold(article.keywords);
  const excerpt = fold(article.excerpt);
  const body = fold(article.body);
  let score = 0;
  for (const stem of stems) {
    if (title.includes(stem)) score += 3;
    else if (keywords.includes(stem)) score += 3;
    if (excerpt.includes(stem)) score += 2;
    if (body.includes(stem)) score += 1;
  }
  return score;
}

// Zdroje importů, které na drbně (zatím) nejsou: čekají, přeskočené, duplicity. Deník ne: jeho podmínky
// nedovolují citace ani převzaté věty.
const SOURCES = {
  mesto: { table: "import_items", date: "published_at", label: "oznámení města (Munipolis)" },
  fotbal: { table: "football_items", date: "published_on", label: "web FK Kopidlno" },
  skola: { table: "skola_items", date: "published_at", label: "web ZŠ a MŠ Kopidlno" },
  zahradka: { table: "zahradka_items", date: "published_at", label: "web zahradnické školy Kopidlno" },
  webmesta: { table: "webmesta_items", date: "published_at", label: "web města Kopidlna (kopidlno.cz)" },
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
    .map((hit) => hit.item);
}

const shortDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatShort(iso) : "bez data");

// Rok z nástroje: jen rozumné celé číslo, jinak bez omezení.
function searchYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function searchWords(value) {
  return (Array.isArray(value) ? value : [])
    .map((word) => String(word ?? "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

// input: { dotaz, slova?, rok? } z nástroje hledat_zpravy. Vrací text pro Claude a počty pro záznam v redakci.
export async function findArticles(env, input) {
  const query = String(input?.dotaz ?? "").trim();
  const words = searchWords(input?.slova);
  const year = searchYear(input?.rok);
  const stems = searchStems([query, ...words].join(" "));
  if (!stems.length && !query) return { text: "Zadej, co hledáš, aspoň jedním slovem o třech a více písmenech.", articles: 0, sources: 0 };
  const [found, sources] = await Promise.all([
    searchNews(env, { query, words, year, limit: SEARCH_HITS }),
    year ? [] : poolSources(env),
  ]);
  const extra = rank(sources, stems).slice(0, SOURCE_HITS);
  const counts = { articles: found.length, sources: extra.length };
  if (!found.length && !extra.length) return { text: `Na drbně jsem ke „${query || words.join(", ")}“${year ? ` z roku ${year}` : ""} nic nenašla.`, ...counts };
  const parts = [];
  if (found.length) {
    parts.push(
      `Zprávy na drbně (od nejvhodnější; hledání bere i podobný význam, tak si ověř, že jde opravdu o to, nač se ptá):\n${found
        .map((article) => `- ${shortDate(article.createdOn)} · ${article.rubric} · ${article.title} (/zpravy/${article.slug}): ${article.excerpt}${article.keywords ? ` [${article.keywords}]` : ""}`)
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
  return { text: parts.join("\n\n"), ...counts };
}

export async function searchArticles(env, input) {
  return (await findArticles(env, input)).text;
}

// Řádek pro redakci: co Drběna hledala a kolik toho našla.
export function searchNote(input, found) {
  const words = searchWords(input?.slova);
  const year = searchYear(input?.rok);
  const extra = [words.length ? `+ ${words.join(", ")}` : "", year ? `rok ${year}` : ""].filter(Boolean).join("; ");
  const hits = found.articles || found.sources ? `${found.articles} zpráv${found.sources ? `, ${found.sources} ze zdrojů` : ""}` : "nic";
  return `hledala „${String(input?.dotaz ?? "").trim()}“${extra ? ` (${extra})` : ""} → ${hits}`;
}

export async function readSource(env, ref) {
  const [, tag, id] = String(ref ?? "").trim().match(/^\[?(mesto|fotbal|skola|zahradka|webmesta)-(\d+)\]?$/) ?? [];
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
     from articles a left join rubrics r on r.id = a.rubric_id where a.slug = ? and ${liveArticle()}`,
  )
    .bind(slug)
    .first();
  if (!row) return `Zprávu /zpravy/${slug} na drbně nemám.`;
  const text = clipText(htmlText(String(row.body ?? "")), ARTICLE_MAX);
  const source = await sourceText(env, Number(row.id));
  return `${row.title} (/zpravy/${row.slug})\n${formatShort(String(row.created_at).slice(0, 10))} · ${row.rubric}\n${row.excerpt}\n\n${text}${source}`;
}

// Zprávy z Munipolisu, fotbalu a webů škol napsala Drběna ze zdroje; původní text bývá v údajích úplnější.
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
      "Hledá ve všech zveřejněných zprávách drbny, i několik let starých, podle slov i podle významu. Vrátí nanejvýš osm zpráv od nejvhodnější s datem, adresou, perexem a klíčovými slovy. Projde i oznámení města a weby FK Kopidlno a škol, ze kterých drbna čerpá, i když z nich zpráva ještě není. Celý text pak vrátí precist_zpravu.",
    input_schema: {
      type: "object",
      properties: {
        dotaz: { type: "string", description: "O čem zprávu hledáš, pár slov nebo krátká věta, třeba „barva zámku“ nebo „ples hasičů“." },
        slova: {
          type: "array",
          items: { type: "string" },
          description:
            "Jiné tvary a synonyma, ať je hledání podle slov najde, i když zpráva píše jinak: třeba k „barva zámku“ [\"zámku\", \"zámecký\", \"fasáda\", \"nátěr\", \"omítka\"]. Nepovinné.",
        },
        rok: { type: "integer", description: "Jen zprávy z tohoto roku, když se ptá na určitou dobu (třeba „loni“). Nepovinné." },
      },
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
    description: "Vrátí celý text oznámení města nebo článku z webu FK Kopidlno či ZŠ a MŠ Kopidlno, který našlo hledání a na drbně zatím není. Označení je třeba mesto-12.",
    input_schema: {
      type: "object",
      properties: { oznaceni: { type: "string", description: "Označení zdroje z hledání, třeba mesto-12, fotbal-7 nebo skola-3." } },
      required: ["oznaceni"],
      additionalProperties: false,
    },
  },
  {
    name: "predat_redakci",
    description:
      "Předá redakci vzkaz od návštěvníka: chybějící místo v otevírací době, oprava nebo změna na drbně, tip na článek, nápad nebo jiné přání. Vrátí, jestli se to povedlo.",
    input_schema: {
      type: "object",
      properties: {
        druh: { type: "string", enum: Object.keys(MESSAGE_KINDS), description: "misto = chybí místo nebo služba, oprava = něco je špatně nebo se má změnit, tip = tip na článek nebo akci, napad = nápad na drbnu, jine = ostatní." },
        shrnuti: { type: "string", description: "Jedna věta pro redakci, o co jde, třeba „Chybí otevírací doba cukrárny U Lípy“." },
        text: { type: "string", description: "Co přesně návštěvník chce, jeho slovy a se všemi podrobnostmi, které řekl." },
        kontakt: { type: "string", description: "E-mail nebo telefon, jen když ho návštěvník sám napsal. Jinak vynech." },
      },
      required: ["druh", "shrnuti", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "doplnit_kontakt",
    description: "Připíše e-mail nebo telefon k vzkazu, který jsi v tomhle rozhovoru už předala redakci.",
    input_schema: {
      type: "object",
      properties: { kontakt: { type: "string", description: "E-mail nebo telefon, jak ho návštěvník napsal." } },
      required: ["kontakt"],
      additionalProperties: false,
    },
  },
];

const MESSAGE_SAYS = {
  limit: "Vzkaz se nepředal: v tomhle rozhovoru nebo dnes už jich bylo předáno hodně. Řekni, ať napíše redakci přes stránku O nás (/o-nas).",
  empty: "Vzkaz se nepředal, chybí shrnutí.",
  missing: "Kontakt nejde připsat, v tomhle rozhovoru zatím žádný vzkaz předaný není. Předej nejdřív vzkaz nástrojem predat_redakci i s kontaktem.",
};

// E-mail hlavnímu redaktorovi o novém vzkazu.
function messageMail(message) {
  const summary = String(message.summary ?? "").trim();
  return {
    subject: `Vzkaz z chatu: ${summary}`.slice(0, 150),
    intro: "Drběna vám z chatu předala vzkaz od návštěvníka.",
    fields: [
      ["Druh", MESSAGE_KINDS[messageKind(message.kind)]],
      ["O co jde", summary],
      ["Kontakt", String(message.contact ?? "").trim()],
      ["Stránka", messagePage(message.page)],
    ],
    body: String(message.text ?? "").trim(),
  };
}

// Nástroje na vzkazy potřebují vědět, kdo píše (who: day, visitor, conversation, page;
// defer nechá e-mail redakci odejít na pozadí); bez něj nic neuloží.
async function messageTool(env, name, input, who) {
  if (!who) return "Vzkazy teď předat nejde.";
  if (name === "doplnit_kontakt") {
    const result = await addMessageContact(env, who, input?.kontakt);
    return result.ok ? "Kontakt je připsaný ke vzkazu." : MESSAGE_SAYS[result.reason];
  }
  const message = {
    kind: input?.druh,
    summary: input?.shrnuti,
    text: input?.text,
    contact: input?.kontakt,
    page: who.page,
  };
  const result = await saveChatMessage(env, who, message);
  if (result.ok) {
    const sending = notifyEditors(env, "vzkaz", messageMail(message));
    if (who.defer) who.defer(sending);
    else await sending;
  }
  return result.ok ? "Předáno redakci. Uvidí to v redakci mezi vzkazy." : MESSAGE_SAYS[result.reason];
}

export async function runChatTool(env, name, input, who = null) {
  if (name === "predat_redakci" || name === "doplnit_kontakt") return messageTool(env, name, input, who);
  if (name === "hledat_zpravy") {
    const found = await findArticles(env, input);
    who?.log?.push(searchNote(input, found));
    return found.text;
  }
  if (name === "precist_zpravu") {
    who?.log?.push(`četla /zpravy/${slugFrom(input?.adresa)}`);
    return readArticle(env, input?.adresa);
  }
  if (name === "precist_zdroj") {
    who?.log?.push(`četla zdroj ${String(input?.oznaceni ?? "").trim()}`);
    return readSource(env, input?.oznaceni);
  }
  return "Takový nástroj nemám.";
}
