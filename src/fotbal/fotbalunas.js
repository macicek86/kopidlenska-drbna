// fotbalunas.cz: oficiální rozpis a výsledky soutěží (převzaté z FAČR). Když se klub v aktualitě splete, platí tohle.
// Jen rozbor stránek, bez sítě, ať jde testovat.
import { decodeEntities } from "../munipolis/feed.js";
import { folded } from "./club.js";

export const DEFAULT_TRUTH_URL = "https://fotbalunas.cz/klub/1673";
export const OFFICIAL_PREFIX = "Oficiálně (fotbalunas.cz):";
const MAX_COMPETITIONS = 4;
// Jak daleko od oficiálního data ještě datum v textu patří k témuž zápasu.
const NEAR_DAYS = 3;
// Jak daleko od data aktuality smí být zápas, když se páruje bez písmene rezervy.
const LOOSE_DAYS = 7;

function plain(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Prázdná adresa ověřování vypíná. Jinak jen stránka klubu na fotbalunas.cz.
export function readTruthUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, url: "" };
  const match = text.match(/^https:\/\/(?:www\.)?fotbalunas\.cz\/klub\/(\d+)\/?(?:[?#].*)?$/i);
  if (!match) return { ok: false, error: "Na fotbalunas.cz zadejte stránku klubu, třeba https://fotbalunas.cz/klub/1673." };
  return { ok: true, url: `https://fotbalunas.cz/klub/${match[1]}` };
}

// Ze stránky klubu odkazy na rozlosování soutěží, ve kterých hrají jeho týmy.
export function competitionLinks(html) {
  const ids = new Set();
  for (const match of String(html ?? "").matchAll(/href="\/soutez\/(\d+)\/?"/g)) ids.add(match[1]);
  return [...ids].slice(0, MAX_COMPETITIONS).map((id) => `https://fotbalunas.cz/rozlosovani/soutez/${id}`);
}

// Tabulka soutěže, ze které je rozlosování.
export function tableUrl(fixturesUrl) {
  const id = String(fixturesUrl ?? "").match(/\/soutez\/(\d+)/)?.[1];
  return id ? `https://fotbalunas.cz/tabulky/soutez/${id}` : "";
}

// Celá tabulka soutěže jako řádky „6. FK Kopidlno C 7 19:33 6“ (pořadí, tým, zápasy, skóre, body), stejně jako z webu klubu.
export function parseTable(html) {
  const table = String(html ?? "").match(/<table[^>]*>(?:(?!<\/table>)[\s\S])*?>Tým<[\s\S]*?<\/table>/)?.[0] ?? "";
  const lines = [];
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => plain(cell[1]));
    if (cells.length < 7 || !/^\d+$/.test(cells[0])) continue;
    lines.push(`${cells[0]}. ${cells[1]} ${cells[2]} ${cells[6]} ${cells[7] ?? ""}`.trim());
  }
  return lines.join("\n");
}

// Tým Kopidla v zápase (domácí, nebo hosté).
export function ourTeam(official) {
  if (!official) return "";
  return [official.home, official.away].find((name) => folded(name).includes("kopidlno")) ?? "";
}

// Je tým v tabulce? Řádek „4. FK Kopidlno B 7 27:21 12“.
export function inTable(table, team) {
  if (!team) return false;
  return String(table ?? "")
    .split("\n")
    .some((line) => sameTeam(team, line.replace(/^\d+\.\s*/, "").replace(/\s+\d+\s+\d+:\d+\s+\d+\s*$/, "")));
}

// „13.09.“ v sezóně 2026-2027: podzim patří k prvnímu roku, jaro k druhému.
function seasonDate(text, season) {
  const match = String(text ?? "").match(/(\d{1,2})\.(\d{1,2})\./);
  if (!match || !season) return "";
  const month = Number(match[2]);
  const year = month >= 7 ? season[0] : season[1];
  return `${year}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

// Zápasy z rozlosování soutěže (`source` je jeho adresa, podle ní se pak najde tabulka). `team` omezí výběr na zápasy, kde je to slovo v názvu (stránka je velká, ať se zbytečně nerozebírá).
export function parseFixtures(html, { team = "kopidlno", source = "" } = {}) {
  const text = String(html ?? "");
  const seasonMatch = text.match(/<h2[^>]*>\s*(\d{4})-(\d{4})\s*<\/h2>/);
  const season = seasonMatch ? [Number(seasonMatch[1]), Number(seasonMatch[2])] : null;
  const fixtures = [];
  for (const row of text.split("match-item border-0").slice(1)) {
    const names = row.match(/zapas-item-utkani[\s\S]*?<a href="(\/zapas\/\d+\/)"[^>]*>([\s\S]*?)<\/a>/);
    if (!names || !folded(names[2]).includes(team)) continue;
    const [home, away] = plain(names[2]).split(/\s+-\s+/);
    if (!away) continue;
    const result = plain(row.match(/zapas-item-vysledek[\s\S]*?<\/td>/)?.[0]);
    const when = result.match(/(\d{1,2}\.\d{1,2}\.)\s*(\d{1,2}:\d{2})?/);
    const score = result.replace(when?.[0] ?? "", "").match(/(\d+):(\d+)(?:\s*\((\d+:\d+)\))?/);
    fixtures.push({
      url: `https://fotbalunas.cz${names[1]}`,
      home,
      away,
      date: seasonDate(when?.[1], season),
      time: when?.[2] ?? "",
      score: score ? `${score[1]}:${score[2]}` : "",
      half: score?.[3] ?? "",
      cancelled: /zrušen/i.test(result),
      source,
    });
  }
  return fixtures;
}

