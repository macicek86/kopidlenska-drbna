// Web FK Kopidlno (platforma Sklub.cz): rozebrání aktualit, rozpisu zápasů a detailu zápasu. Bez sítě, ať jde testovat.
import { decodeEntities, htmlToText } from "../munipolis/feed.js";

export const DEFAULT_CLUB_URL = "https://www.fkkopidlno.cz/";
const NEWS_PATH = "/cs/s/4-aktuality";
const MAX_NEWS = 16;

function plain(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absolute(base, href) {
  try {
    return new URL(decodeEntities(href), base).toString();
  } catch {
    return "";
  }
}

// „23.09.2026“ → „2026-09-23“
export function czechDate(value) {
  const match = String(value ?? "").match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

// Odkazy z úvodní stránky: kde jsou aktuality a rozpisy jednotlivých týmů.
export function clubPages(html, base) {
  const text = String(html ?? "");
  const news = text.match(/href="(\/cs\/s\/\d+-aktuality)"/);
  const results = new Set();
  for (const match of text.matchAll(/href="(\/cs\/s\/\d+-vysledky\/[^"/?#]+)"/g)) results.add(absolute(base, match[1]));
  return { news: absolute(base, news ? news[1] : NEWS_PATH), results: [...results] };
}

export function parseNewsList(html, base) {
  const items = [];
  for (const block of String(html ?? "").split(/class="news-item"/).slice(1)) {
    const link = block.match(/<a href="([^"]*\/(\d+)-[^"]*)" class="news-item-name">([\s\S]*?)<\/a>/);
    if (!link) continue;
    const date = block.match(/class="news-item-date">([^<]*)</);
    const url = absolute(base, link[1]);
    if (!url || items.some((item) => item.id === Number(link[2]))) continue;
    items.push({ id: Number(link[2]), url, title: plain(link[3]).slice(0, 300), date: czechDate(date?.[1]) });
    if (items.length >= MAX_NEWS) break;
  }
  return items;
}

function between(text, start, end) {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const to = text.indexOf(end, from + start.length);
  return text.slice(from + start.length, to < 0 ? undefined : to).trim();
}

// Tabulka a střelci jsou v postranním sloupci každé stránky. Řádky slepí do „1. SK Robousy A 7 34:2 21“.
export function sidebar(html) {
  const lines = htmlToText(String(html ?? "").replace(/<\/(td|th|span|a)>/gi, " </$1>"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const text = lines.join("\n");
  const rows = (part) =>
    part
      .replace(/\n(?!\d+\.\n)/g, " ")
      .replace(/(\d+\.)\n/g, "$1 ")
      .split(/\s(?=\d+\.\s)/)
      .map((row) => row.trim())
      .filter(Boolean)
      .join("\n");
  return {
    table: rows(between(text, "Ligová tabulka", "Kompletní tabulka")),
    scorers: rows(between(text, "Nejlepší střelci", "Kompletní statistiky")),
  };
}

export function parseNewsDetail(html, base) {
  const text = String(html ?? "");
  const title = plain(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const date = czechDate(text.match(/class="small-headline">([^<]*)</)?.[1]);
  const author = plain(text.match(/Autor:\s*([^<]*)</)?.[1]);
  const section = text.match(/<section class="text-section">([\s\S]*?)<\/section>/i)?.[1] ?? "";
  const images = [];
  for (const match of section.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    const url = absolute(base, match[1]);
    if (/^https:\/\//i.test(url) && !images.includes(url)) images.push(url);
  }
  const cover = text.match(/<meta property="og:image" content="([^"]+)"/i)?.[1];
  return {
    title,
    date,
    author,
    text: htmlToText(section),
    images: images.slice(0, 3),
    cover: cover ? absolute(base, cover) : "",
    ...sidebar(text),
  };
}

// Rozpis zápasů jednoho týmu. Neodehraný zápas má skóre jen „:“.
export function parseMatchList(html, base) {
  const text = String(html ?? "");
  const competition = plain(text.match(/<span>([^<]*\d{4}\s*\/\s*\d{4})<\/span>/)?.[1]);
  const matches = [];
  for (const match of text.matchAll(/<a href="([^"]+)" class="line-match-item">([\s\S]*?)<\/a>/g)) {
    const block = match[2];
    const teams = [...block.matchAll(/class="match-item-team-name">([\s\S]*?)<\/div>/g)].map((team) => plain(team[1]));
    if (teams.length !== 2) continue;
    const score = plain(block.match(/class="line-match-item-score">([\s\S]*?)<\/div>/)?.[1]);
    const when = plain(block.match(/class="line-match-item-text-col">([\s\S]*?)<\/div>/)?.[1]);
    const url = absolute(base, match[1]);
    if (matches.some((row) => row.url === url)) continue;
    matches.push({
      url,
      round: plain(block.match(/class="line-match-item-title">([\s\S]*?)<\/div>/)?.[1]),
      home: teams[0],
      away: teams[1],
      score: /\d/.test(score) ? score.replace(/\s+/g, "") : "",
      date: czechDate(when),
      time: when.match(/(\d{1,2}:\d{2})/)?.[1] ?? "",
      competition,
    });
  }
  return matches;
}

// Detail zápasu: góly a karty s minutou a sestavy, jako prostý text pro Claude.
export function parseMatchDetail(html) {
  const text = String(html ?? "");
  const events = [];
  for (const match of text.matchAll(/class="md-box-item-num">([^<]*)<\/div>([\s\S]*?)class="md-box-item-player-name">([^<]*)</g)) {
    const kinds = [...match[2].matchAll(/title="([^"]+)"/g)].map((kind) => decodeEntities(kind[1]));
    events.push(`${plain(match[1])} ${kinds.join(", ") || "Událost"}: ${plain(match[3])}`);
  }
  const lineup = [...between(text, "<h3>Sestavy</h3>", "Zpět na rozpis").matchAll(/class="md-player-item-player-name">([^<]*)</g)]
    .map((player) => plain(player[1]))
    .filter(Boolean)
    .join(", ");
  return [events.length ? `Průběh zápasu (jen naše góly a karty):\n${events.join("\n")}` : "", lineup ? `Hráči u zápasu na webu klubu: ${lineup}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

// Co je aktualita zač: zpráva po zápase (má skóre), pozvánka před zápasem (soupeři bez skóre), nebo ostatní.
export function newsKind(title) {
  const text = String(title ?? "");
  if (/\s[-–]\s/.test(text) && /\d+\s*:\s*\d+/.test(text)) return "zapas";
  if (/\s[-–]\s/.test(text) && /kopidlno/i.test(text)) return "pozvanka";
  return "clanek";
}

function folded(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// K aktualitě „Domácí - Hosté 7:6 (3:3)“ najde zápas v rozpisu.
export function findMatch(matches, title) {
  const [home, rest] = String(title ?? "").split(/\s[-–]\s/);
  if (!rest) return null;
  const away = rest.replace(/\s*\d+\s*:\s*\d+[\s\S]*$/, "");
  return matches.find((row) => folded(row.home) === folded(home) && folded(row.away) === folded(away)) ?? null;
}

export function readClubUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return DEFAULT_CLUB_URL;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    return `${parsed.origin}/`;
  } catch {
    return "";
  }
}
