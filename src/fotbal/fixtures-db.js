// Rozpis zápasů FK Kopidlno z fotbalunas.cz uložený pro Drbnu samotnou (ne do kalendáře akcí na webu).
// Plní ho každé stažení fotbalu (`saveFixtures`), čte ho zatím víkendový článek Kam vyrazit (`loadHomeFixtures`).
import { folded } from "./club.js";

export const FIXTURE_TABLES = [
  `create table if not exists football_fixtures (
    url text primary key,
    source text not null default '',
    home text not null,
    away text not null,
    team text not null default '',
    at_home integer not null default 0,
    played_on text not null,
    played_time text not null default '',
    score text not null default '',
    cancelled integer not null default 0,
    seen_at text not null default ''
  )`,
  "create index if not exists football_fixtures_day on football_fixtures (played_on)",
];

// Zápasy starší než tohle se mažou, sezóna se nehromadí.
const KEEP_DAYS = 90;
const BATCH = 40;

// Který z týmů je kopidlenský a hrajeme doma? Doma je ten, kdo je v rozpisu první.
export function fixtureSides(fixture) {
  const isOurs = (name) => folded(name).includes("kopidlno");
  const atHome = isOurs(fixture.home);
  return { team: atHome ? fixture.home : isOurs(fixture.away) ? fixture.away : "", atHome };
}

// Uloží přečtený rozpis (přepíše čas, zrušení a skóre). Zápas, který ze stránky soutěže zmizel, se smaže.
// Prázdný rozpis (web neodpověděl) nic nemění. Vrací počet uložených zápasů.
export async function saveFixtures(env, fixtures, now = new Date()) {
  const rows = (fixtures ?? []).filter((fixture) => fixture.url && fixture.date && fixture.home && fixture.away);
  if (!rows.length) return 0;
  const stamp = now.toISOString();
  const upsert = env.DB.prepare(
    `insert into football_fixtures (url, source, home, away, team, at_home, played_on, played_time, score, cancelled, seen_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(url) do update set source = excluded.source, home = excluded.home, away = excluded.away, team = excluded.team,
       at_home = excluded.at_home, played_on = excluded.played_on, played_time = excluded.played_time, score = excluded.score,
       cancelled = excluded.cancelled, seen_at = excluded.seen_at`,
  );
  const statements = rows.map((fixture) => {
    const { team, atHome } = fixtureSides(fixture);
    return upsert.bind(
      fixture.url,
      fixture.source ?? "",
      fixture.home,
      fixture.away,
      team,
      atHome ? 1 : 0,
      fixture.date,
      fixture.time ?? "",
      fixture.score ?? "",
      fixture.cancelled ? 1 : 0,
      stamp,
    );
  });
  for (let i = 0; i < statements.length; i += BATCH) await env.DB.batch(statements.slice(i, i + BATCH));
  const sources = [...new Set(rows.map((fixture) => fixture.source ?? ""))];
  const gone = env.DB.prepare("delete from football_fixtures where source = ? and seen_at < ?");
  await env.DB.batch(sources.map((source) => gone.bind(source, stamp)));
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  await env.DB.prepare("delete from football_fixtures where played_on < ?").bind(cutoff).run();
  return rows.length;
}

function mapFixture(row) {
  return {
    url: String(row.url),
    home: String(row.home),
    away: String(row.away),
    team: String(row.team ?? ""),
    atHome: Number(row.at_home) === 1,
    date: String(row.played_on),
    time: String(row.played_time ?? ""),
    score: String(row.score ?? ""),
    cancelled: Number(row.cancelled) === 1,
  };
}

// Domácí zápasy v Kopidlně v období od–do (včetně), které se ještě nehrály a nejsou zrušené.
export async function loadHomeFixtures(env, from, to) {
  const rows = await env.DB.prepare(
    `select url, home, away, team, at_home, played_on, played_time, score, cancelled from football_fixtures
     where at_home = 1 and cancelled = 0 and score = '' and played_on >= ? and played_on <= ?
     order by played_on, played_time`,
  )
    .bind(from, to)
    .all();
  return (rows.results ?? []).map(mapFixture);
}
