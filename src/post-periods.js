// Odeslání formuláře s více obdobími (src/periods.js): každé období je jedna změna, zapisují se po jedné stejnou
// cestou jako dřív (rovnou, nebo ke schválení podle oprávnění). Nejdřív se zkontrolují všechna, ať se nezapíše půlka.
import { redirect, withError } from "./http.js";
import { buildPeriods, changeFields } from "./periods.js";

// Změny k zápisu z formuláře: { inputs: [vstup akce], items } nebo { error }.
// `regular` je běžný týden řádku, `shape` "week2" (místa, lékaři) nebo "week1" (dvory).
export function periodInputs({ section, actions, action = "zmena", idField, targetId, periods, regular, shape }) {
  const built = buildPeriods(periods, { regular, shape });
  if (built.error) return { error: built.error };
  const inputs = built.items.map((item) => ({ ...changeFields(section, item), [idField]: targetId }));
  for (const [index, input] of inputs.entries()) {
    const value = actions[action].read(input);
    if (value.error) return { error: `Období ${built.items[index].index}: ${value.error}` };
  }
  return { inputs, items: built.items };
}

// `save(input)` zapíše jednu změnu a vrátí { ok, requested, error }. Vrací přesměrování jako ostatní formuláře.
export async function submitPeriods({ base, back = base, okKey, manyKey = okKey, save, ...rest }) {
  const prepared = periodInputs(rest);
  if (prepared.error) return redirect(withError(back, prepared.error));
  let requested = false;
  for (const input of prepared.inputs) {
    const result = await save(input);
    if (!result.ok) return redirect(withError(back, result.error));
    if (result.requested) requested = true;
  }
  return redirect(`${base}?ok=${requested ? "zadost" : prepared.inputs.length > 1 ? manyKey : okKey}`);
}
