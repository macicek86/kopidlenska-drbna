// Schéma databáze: založení tabulek, doplnění sloupců a výchozí data.
// Migrace běží jen když verze v tabulce schema_version nesedí se SCHEMA_VERSION. Kdo změní migrace
// (nová tabulka, sloupec, index nebo výchozí data), zvedne SCHEMA_VERSION; test/schema.test.js to hlídá.
import { AD_SEEDS } from "./ads.js";
import { addColumn, IMPORT_ITEM_TABLES } from "./db-core.js";
import { DOCTOR_SEEDS } from "./doctors.js";
import { KOPIDLNO } from "./outages.js";
import { ensurePlaceTables } from "./places-db.js";
import { SEED_RUBRICS } from "./rubrics.js";
import { CLUB_PARENT, CLUBS } from "./clubs.js";
import { ensureNoticeTables } from "./notices-db.js";
import { ensureImportTables } from "./munipolis/store.js";
import { ensureFootballTables } from "./fotbal/store.js";
import { ensureDenikTables } from "./denik/store.js";
import { ensureSkolaTables } from "./skola/store.js";
import { ensureOkoliTables } from "./okoli/store.js";
import { ensureDrbenaTable } from "./drbena-db.js";
import { ensureEventColumns } from "./events-db.js";
import { ensureUserColumns } from "./users-db.js";
import { ensureVisitTables } from "./visits-db.js";
import { ensureStockTables } from "./stock-db.js";
import { ensureChatTables, linkApprovedImports } from "./chat/store.js";
import { ensureAssistTables } from "./assist/store.js";
import { ensureMessageTables } from "./messages-db.js";
import { ensureNdicTables } from "./ndic/store.js";
import { ensureFeedTables } from "./feeds/settings.js";
import { ensureRequestTables } from "./hours-requests-db.js";
import { ensureLinkTables } from "./hours-links-db.js";
import { ensureAuditTables } from "./audit-db.js";
import { ensureLoginTables } from "./login-db.js";
import { ensureNotifyTables } from "./notify.js";
import { ensureSearchTables } from "./search/store.js";
import { ensureMailinTables } from "./mailin/store.js";
import { ensureHealthTables } from "./health/store.js";
import { ensurePushTables } from "./push/store.js";

export const SCHEMA_VERSION = 63;

let schemaReady = false;

async function createDeskTables(env) {
  await env.DB.prepare(
    `create table if not exists users (
      id integer primary key autoincrement,
      login text not null unique,
      name text not null,
      alias text not null default '',
      password_hash text not null,
      role text not null,
      session_token text,
      active integer not null default 1,
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists proposals (
      id integer primary key autoincrement,
      article_id integer,
      author_id integer not null,
      author_name text not null,
      title text not null,
      excerpt text not null,
      body text not null,
      category text not null,
      image_key text,
      submitted_title text not null,
      submitted_excerpt text not null,
      submitted_body text not null,
      submitted_category text not null,
      status text not null default 'pending',
      note text not null default '',
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists user_permissions (
      user_id integer not null,
      code text not null,
      primary key (user_id, code)
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists yards (
      id integer primary key autoincrement,
      name text not null,
      place text not null,
      accepts text not null,
      hours text not null,
      sort_order integer not null default 0,
      published integer not null default 1
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists yard_closures (
      id integer primary key autoincrement,
      yard_id integer not null,
      starts_on text not null,
      ends_on text not null,
      reason text not null,
      created_by integer,
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists doctors (
      id integer primary key autoincrement,
      name text not null,
      specialty text not null,
      place text not null,
      phone text not null default '',
      hours text not null,
      sort_order integer not null default 0,
      published integer not null default 1
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists doctor_changes (
      id integer primary key autoincrement,
      doctor_id integer not null,
      starts_on text not null,
      ends_on text not null,
      note text not null,
      hours text not null,
      created_by integer,
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists ads (
      id integer primary key autoincrement,
      slug text not null unique,
      title text not null,
      body text not null,
      place text not null default '',
      link text not null default '',
      image_key text,
      enabled integer not null default 1,
      sample integer not null default 0,
      author_id integer,
      author_name text not null default '',
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists ad_proposals (
      id integer primary key autoincrement,
      ad_id integer,
      author_id integer not null,
      author_name text not null,
      title text not null,
      body text not null,
      place text not null default '',
      link text not null default '',
      image_key text,
      enabled integer not null default 1,
      status text not null default 'pending',
      note text not null default '',
      created_at text not null default (date('now'))
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists outage_areas (
      id integer primary key autoincrement,
      code text not null unique,
      name text not null,
      enabled integer not null default 1,
      sort_order integer not null default 100
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists outage_feed (
      id integer primary key,
      fetched_at text,
      status text not null default '',
      note text not null default '',
      payload text not null default '[]',
      fetching_at text
    )`,
  ).run();
  await env.DB.prepare(
    `create table if not exists rubrics (
      id integer primary key autoincrement,
      parent_id integer,
      name text not null,
      slug text not null unique,
      sort_order integer not null default 0
    )`,
  ).run();
}

