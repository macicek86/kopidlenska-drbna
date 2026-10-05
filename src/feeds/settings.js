// Vypínače odběru (redakce: Odběr a data). Vypnutý feed vrací 404 a zmizí z hlavičky stránek i ze stránky /odber.
// Jeden řádek `feed_settings`, ve výchozím stavu je všechno zapnuté.
import { asBool, requireChief } from "../db-core.js";

// key: vlastnost v JS, column: sloupec, path: adresa (strukturovaná data adresu nemají).
export const FEED_SWITCHES = [
  { key: "news", column: "zpravy", path: "/feed.xml", label: "Feed všech zpráv", hint: "Celé zprávy do čtečky." },
  { key: "rubrics", column: "rubriky", path: "/feed.xml?rubrika=", label: "Feedy rubrik", hint: "Zprávy jen z jedné rubriky." },
  { key: "calendar", column: "kalendar", path: "/akce.ics", label: "Akce do kalendáře", hint: "Odběr akcí v Google Kalendáři, iPhonu a Outlooku. S ním zmizí i odkazy na stránce Akce." },
  { key: "events", column: "akce", path: "/akce/feed.xml", label: "Feed nových akcí", hint: "Když v kalendáři přibude akce." },
  { key: "hours", column: "hodiny", path: "/oteviraci-doba/feed.xml", label: "Feed změn otevírací doby", hint: "Dočasné změny a nová doba míst, lékařů a sběrných dvorů." },
  { key: "notices", column: "odstavky", path: "/odstavky/feed.xml", label: "Feed odstávek a uzavírek", hint: "Voda, elektřina a silnice." },
  { key: "hoursJson", column: "data", path: "/oteviraci-doba.json", label: "Otevírací doba jako data", hint: "Pro weby a aplikace, které si hodiny ukazují samy." },
  { key: "hoursLd", column: "vyhledavace", path: "", label: "Otevírací doba pro vyhledávače", hint: "Běžné hodiny a zavření ve strukturovaných datech stránek Otevírací doba, Lékaři a Sběrné dvory. Google a Seznam z nich berou hodiny do výsledků." },
];

export const FEED_TABLE = `create table if not exists feed_settings (
  id integer primary key,
  zpravy integer not null default 1,
  rubriky integer not null default 1,
  kalendar integer not null default 1,
  akce integer not null default 1,
  hodiny integer not null default 1,
  odstavky integer not null default 1,
  data integer not null default 1,
  vyhledavace integer not null default 1
)`;

export async function ensureFeedTables(env) {
  await env.DB.prepare(FEED_TABLE).run();
  await env.DB.prepare("insert into feed_settings (id) select 1 where not exists (select 1 from feed_settings where id = 1)").run();
}

// Bez řádku (nebo v testu bez nastavení) je všechno zapnuté.
export function mapFeedSettings(row) {
  return Object.fromEntries(FEED_SWITCHES.map((item) => [item.key, row ? asBool(row[item.column]) : true]));
}

export async function loadFeedSettings(env) {
  return mapFeedSettings(await env.DB.prepare("select * from feed_settings where id = 1").first());
}

export async function saveFeedSettings(env, request, fields) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const columns = FEED_SWITCHES.map((item) => `${item.column} = ?`).join(", ");
  await env.DB.prepare(`update feed_settings set ${columns} where id = 1`)
    .bind(...FEED_SWITCHES.map((item) => ((fields.feedSwitches ?? []).includes(item.key) ? 1 : 0)))
    .run();
  return { ok: true };
}

// Je feed na adrese zapnutý? `on` chybí (testy, stránky bez nastavení): ano.
export function feedOn(on, href) {
  if (!on) return true;
  const path = String(href ?? "");
  if (path.startsWith("/feed.xml?rubrika=")) return on.rubrics !== false;
  const item = FEED_SWITCHES.find((entry) => entry.path && entry.path === path);
  return item ? on[item.key] !== false : true;
}

// Má smysl stránka /odber (a odkaz na ni v patičce)? Jen když je zapnutý aspoň jeden feed.
export function anyFeedOn(on) {
  return !on || FEED_SWITCHES.some((item) => item.path && on[item.key] !== false);
}
