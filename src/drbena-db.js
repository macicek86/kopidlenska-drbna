// Povaha kozy Drběny v D1. Prázdné pole znamená výchozí text z drbena.js.
import { addColumn, asBool, requireChief } from "./db-core.js";
import { ownFootball, ownPersona } from "./drbena.js";

export async function ensureDrbenaTable(env) {
  await env.DB.prepare(
    `create table if not exists drbena_settings (
      id integer primary key,
      persona text not null default '',
      football text not null default ''
    )`,
  ).run();
  const info = await env.DB.prepare("pragma table_info(drbena_settings)").all();
  // Navazující zprávy (doplnění ke starší zprávě) rovnou na web. Ve výchozím stavu jdou jako návrh.
  await addColumn(
    env,
    new Set((info.results ?? []).map((row) => row.name)),
    "followup_publish",
    "alter table drbena_settings add column followup_publish integer not null default 0",
  );
  if (await env.DB.prepare("select 1 as ok from drbena_settings where id = 1").first()) return;
  // Dřív měl Munipolis i fotbal vlastní pole „Jak Drběna píše“. Vlastní text odtamtud se stane povahou.
  const munipolis = await env.DB.prepare("select voice from import_settings where id = 1").first();
  const football = await env.DB.prepare("select voice from football_settings where id = 1").first();
  const persona = ownPersona(munipolis?.voice) || ownPersona(football?.voice);
  await env.DB.prepare("insert into drbena_settings (id, persona, football) values (1, ?, '')").bind(persona).run();
}

export async function loadDrbena(env) {
  const row = await env.DB.prepare("select persona, football, followup_publish from drbena_settings where id = 1").first();
  return { persona: ownPersona(row?.persona), football: ownFootball(row?.football), followupPublish: asBool(row?.followup_publish) };
}

export async function saveFollowupSetting(env, request, input) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  await env.DB.prepare("update drbena_settings set followup_publish = ? where id = 1").bind(input.followupPublish ? 1 : 0).run();
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
