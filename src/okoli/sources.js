// Weby z okolí, ze kterých drbna stahuje program akcí (pro víkendový článek „Kam vyrazit“, později i kalendář).
// Každý zdroj je jedno místo (město) se vzdáleností od Kopidla; okruh v redakci ho podle ní bere, nebo ne.
// `fetchEvents({ env, fetchImpl, known })` vrací { ok, items, listed, seen, complete, warning, error } s položkami
// jako parseKzmj (src/okoli/kzmj.js); co v `known` (guid → stamp) je a nezměnilo se, znovu nečte.
import { anteeReader } from "./antee.js";
import { fetchKzmj } from "./kzmj.js";

export const NEARBY_SOURCES = [
  {
    tag: "kzmj",
    name: "KZMJ Jičín",
    // Celé jméno pro redakci a odkaz pod článkem.
    title: "Kulturní zařízení města Jičína",
    home: "https://kzmj.cz/",
    town: "Jičín",
    // Po silnici z Kopidla.
    km: 13,
    fetchEvents: fetchKzmj,
  },
];

// Obce na Antee: pozvánky z aktualit (src/okoli/antee.js). Nová obec je nový řádek.
const ANTEE_TOWNS = [
  {
    tag: "liban",
    name: "Město Libáň",
    title: "aktuality města Libáň",
    home: "https://www.mestoliban.cz/",
    feed: "https://www.mestoliban.cz/aktuality?action=atom",
    town: "Libáň",
    km: 8,
  },
];

for (const town of ANTEE_TOWNS) NEARBY_SOURCES.push({ ...town, fetchEvents: anteeReader(town) });

export function nearbySource(tag) {
  return NEARBY_SOURCES.find((source) => source.tag === tag) ?? null;
}
