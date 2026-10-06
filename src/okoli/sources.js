// Weby z okolí, ze kterých drbna stahuje program akcí (pro víkendový článek „Kam vyrazit“, později i kalendář).
// Každý zdroj je jedno místo (město) se vzdáleností od Kopidla; okruh v redakci ho podle ní bere, nebo ne.
// `fetchEvents(options)` vrací { ok, items, error } s položkami jako parseKzmj (src/okoli/kzmj.js).
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

export function nearbySource(tag) {
  return NEARBY_SOURCES.find((source) => source.tag === tag) ?? null;
}