// Střelci z detailu zápasu: domácí mají jméno a minutu, hosté minutu a jméno.
export function parseOfficialGoals(html) {
  const text = String(html ?? "");
  const from = text.indexOf("zapas-info");
  const box = from < 0 ? "" : text.slice(from, text.indexOf("match-result-subinfo", from) + 2000);
  const sides = [...box.matchAll(/<div class="col-3">([\s\S]*?)<\/div>\s*<\/div>/g)].map((side) => side[1]);
  const goals = (side) =>
    side
      .split(/<br\s*\/?>/i)
      .map((goal) => {
        const name = plain(goal.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
        const minute = plain(goal.replace(/<a[\s\S]*?<\/a>/, "")).match(/\d+/)?.[0];
        return name ? `${minute ? `${minute}' ` : ""}${name}` : "";
      })
      .filter(Boolean);
  return { home: goals(sides[0] ?? ""), away: goals(sides[1] ?? "") };
}

function words(name) {
  return folded(name).split(" ").filter(Boolean);
}

// Rezerva týmu (B, C…). Bez písmena je to áčko.
function reserve(list) {
  const last = list.at(-1) ?? "";
  return /^[a-d]$/.test(last) ? last : "a";
}

// „Železnice B“ nebo „St. Paka“ z fotbalunas je tentýž tým jako „TJ Sokol Železnice B“ a „TJ SOKOL Stará Paka“ z webu klubu.
// `anyReserve` nehlídá písmeno rezervy (klub občas píše „SK Miletín“ místo „Miletín B“ nebo splete své béčko s céčkem).
export function sameTeam(short, full, { anyReserve = false } = {}) {
  const a = words(short);
  const b = words(full);
  if (!a.length || (!anyReserve && reserve(a) !== reserve(b))) return false;
  const core = (list) => list.filter((word, index) => !(index === list.length - 1 && /^[a-d]$/.test(word)));
  const rest = core(b);
  return core(a).every((word) => rest.some((other) => other.startsWith(word)));
}

function dayNumber(date) {
  return Date.parse(`${date}T12:00:00Z`) / 86_400_000;
}

export function daysApart(a, b) {
  return Math.abs(dayNumber(a) - dayNumber(b));
}

// Oficiální zápas k aktualitě podle domácích a hostů. Když je jich víc (pohár), vezme ten nejblíž k `near`.
// Když se přesně nenajde, stačí kluby bez písmene rezervy, ale jen jediný zápas pár dní od `near`.
export function findOfficial(fixtures, home, away, near = "") {
  const rows = (fixtures ?? []).filter((row) => row.date);
  const found = rows.filter((row) => sameTeam(row.home, home) && sameTeam(row.away, away));
  if (found.length) {
    if (found.length < 2 || !near) return found[0];
    return found.reduce((best, row) => (daysApart(row.date, near) < daysApart(best.date, near) ? row : best));
  }
  if (!near) return null;
  const loose = rows.filter(
    (row) => daysApart(row.date, near) <= LOOSE_DAYS && sameTeam(row.home, home, { anyReserve: true }) && sameTeam(row.away, away, { anyReserve: true }),
  );
  return loose.length === 1 ? loose[0] : null;
}

// Řádek do podkladů pro Drběnu. Začíná `OFFICIAL_PREFIX`, podle toho ho najde kontrola dat.
export function officialLine(official, goals = null) {
  if (!official) return "";
  const state = official.cancelled
    ? "zrušeno"
    : official.score
      ? `výsledek ${official.score}${official.half ? ` (${official.half})` : ""}`
      : "ještě se nehrálo";
  const line = `${OFFICIAL_PREFIX} ${official.home} – ${official.away}, ${official.date}${official.time ? ` ${official.time}` : ""}, ${state}`;
  const scorers = [
    goals?.home?.length ? `domácí ${goals.home.join(", ")}` : "",
    goals?.away?.length ? `hosté ${goals.away.join(", ")}` : "",
  ].filter(Boolean);
  return scorers.length ? `${line}\nGóly podle fotbalunas.cz: ${scorers.join("; ")}` : line;
}

// Oficiální údaje zpátky z podkladů (ukládají se jako text u aktuality).
export function officialFromExtra(extra) {
  const match = String(extra ?? "").match(/^Oficiálně \(fotbalunas\.cz\): ([^\n]+?) – ([^\n]+?), (\d{4}-\d{2}-\d{2})(?: \d{1,2}:\d{2})?, ([^\n]*)$/m);
  if (!match) return null;
  return {
    home: match[1],
    away: match[2],
    date: match[3],
    score: match[4].match(/^výsledek (\d+:\d+)/)?.[1] ?? "",
    cancelled: match[4] === "zrušeno",
  };
}

export function nearOfficial(date, official) {
  return Boolean(date && official?.date && daysApart(date, official.date) <= NEAR_DAYS);
}