async function ensureArticleColumns(env) {
  const info = await env.DB.prepare("pragma table_info(articles)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "author_id", "alter table articles add column author_id integer");
  await addColumn(env, names, "author_name", "alter table articles add column author_name text not null default ''");
  await addColumn(env, names, "redacted", "alter table articles add column redacted integer not null default 0");
  await addColumn(env, names, "rubric_id", "alter table articles add column rubric_id integer");
  await addColumn(env, names, "image_focus", "alter table articles add column image_focus text not null default ''");
  await addColumn(env, names, "image_caption", "alter table articles add column image_caption text not null default ''");
  // Klíčová slova pro Drběnu (src/keywords.js) a zpráva, na kterou tahle navazuje (doplnění od Drběny).
  await addColumn(env, names, "keywords", "alter table articles add column keywords text not null default ''");
  await addColumn(env, names, "follows_id", "alter table articles add column follows_id integer");
  // Přílohy ze zdroje (jízdní řády, mapy), JSON podle src/attachments.js.
  await addColumn(env, names, "attachments", "alter table articles add column attachments text not null default ''");
  // Hlavní redaktor může svou zprávu podepsat jako koza Drběna; v redakci zůstává vidět, kdo ji napsal.
  await addColumn(env, names, "signed_drbena", "alter table articles add column signed_drbena integer not null default 0");
  // Kdy zpráva vyšla na web (UTC, src/db-core.js publishMoment). Starší zprávy ho nemají, platí pro ně jen den.
  await addColumn(env, names, "published_at", "alter table articles add column published_at text not null default ''");
  // Zdroj zprávy pod čarou (src/article-source.js), dřív byl na konci textu.
  await addColumn(env, names, "source", "alter table articles add column source text not null default ''");
  // Navazuje na návrh, který ještě čeká (fotbal: nedělní na sobotní). Schválením se z něj stane follows_id.
  await addColumn(env, names, "follows_proposal", "alter table articles add column follows_proposal integer");
}

async function ensureProposalColumns(env) {
  const info = await env.DB.prepare("pragma table_info(proposals)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "rubric_id", "alter table proposals add column rubric_id integer");
  await addColumn(env, names, "image_focus", "alter table proposals add column image_focus text not null default ''");
  await addColumn(env, names, "image_caption", "alter table proposals add column image_caption text not null default ''");
  // Datum, se kterým má zpráva po schválení vyjít (import podle data ve zdroji). Prázdné = den schválení.
  await addColumn(env, names, "publish_on", "alter table proposals add column publish_on text not null default ''");
  await addColumn(env, names, "keywords", "alter table proposals add column keywords text not null default ''");
  await addColumn(env, names, "follows_id", "alter table proposals add column follows_id integer");
  await addColumn(env, names, "attachments", "alter table proposals add column attachments text not null default ''");
  await addColumn(env, names, "source", "alter table proposals add column source text not null default ''");
  await addColumn(env, names, "follows_proposal", "alter table proposals add column follows_proposal integer");
}

// Bod výřezu fotky u reklamy, stejně jako u zprávy.
async function ensureAdColumns(env) {
  for (const table of ["ads", "ad_proposals"]) {
    const info = await env.DB.prepare(`pragma table_info(${table})`).all();
    const names = new Set((info.results ?? []).map((row) => row.name));
    await addColumn(env, names, "image_focus", `alter table ${table} add column image_focus text not null default ''`);
  }
}

async function seedRubrics(env) {
  for (const item of SEED_RUBRICS) {
    await env.DB.prepare(
      `insert into rubrics (parent_id, name, slug, sort_order)
       select null, ?, ?, ?
       where not exists (select 1 from rubrics where slug = ?)`,
    )
      .bind(item.name, item.slug, item.sortOrder, item.slug)
      .run();
  }
  for (const item of SEED_RUBRICS) {
    await env.DB.prepare(
      "update articles set rubric_id = (select id from rubrics where slug = ?) where rubric_id is null and category = ?",
    )
      .bind(item.slug, item.name)
      .run();
    await env.DB.prepare(
      "update proposals set rubric_id = (select id from rubrics where slug = ?) where rubric_id is null and category = ?",
    )
      .bind(item.slug, item.name)
      .run();
  }
  await env.DB.prepare(
    `update articles set rubric_id = (select id from rubrics where rubrics.name = articles.category)
     where rubric_id is null and exists (select 1 from rubrics where rubrics.name = articles.category)`,
  ).run();
  await env.DB.prepare(
    `update proposals set rubric_id = (select id from rubrics where rubrics.name = proposals.category)
     where rubric_id is null and exists (select 1 from rubrics where rubrics.name = proposals.category)`,
  ).run();
}

// Podrubriky pro zprávy ze ZŠ a MŠ a ze zahradnické školy (import z webů škol). Bez Komunity budou hlavními rubrikami.
async function seedSchoolRubric(env) {
  await env.DB.prepare(
    `insert into rubrics (parent_id, name, slug, sort_order)
     select (select id from rubrics where slug = 'komunita'), 'Škola', 'skola', 25
     where not exists (select 1 from rubrics where slug = 'skola')`,
  ).run();
  await env.DB.prepare(
    `insert into rubrics (parent_id, name, slug, sort_order)
     select (select id from rubrics where slug = 'komunita'), 'Zahradnická škola', 'zahradnicka-skola', 26
     where not exists (select 1 from rubrics where slug = 'zahradnicka-skola')`,
  ).run();
}

// Rubrika Spolky a pod ní spolky, o kterých Drběna píše ze zpráv školy a Deníku (`src/clubs.js`).
// Kdyby si redakce Spolky založila sama pod jinou adresou, poznají se podle jména.
async function seedClubRubrics(env) {
  await env.DB.prepare(
    `insert into rubrics (parent_id, name, slug, sort_order)
     select null, ?, ?, ?
     where not exists (select 1 from rubrics where slug = ? or name = ?)`,
  )
    .bind(CLUB_PARENT.name, CLUB_PARENT.slug, CLUB_PARENT.sortOrder, CLUB_PARENT.slug, CLUB_PARENT.name)
    .run();
  for (const club of CLUBS) {
    await env.DB.prepare(
      `insert into rubrics (parent_id, name, slug, sort_order)
       select (select id from rubrics where slug = ? or name = ? order by slug = ? desc limit 1), ?, ?, ?
       where not exists (select 1 from rubrics where slug = ?)`,
    )
      .bind(CLUB_PARENT.slug, CLUB_PARENT.name, CLUB_PARENT.slug, club.name, club.slug, club.sortOrder, club.slug)
      .run();
  }
}

// Rubrika pro víkendový článek z akcí v Kopidlně a okolí (src/okoli/weekend.js).
async function seedWeekendRubric(env) {
  await env.DB.prepare(
    `insert into rubrics (parent_id, name, slug, sort_order)
     select null, 'Kam vyrazit', 'kam-vyrazit', 35
     where not exists (select 1 from rubrics where slug = 'kam-vyrazit')`,
  ).run();
}

async function seedDoctors(env) {
  const info = await env.DB.prepare("pragma table_info(settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "doctors_seeded", "alter table settings add column doctors_seeded integer not null default 0");
  const flag = await env.DB.prepare("select doctors_seeded as done from settings where id = 1").first();
  if (Number(flag?.done) === 1) return;
  const count = await env.DB.prepare("select count(*) as n from doctors").first();
  if (Number(count?.n) === 0) {
    for (const doctor of DOCTOR_SEEDS) {
      await env.DB.prepare(
        "insert into doctors (name, specialty, place, phone, hours, sort_order, published) values (?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          doctor.name,
          doctor.specialty,
          doctor.place,
          doctor.phone,
          JSON.stringify(doctor.week),
          doctor.sortOrder,
          doctor.published,
        )
        .run();
    }
  }
  await env.DB.prepare("update settings set doctors_seeded = 1 where id = 1").run();
}

async function seedOutages(env) {
  const info = await env.DB.prepare("pragma table_info(settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "outages_seeded", "alter table settings add column outages_seeded integer not null default 0");
  await env.DB.prepare(
    "insert into outage_feed (id, payload) select 1, '[]' where not exists (select 1 from outage_feed where id = 1)",
  ).run();
  const flag = await env.DB.prepare("select outages_seeded as done from settings where id = 1").first();
  if (Number(flag?.done) === 1) return;
  const count = await env.DB.prepare("select count(*) as n from outage_areas").first();
  if (Number(count?.n) === 0) {
    await env.DB.prepare("insert into outage_areas (code, name, enabled, sort_order) values (?, ?, 1, 0)")
      .bind(KOPIDLNO.code, KOPIDLNO.name)
      .run();
  }
  await env.DB.prepare("update settings set outages_seeded = 1 where id = 1").run();
}

// Texty, jejichž výchozí znění se změnilo. Uložené texty (stránka Texty ukládá všechna pole) se přepíšou,
// jen když je redakce nezměnila, tedy mají pořád staré výchozí znění.
const COPY_RENAMES = [
  ["nav_outages", "Odstávky", "Odstávky a uzavírky"],
  ["home_outages_button", "Odstávky", "Odstávky a uzavírky"],
  ["outages_description", "Kdy v Kopidlně nepoteče voda a kdy nepůjde proud.", "Kdy v Kopidlně nepoteče voda, kdy nepůjde proud a kudy se nedá projet."],
  ["outages_heading", "Odstávky vody a elektřiny", "Odstávky a uzavírky"],
  ["outages_lede", "Kdy v Kopidlně a okolí nepoteče voda a kdy nepůjde proud.", "Kdy v Kopidlně a okolí nepoteče voda, kdy nepůjde proud a kde bude zavřená silnice."],
  ["outages_ask", "Víte o odstávce, která tu chybí?", "Víte o odstávce nebo uzavírce, která tu chybí?"],
  ["about_outages_link", "Odstávky vody a elektřiny", "Odstávky a uzavírky"],
  ["bins_alt", "Koza Drběna v montérkách s popelnicí na kopidlenském náměstí", "Koza Drběna v reflexní pracovní soupravě s koštětem a popelnicí"],
  ["ads_flag", "Reklama", "Reklama od sousedů"],
  ["about_body", "Kopidlenská drbna je sousedský projekt od místních pro místní.\n\nVznikla proto, aby bylo jednodušší zjistit, co se u nás děje, co se chystá, kam vyrazit nebo co by nám nemělo uniknout. Najdete tu praktické informace, pozvánky, zajímavosti i obyčejné sousedské zprávy.\n\nDrbnu provozuje Daniel Meca ve svém volném čase a na vlastní náklady. Není to stránka města, úřadu ani žádné politické strany.\n\nJe to prostě místo, kde si můžeme mezi sebou předávat informace, tipy a novinky z našeho okolí.\n\nMáte něco, co by měli vědět i ostatní? Dejte nám vědět. Drbna je tu pro nás všechny.", "<p>Kopidlenská drbna je sousedský projekt od místních pro místní.</p><p>Vznikla proto, aby bylo jednodušší zjistit, co se u nás děje, co se chystá, kam vyrazit nebo co by nám nemělo uniknout. Najdete tu praktické informace, pozvánky, zajímavosti i obyčejné sousedské zprávy.</p><p>Drbnu provozuje Camledian (Daniel Meca) ve volném čase a na vlastní náklady. Není to stránka města, úřadu ani žádné politické strany.</p><p>Je to prostě místo, kde si můžeme mezi sebou předávat informace, tipy a novinky z našeho okolí.</p>"],
];

async function renameCopy(env) {
  const table = await env.DB.prepare("select name from sqlite_master where type = 'table' and name = 'copy'").first();
  if (!table) return;
  for (const [key, from, to] of COPY_RENAMES) {
    await env.DB.prepare("update copy set value = ? where key = ? and value = ?").bind(to, key, from).run();
  }
}

async function demoImage(env, file) {
  if (!env.ASSETS?.fetch) return null;
  try {
    const response = await env.ASSETS.fetch(new Request(`https://local.invalid/demo-reklamy/${file}`));
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("image/")) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

async function seedAds(env) {
  const info = await env.DB.prepare("pragma table_info(settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  await addColumn(env, names, "ads_seeded", "alter table settings add column ads_seeded integer not null default 0");
  const flag = await env.DB.prepare("select ads_seeded as done from settings where id = 1").first();
  if (Number(flag?.done) === 1) return;
  const count = await env.DB.prepare("select count(*) as n from ads").first();
  if (Number(count?.n) === 0) {
    const chief = await env.DB.prepare(
      "select id, name from users where role = 'hlavni' order by id asc limit 1",
    ).first();
    const authorId = chief?.id ?? null;
    const authorName = chief?.name ? String(chief.name) : "Redakce";
    for (const ad of AD_SEEDS) {
      const bytes = await demoImage(env, ad.image);
      let imageKey = null;
      if (bytes) {
        imageKey = `reklamy/demo-${ad.slug}.webp`;
        await env.BUCKET.put(imageKey, bytes, { httpMetadata: { contentType: "image/webp" } });
      }
      await env.DB.prepare(
        `insert into ads (slug, title, body, place, link, image_key, enabled, sample, author_id, author_name)
         values (?, ?, ?, ?, '', ?, 1, 1, ?, ?)`,
      )
        .bind(ad.slug, ad.title, ad.body, ad.place, imageKey, authorId, authorName)
        .run();
    }
  }
  await env.DB.prepare("update settings set ads_seeded = 1 where id = 1").run();
}

// Výběr položek importu zaškrtáváním skončil (Zkontrolovat teď dělá totéž co cron). Co na výběr čekalo, je přeskočené.
async function retireLoadedItems(env) {
  for (const table of IMPORT_ITEM_TABLES) {
    await env.DB.prepare(`update ${table} set status = 'preskoceno', reason = 'Čekalo na ruční výběr, který už není. Jde pustit v detailu.' where status = 'nacteno'`).run();
  }
}

async function migrateSchema(env) {
  await createDeskTables(env);
  await ensureNoticeTables(env);
  await ensureImportTables(env);
  await ensureFootballTables(env);
  await ensureDenikTables(env);
  await ensureSkolaTables(env);
  await ensureOkoliTables(env);
  await ensureDrbenaTable(env);
  await ensurePlaceTables(env);
  await ensureVisitTables(env);
  await ensureStockTables(env);
  await ensureChatTables(env);
  await ensureAssistTables(env);
  await ensureMessageTables(env);
  await ensureNdicTables(env);
  await ensureFeedTables(env);
  await ensureRequestTables(env);
  await ensureLinkTables(env);
  await ensureAuditTables(env);
  await ensureLoginTables(env);
  await ensureNotifyTables(env);
  await ensureMailinTables(env);
  await ensureHealthTables(env);
  await ensurePushTables(env);
  await retireLoadedItems(env);
  const settingsReady = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'settings'",
  ).first();
  if (settingsReady) {
    await seedDoctors(env);
    await seedOutages(env);
  }
  const usersTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'users'",
  ).first();
  if (usersTable) await ensureUserColumns(env);
  const eventsTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'events'",
  ).first();
  if (eventsTable) await ensureEventColumns(env);
  const settingsTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'settings'",
  ).first();
  if (!settingsTable) return false;
  const articlesTable = await env.DB.prepare(
    "select 1 as ok from sqlite_master where type = 'table' and name = 'articles'",
  ).first();
  if (articlesTable) {
    await ensureArticleColumns(env);
    await ensureSearchTables(env);
    const proposalsTable = await env.DB.prepare(
      "select 1 as ok from sqlite_master where type = 'table' and name = 'proposals'",
    ).first();
    if (proposalsTable) {
      await ensureProposalColumns(env);
      await linkApprovedImports(env);
    }
    await seedRubrics(env);
    await seedSchoolRubric(env);
    await seedClubRubrics(env);
    await seedWeekendRubric(env);
  }
  await env.DB.prepare(
    `insert into users (login, name, password_hash, role)
     select 'redakce', 'Redakce', password_hash, 'hlavni' from settings
     where id = 1 and not exists (select 1 from users)`,
  ).run();
  await ensureAdColumns(env);
  await seedAds(env);
  await renameCopy(env);
  return true;
}

async function storedVersion(env) {
  try {
    const row = await env.DB.prepare("select version from schema_version where id = 1").first();
    return Number(row?.version ?? 0);
  } catch {
    // Tabulka ještě není (nová nebo starší databáze).
    return 0;
  }
}

async function saveVersion(env) {
  await env.DB.prepare("create table if not exists schema_version (id integer primary key, version integer not null)").run();
  await env.DB.prepare(
    "insert into schema_version (id, version) values (1, ?) on conflict(id) do update set version = excluded.version",
  )
    .bind(SCHEMA_VERSION)
    .run();
}

// Kontrola schématu jednou za instanci Workeru: když verze v databázi sedí, stačí jeden dotaz.
// Každý požadavek ji dělá sám, dokud jednou celá neproběhne.
// Nesdílet rozběhnutý slib mezi požadavky: když se požadavek, který ho spustil, zruší (zavřená stránka,
// obnovení), Cloudflare zruší i jeho dotazy, slib se nikdy nedokončí a všechny další požadavky by visely.
export async function ensureSchema(env) {
  if (schemaReady) return;
  if ((await storedVersion(env)) === SCHEMA_VERSION) {
    schemaReady = true;
    return;
  }
  if (!(await migrateSchema(env))) return;
  await saveVersion(env);
  schemaReady = true;
}
