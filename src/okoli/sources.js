// Weby z okolí, ze kterých drbna stahuje program akcí (pro víkendový článek „Kam vyrazit“, později i kalendář).
// Každý zdroj je jedno místo (město) se vzdáleností od Kopidla; okruh v redakci ho podle ní bere, nebo ne.
// `fetchEvents({ env, fetchImpl, known })` vrací { ok, items, listed, seen, complete, warning, error } s položkami
// jako parseKzmj (src/okoli/kzmj.js); co v `known` (guid → stamp) je a nezměnilo se, znovu nečte.
import { anteeReader } from "./antee.js";
import { galileoReader } from "./galileo.js";
import { fetchJicinOrg } from "./jicin-org.js";
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
    km: 15,
    fetchEvents: fetchKzmj,
    // kzmj.cz Cloudflare nepustí (Workerům vrací 500). Stahuje ho úloha na GitHubu a posílá na src/okoli/relay.js;
    // `hosts` jsou domény, na které smí vést odkazy z poslaných akcí.
    relay: true,
    hosts: ["kzmj.cz"],
  },
  {
    tag: "jicinorg",
    name: "Jičín.org",
    title: "kalendář akcí Městského informačního centra Jičín",
    home: "https://www.jicin.org/kalendar-akci",
    town: "Jičín",
    km: 15,
    fetchEvents: fetchJicinOrg,
  },
];

// Obce na Antee: pozvánky z aktualit (src/okoli/antee.js). Nová obec je nový řádek; `about` místo „obce {town}“.
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
  {
    tag: "jicineves",
    name: "Obec Jičíněves",
    title: "aktuality obce Jičíněves",
    home: "https://www.jicineves.cz/",
    feed: "https://www.jicineves.cz/aktuality?action=atom",
    town: "Jičíněves",
    km: 7,
  },
  {
    tag: "vitineves",
    name: "Obec Vitiněves",
    title: "aktuality obce Vitiněves",
    home: "https://www.vitineves.cz/",
    feed: "https://www.vitineves.cz/aktuality?action=atom",
    town: "Vitiněves",
    km: 11,
  },
  {
    tag: "marianskazahrada",
    name: "Mariánská zahrada",
    title: "akce mikroregionu Mariánská zahrada (obce kolem Kopidla)",
    home: "https://www.marianskazahrada.cz/akce-v-mz",
    feed: "https://www.marianskazahrada.cz/akce-v-mz?action=atom",
    // Mikroregion, ne obec: akce bývají v Kopidle i v obcích kolem, místo vytáhne Haiku.
    town: "Mariánská zahrada",
    about: "mikroregionu Mariánská zahrada (Kopidlno a obce kolem: Dětenice, Ostružno, Libáň, Žeretice…)",
    km: 5,
  },
];

for (const town of ANTEE_TOWNS) NEARBY_SOURCES.push({ ...town, fetchEvents: anteeReader(town) });

// Obce na Galileu (oba vzhledy přehledu): akce s termínem a místem (src/okoli/galileo.js), bez modelu. Nová obec je nový řádek.
const GALILEO_TOWNS = [
  {
    tag: "rozdalovice",
    name: "Město Rožďalovice",
    title: "akce ve městě Rožďalovice",
    home: "https://www.rozdalovice.eu/mesto/akce-ve-meste/",
    list: "https://www.rozdalovice.eu/mesto/akce-ve-meste/",
    town: "Rožďalovice",
    km: 9,
  },
  {
    tag: "dymokury",
    name: "Obec Dymokury",
    title: "akce v obci Dymokury",
    home: "https://www.dymokury.cz/cs/zivot-v-obci/akce-v-obci/",
    list: "https://www.dymokury.cz/cs/zivot-v-obci/akce-v-obci/",
    town: "Dymokury",
    km: 12,
  },
];

for (const town of GALILEO_TOWNS) NEARBY_SOURCES.push({ ...town, fetchEvents: galileoReader(town) });

export function nearbySource(tag) {
  return NEARBY_SOURCES.find((source) => source.tag === tag) ?? null;
}
