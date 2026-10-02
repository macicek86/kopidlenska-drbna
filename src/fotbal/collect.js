// Sběr aktualit FK Kopidlno: web klubu (Sklub.cz) a k zápasům oficiální údaje z fotbalunas.cz. Výsledek jde do fronty.
import { isFresh, STALE_REASON } from "../background.js";
import { USER_AGENT } from "../munipolis/feed.js";
import { pragueNow } from "../waste.js";
import { scheduleDate } from "./dates.js";
import { clubPages, czechDate, findMatch, newsKind, parseMatchDetail, parseMatchList, parseNewsDetail, parseNewsList, titleTeams } from "./club.js";
import {
  competitionLinks,
  findOfficial,
  inTable,
  officialFromExtra,
  officialLine,
  ourTeam,
  parseFixtures,
  parseOfficialGoals,
  parseTable,
  tableUrl,
} from "./fotbalunas.js";
import { knownGuids, rememberFootballItem } from "./store.js";

async function fetchPage(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "text/html", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!response.ok) return { ok: false, error: `Web klubu odpověděl ${response.status}.` };
    return { ok: true, html: await response.text() };
  } catch {
    return { ok: false, error: "Web klubu neodpověděl." };
  }
}

// Doplňky k zápasu, které v aktualitě nejsou: soutěž, kolo, góly s minutou, tabulka a střelci.
// `official` je z fotbalunas.cz ({ line, table, team }) a platí přednostně. Tabulka a střelci z webu klubu patří jen jednomu týmu
// (béčku), k zápasu jiného týmu se nedají. Tabulka soutěže z fotbalunas je vždy ta, ve které se hrálo.
export function matchExtra(match, detail, matchDetail, official = null) {
  if (!match && !official) return "";
  const clubFits = !official?.team || inTable(detail.table, official.team);
  const table = official?.table || (clubFits ? detail.table : "");
  return [
    match ? `Soutěž: ${match.competition || "neuvedeno"}, ${match.round || "kolo neuvedeno"}` : "",
    match
      ? `Zápas: ${match.home} – ${match.away}, ${match.date}${match.time ? ` ${match.time}` : ""}${match.score ? `, výsledek ${match.score}` : ", ještě se nehrálo"}`
      : "",
    official?.line ?? "",
    matchDetail,
    table ? `Tabulka soutěže teď${official?.table ? " (fotbalunas.cz)" : ""}:\n${table}` : "",
    clubFits && detail.scorers ? `Nejlepší střelci týmu:\n${detail.scorers}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Rozlosování všech soutěží klubu z fotbalunas.cz. Když web neodpoví, nic se neověří a import jede dál jen s webem klubu.
async function officialFixtures(settings, fetchImpl) {
  if (!settings.truthUrl) return [];
  const club = await fetchPage(settings.truthUrl, fetchImpl);
  if (!club.ok) return [];
  const fixtures = [];
  for (const url of competitionLinks(club.html)) {
    const page = await fetchPage(url, fetchImpl);
    if (page.ok) fixtures.push(...parseFixtures(page.html, { source: url }));
  }
  return fixtures;
}

// Oficiální údaje k aktualitě: řádek se zápasem (u odehraného i se střelci) a tabulka jeho soutěže.
// Tabulky se pamatují v `tables`, ať se každá stáhne za průchod jen jednou.
async function officialFor(fixtures, tables, match, title, near, fetchImpl) {
  const teams = match ?? titleTeams(title);
  const official = teams ? findOfficial(fixtures, teams.home, teams.away, near) : null;
  if (!official) return null;
  const page = official.score ? await fetchPage(official.url, fetchImpl) : null;
  const url = tableUrl(official.source);
  if (url && !tables.has(url)) {
    const table = await fetchPage(url, fetchImpl);
    tables.set(url, table.ok ? parseTable(table.html) : "");
  }
  return {
    line: officialLine(official, page?.ok ? parseOfficialGoals(page.html) : null),
    table: tables.get(url) ?? "",
    team: ourTeam(official),
  };
}

// Datum ze zdroje pro ručně vybranou aktualitu. U zápasu den, kdy se hrál (klub aktualitu zakládá už před zápasem).
export function footballSourceDate(item, today) {
  const dates = [item.publishedOn];
  if (item.kind === "zapas") {
    dates.push(officialFromExtra(item.extra)?.date || scheduleDate(item.extra) || czechDate(item.text));
  }
  const best = dates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")).sort().at(-1) ?? "";
  return best && best <= today ? best : "";
}

// Projde úvodní stránku a aktuality klubu. Nové aktuality uloží do fronty, starší (podle data ve zdroji) a vypnuté rovnou odloží.
// Při ručním načtení (`manual`) počkají všechny, až redakce vybere, které zpracovat.
export async function collectNews(env, settings, { fetchImpl = fetch, manual = false } = {}) {
  const home = await fetchPage(settings.clubUrl, fetchImpl);
  if (!home.ok) return home;
  const pages = clubPages(home.html, settings.clubUrl);
  const list = await fetchPage(pages.news, fetchImpl);
  if (!list.ok) return list;
  const today = pragueNow().date;
  const news = parseNewsList(list.html, settings.clubUrl).map((entry) => ({ ...entry, kind: newsKind(entry.title) }));
  if (!news.length) return { ok: false, error: "Na webu klubu nejsou žádné aktuality. Nezměnil se web?" };
  const known = await knownGuids(env, news.map((entry) => `${entry.id}:${entry.kind}`));
  const fresh = news.filter((entry) => !known.has(`${entry.id}:${entry.kind}`));
  let matches = null;
  let fixtures = null;
  const tables = new Map();
  let added = 0;
  for (const entry of fresh.reverse()) {
    const page = await fetchPage(entry.url, fetchImpl);
    if (!page.ok) continue;
    const detail = parseNewsDetail(page.html, settings.clubUrl);
    let extra = "";
    if (entry.kind !== "clanek") {
      if (!matches) {
        matches = [];
        for (const url of pages.results) {
          const schedule = await fetchPage(url, fetchImpl);
          if (schedule.ok) matches.push(...parseMatchList(schedule.html, settings.clubUrl));
        }
      }
      fixtures ??= await officialFixtures(settings, fetchImpl);
      const title = detail.title || entry.title;
      const match = findMatch(matches, title);
      const played = match?.score ? await fetchPage(match.url, fetchImpl) : null;
      const official = await officialFor(fixtures, tables, match, title, match?.date || entry.date || detail.date, fetchImpl);
      extra = matchExtra(match, detail, played?.ok ? parseMatchDetail(played.html) : "", official);
    }
    const item = {
      guid: `${entry.id}:${entry.kind}`,
      kind: entry.kind,
      link: entry.url,
      title: detail.title || entry.title,
      publishedOn: entry.date || detail.date,
      text: detail.text,
      extra,
      images: detail.images.slice(0, 1),
      cover: detail.cover,
    };
    const old = !isFresh(footballSourceDate(item, today), today, settings.freshDays);
    const off = (entry.kind === "pozvanka" && !settings.previews) || (entry.kind === "clanek" && !settings.clubNews);
    if (manual) {
      if (await rememberFootballItem(env, item, { status: "nacteno" })) added += 1;
    } else if (old) await rememberFootballItem(env, item, { status: "stare", reason: STALE_REASON });
    else if (off) await rememberFootballItem(env, item, { status: "preskoceno", reason: "Tenhle druh aktualit je v nastavení vypnutý." });
    else if (await rememberFootballItem(env, item)) added += 1;
  }
  return { ok: true, added };
}
