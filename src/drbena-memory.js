// Paměť Drběny: v článku z importu smí jednou větou navázat na související zprávu z přehledu (stejné místo, stavba,
// spolek), na odstávku nebo uzavírku, která pořád trvá, a vzpomenout na akci, na které nedávno byla. Vypínač je na stránce Koza Drběna (drbena_settings.memory).
// Na každou akci vzpomene jen jednou: značku vrací v article.recall a uložení článku akci označí (events.recalled).

import { addDays } from "./waste.js";

// Za kolik dní zpátky se akce počítá jako nedávná.
export const RECALL_DAYS = 7;

export const MEMORY_RULES = `Drběna si pamatuje, co se v Kopidlně děje:
- Když je v přehledu zpráva o související věci (stejné místo, stejná stavba nebo oprava, stejný spolek), ale nejde o duplicitu ani doplnění, smíš na ni v článku navázat jednou krátkou větou, třeba „Sotva si Drběna zvykla na bagry na náměstí, je tu další novinka.“ Ber z ní jen to, co stojí v nadpisu a perexu, a jen když si souvislostí jsi jistá. Na zprávu starší než rok (třeba z oddílu Možná souvisí) navaž jen u téže věci: stejná akce o rok později, stejná stavba („Loni na drakiádě…“).
- Když podle přehledu dnes pořád platí odstávka vody nebo uzavírka a k článku se hodí (stejné místo, cesta na akci, o které píšeš), smíš ji jednou větou připomenout, třeba „V Ledkově pořád neteče voda, ale Drběna…“. Jen podle dat a míst z přehledu.
- V přehledu jsou i akce, které nedávno proběhly. Drběna na nich byla. Když se to k článku hodí, smíš na jednu vzpomenout v úvodní větě o Drběně (třeba „Drběna se sotva vrátila z drakiády…“). O průběhu akce si nic nevymýšlej (kolik lidí přišlo, jak to dopadlo, jaké bylo počasí), jen že tam byla a co cítí. Značku té akce dej do article.recall, třeba "akce:12". Když na žádnou akci nevzpomínáš, nech article.recall prázdné.
- Nanejvýš jedna taková věta na článek. U vážných zpráv (úmrtí, nehody, nemoci) žádná. Když se nic nehodí, nevzpomínej. Raději méně často než pokaždé.`;

// Paměť jen u článku s dnešním datem: zpráva zpětně datovaná podle zdroje by vzpomínala na akci, která tehdy ještě nebyla.
export function memoryOn(drbena, publishOn, today) {
  return Boolean(drbena?.memory) && (!publishOn || publishOn >= today);
}

export function withMemory(voice, on) {
  return on ? `${voice}\n\n${MEMORY_RULES}` : voice;
}

export function readRecall(value) {
  const ref = String(value ?? "").trim();
  return /^akce:\d+$/.test(ref) ? ref : "";
}

// Akce z posledních dní, na které Drběna ještě nevzpomínala.
export async function recentEvents(env, today) {
  const result = await env.DB.prepare(
    `select id, title, place, starts_on from events
     where starts_on < ? and starts_on >= ? and recalled = 0 and cancelled = 0 order by starts_on desc limit 10`,
  )
    .bind(today, addDays(today, -RECALL_DAYS))
    .all();
  return (result.results ?? []).map((row) => ({ id: Number(row.id), title: String(row.title), place: String(row.place ?? ""), startsOn: String(row.starts_on) }));
}

export async function markRecalled(env, ref) {
  const id = Number(readRecall(ref).slice(5));
  if (id) await env.DB.prepare("update events set recalled = 1 where id = ?").bind(id).run();
}
