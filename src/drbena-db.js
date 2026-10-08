// Povaha kozy Drběny v D1. Prázdné pole znamená výchozí text z drbena.js.
import { addColumn, asBool, requireChief } from "./db-core.js";
import { ownFootball, ownPersona } from "./drbena.js";
import { readPublishTime } from "./publish-time.js";
import { GAP_BOUNDS, SPREAD_DEFAULTS } from "./publish-queue.js";

export async function ensureDrbenaTable(env) {
  await env.DB.prepare(
    `create table if not exists drbena_settings (
      id integer primary key,
      persona text not null default '',
      football text not null default ''
    )`,
  ).run();
  const info = await env.DB.prepare("pragma table_info(drbena_settings)").all();
  const names = new Set((info.results ?? []).map((row) => row.name));
  // Navazující zprávy (doplnění ke starší zprávě) rovnou na web. Ve výchozím stavu jdou jako návrh.
  await addColumn(
    env,
    names,
    "followup_publish",
    "alter table drbena_settings add column followup_publish integer not null default 0",
  );
  // Paměť: navázat na související zprávu a vzpomenout na nedávnou akci (src/drbena-memory.js). Ve výchozím stavu zapnutá.
  await addColumn(
    env,
    names,
    "memory",
    "alter table drbena_settings add column memory integer not null default 1",
  );
  // Fronta zveřejnění (src/publish-queue.js): automatické zprávy s rozestupem a jen v denní době.
  const spread = SPREAD_DEFAULTS;
  await addColumn(env, names, "spread", "alter table drbena_settings add column spread integer not null default 1");
  await addColumn(env, names, "spread_from", `alter table drbena_settings add column spread_from text not null default '${spread.from}'`);
  await addColumn(env, names, "spread_to", `alter table drbena_settings add column spread_to text not null default '${spread.to}'`);
  await addColumn(env, names, "spread_min", `alter table drbena_settings add column spread_min integer not null default ${spread.gapMin}`);
  await addColumn(env, names, "spread_max", `alter table drbena_settings add column spread_max integer not null default ${spread.gapMax}`);
  if (await env.DB.prepare("select 1 as ok from drbena_settings where id = 1").first()) return;
  // Dřív měl Munipolis i fotbal vlastní pole „Jak Drběna píše“. Vlastní text odtamtud se stane povahou.
  const munipolis = await env.DB.prepare("select voice from import_settings where id = 1").first();
  const football = await env.DB.prepare("select voice from football_settings where id = 1").first();
  const persona = ownPersona(munipolis?.voice) || ownPersona(football?.voice);
  await env.DB.prepare("insert into drbena_settings (id, persona, football) values (1, ?, '')").bind(persona).run();
}

export async function loadDrbena(env) {
  const row = await env.DB.prepare(
    "select persona, football, followup_publish, memory, spread, spread_from, spread_to, spread_min, spread_max from drbena_settings where id = 1",
  ).first();
  return {
    persona: ownPersona(row?.persona),
    football: ownFootball(row?.football),
    followupPublish: asBool(row?.followup_publish),
    memory: row ? asBool(row.memory) : true,
    spread: readSpread(row),
  };
}

function readSpread(row) {
  if (!row) return SPREAD_DEFAULTS;
  return {
    on: asBool(row.spread),
    from: readPublishTime(row.spread_from) || SPREAD_DEFAULTS.from,
    to: readPublishTime(row.spread_to) || SPREAD_DEFAULTS.to,
    gapMin: Number(row.spread_min) || SPREAD_DEFAULTS.gapMin,
    gapMax: Number(row.spread_max) || SPREAD_DEFAULTS.gapMax,
  };
}

// Nastavení fronty zveřejnění z formuláře: { ok, spread } nebo { ok: false, error }.
export function readSpreadInput(input) {
  const from = readPublishTime(input.spreadFrom);
  const to = readPublishTime(input.spreadTo);
  if (!from || !to) return { ok: false, error: "Napište čas jako 7:00." };
  if (from >= to) return { ok: false, error: "Konec dne musí být později než začátek." };
  const gapMin = Number(input.spreadMin);
  const gapMax = Number(input.spreadMax);
  const inBounds = (value) => Number.isInteger(value) && value >= GAP_BOUNDS.min && value <= GAP_BOUNDS.max;
  if (!inBounds(gapMin) || !inBounds(gapMax)) return { ok: false, error: `Rozestup musí být v celých minutách od ${GAP_BOUNDS.min} do ${GAP_BOUNDS.max}.` };
  if (gapMin > gapMax) return { ok: false, error: "Nejkratší rozestup nesmí být delší než nejdelší." };
  return { ok: true, spread: { on: Boolean(input.spread), from, to, gapMin, gapMax } };
}

export async function saveSpreadSetting(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const read = readSpreadInput(input);
  if (!read.ok) return read;
  const { on, from, to, gapMin, gapMax } = read.spread;
  await env.DB.prepare("update drbena_settings set spread = ?, spread_from = ?, spread_to = ?, spread_min = ?, spread_max = ? where id = 1")
    .bind(on ? 1 : 0, from, to, gapMin, gapMax)
    .run();
  return { ok: true };
}

export async function saveFollowupSetting(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update drbena_settings set followup_publish = ? where id = 1").bind(input.followupPublish ? 1 : 0).run();
  return { ok: true };
}

export async function saveMemorySetting(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update drbena_settings set memory = ? where id = 1").bind(input.memory ? 1 : 0).run();
  return { ok: true };
}

export async function saveDrbena(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update drbena_settings set persona = ?, football = ? where id = 1")
    .bind(ownPersona(input.persona), ownFootball(input.football))
    .run();
  return { ok: true };
}
