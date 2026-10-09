// Předvýběr úřední desky: nadpisy, které nejsou usnesení ani zápis (`screen` z `deska.js`), napřed přečte Haiku
// a řekne, jestli je to pro sousedy zajímavé (anketa, volby, osadní výbory, doprava, vyhlášky). Posuzuje jen nové
// nadpisy, každý jednou: zamítnutý se uloží jako přeskočený s důvodem a redakce ho může v detailu pustit.
import { callClaude } from "../claude.js";

const MAX_TITLES = 20;

const RULES = `Dostaneš nadpisy oznámení z úřední desky města Kopidlna. Pro každé řekni, jestli by o něm měla psát místní zpravodajská stránka pro obyvatele Kopidlna a okolních částí (Pševes, Drahoraz, Mlýnec…).

Zajímavé (interesting = true): ankety a hlasování, volby a volební komise, osadní výbory, veřejná projednání, vyhlášky a nařízení města, změny dopravy, uzavírky, omezení provozu, dotace, nábory pracovníků města, změny v katastru a mapování, cokoli, co se týká obyvatel nebo jejich majetku, bezpečnosti a každodenního života ve městě.

Nezajímavé (interesting = false): dražby a exekuce cizích lidí, rozpočtová opatření a závěrečné účty, oznámení jiných úřadů o věcech daleko odsud, čistě formální a opakující se oznámení bez dopadu na sousedy.

Když si nejsi jistý, rozhodni se pro true. reason je jedna krátká česká věta.`;

function schema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "interesting", "reason"],
          properties: { ref: { type: "string" }, interesting: { type: "boolean" }, reason: { type: "string" } },
        },
      },
    },
  };
}

export async function askScreen(env, titles) {
  const text = titles.map((title, index) => `[${index}] ${title}`).join("\n");
  const answer = await callClaude(env, { system: RULES, content: [{ type: "text", text }], schema: schema(), cheap: true });
  if (!answer.ok) return answer;
  const found = new Map();
  for (const item of Array.isArray(answer.raw?.items) ? answer.raw.items : []) {
    found.set(String(item?.ref ?? "").trim(), { interesting: item?.interesting !== false, reason: String(item?.reason ?? "").trim() });
  }
  return { ok: true, found };
}

// Vrací položky k uložení: zajímavé bez příznaku, zamítnuté jako přeskočené. Co model neposoudil nebo když selže,
// se tentokrát vynechá a zkusí se to při dalším stažení.
export async function screenDesk(env, source, items, { ask = askScreen } = {}) {
  const candidates = items.filter((item) => item.screen);
  if (!candidates.length) return items;
  const guids = candidates.map((item) => item.guid);
  const known = await env.DB.prepare(`select guid from ${source.itemsTable} where guid in (${guids.map(() => "?").join(",")})`)
    .bind(...guids)
    .all();
  const seen = new Set((known.results ?? []).map((row) => row.guid));
  const fresh = candidates.filter((item) => !seen.has(item.guid)).slice(0, MAX_TITLES);
  const answer = fresh.length ? await ask(env, fresh.map((item) => item.title)) : { ok: true, found: new Map() };
  const keep = items.filter((item) => !item.screen);
  fresh.forEach((item, index) => {
    const verdict = answer.ok ? answer.found.get(String(index)) : null;
    if (!verdict) return;
    const { screen, ...rest } = item;
    keep.push(
      verdict.interesting
        ? rest
        : { ...rest, status: "preskoceno", reason: `Podle nadpisu nezajímavé pro sousedy: ${verdict.reason}`.slice(0, 400) },
    );
  });
  return keep;
}
