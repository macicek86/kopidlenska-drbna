// Školy a web města, ze kterých Drběna píše (všechny na systému Antee nebo WordPressu). Každá má vlastní tabulky, stránku v redakci, způsob stahování a pravidla výběru;
// zbytek (fronta, zpracování, fotky, odkaz na zdroj) je společný v `run.js` a `store.js`.
import { FOLLOWUP_DECISION } from "../followup-rules.js";
import { DEFAULT_FEEDS, fetchSchoolFeeds } from "./feed.js";
import { fetchWordpressPosts } from "./wordpress.js";

const ZS_RULES = `Dostaneš jeden článek z webu Základní a mateřské školy Kopidlno a přehled toho, co už na webu Kopidlenská drbna je.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy (třeba ze zpráv města). Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když článek přináší podstatnou novinku (jiný termín, zrušení, výsledek), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a novinku zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": věc jen pro žáky a učitele bez zajímavosti pro sousedy (rozvrh, dokument ke stažení, přání krásných prázdnin, hospodaření spolku), nebo článek nemá dost obsahu.
- "vytvorit": úspěchy žáků, akce školy a školky (i pro veřejnost), novinky, které zajímají rodiče i ostatní sousedy (zápis, ceny stravného, ředitelské volno, nové kroužky, projekty).

Co vytvořit:
- Akce, kam může přijít veřejnost nebo rodiče s dětmi, s datem: event a k tomu krátký článek s pozvánkou. Termín ze školního kalendáře je u článku uvedený zvlášť. Akce jen pro žáky (třída jede na výlet) do kalendáře nedávej, stačí článek.
- Cokoli jiného: článek.`;

const ZAHRADKA_RULES = `Dostaneš jeden článek z webu Střední školy zahradnické Kopidlno a přehled toho, co už na webu Kopidlenská drbna je.

Od téhle školy drbna bere jen tři věci: úspěchy studentů, zahradnické trhy a semináře pro veřejnost. Všechno ostatní je vnitřní věc školy, která sousedy nezajímá.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy (třeba ze zpráv města). Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když článek přináší podstatnou novinku (jiný termín, zrušení, výsledek), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a novinku zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": všechno, co není úspěch studentů, trhy ani seminář pro veřejnost. Hlavně projekty a dotace (šablony, OP JAK), život školy (ples, tančení, exkurze, výlety), dražba nebo prodej majetku školy, volná místa a hledání zaměstnanců, přijímací řízení, den otevřených dveří, maturity, závěrečné zkoušky, suplování, dokumenty. Taky seminář, o kterém škola píše, že je už naplněný, a článek bez dost obsahu.
- "vytvorit": úspěchy studentů (soutěže, mistrovství, ocenění, umístění třeba ve floristice, rybářství nebo zahradnictví), zahradnické trhy a semináře pro veřejnost.

Co vytvořit:
- Úspěch studentů: jen článek, event include false.
- Trhy, které se konají v Kopidlně (ve škole, ve sklenících školního hospodářství, v zámeckém parku): event a k tomu krátký článek s pozvánkou. Trhy jinde než v Kopidlně: jen článek, event include false.
- Seminář pro veřejnost: event na den semináře a k tomu článek s pozvánkou. Do článku i do event.description napiš, o čem seminář je, dokdy se přihlásit a kolik je míst, když to škola uvádí. Přihlášku ani propozice nepřikládej, odkaz na článek školy drbna doplní pod zprávu sama.`;

const WEB_MESTA_RULES = `Dostaneš jeden článek z aktualit na webu města Kopidlna (kopidlno.cz) a přehled toho, co už na webu Kopidlenská drbna je.

Město stejné věci často zveřejňuje i v Munipolisu (aplikace a hlášení města), ze kterého drbna taky čte. V přehledu jsou jako zprávy, akce, návrhy a dřívější převzaté zprávy se značkou munipolis:…. Než něco napíšeš, porovnej článek s nimi.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, nebo ji město poslalo přes Munipolis (značka munipolis:…), i když jinými slovy. Do duplicate_of dej značku z přehledu, třeba "zprava:12" nebo "munipolis:40". Když článek přináší podstatnou novinku (jiný termín, zrušení, program, výsledek), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a novinku zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": věc, kterou Drběna z Munipolisu přeskočila, když tu není nic podstatného navíc. Úřední věci bez zajímavosti pro sousedy (vyhlášky, výběrová řízení, dokumenty ke stažení), odstávky, uzavírky a změny otevírací doby (ty drbna bere odjinud) a článek bez dost obsahu.
- "vytvorit": akce ve městě (kultura, Komunitní a vzdělávací centrum, knihovna, spolky, sport) a novinky města, které zajímají sousedy.

Co vytvořit:
- Akce pro veřejnost s datem: event a k tomu krátký článek s pozvánkou. Termín z kalendáře města je u článku uvedený zvlášť.
- Cokoli jiného: článek.`;

export const SCHOOLS = {
  skola: {
    tag: "skola",
    // Jméno se píše za slovo „web“: web ZŠ a MŠ Kopidlno, z webu zahradnické školy Kopidlno.
    name: "ZŠ a MŠ Kopidlno",
    page: "Škola",
    // Kde Drběna čte: „Kontrolovat web školy“, „na webu školy“.
    site: "web školy",
    siteOf: "webu školy",
    term: "Termín v kalendáři školy",
    icon: "school",
    settingsTable: "skola_settings",
    itemsTable: "skola_items",
    rubric: "skola",
    defaultFeeds: DEFAULT_FEEDS,
    feedField: true,
    feedHint: "Jedna na řádek. Článek, který škola dá do aktualit ZŠ i MŠ, se vezme jen jednou. Prázdné pole vrátí aktuality ZŠ a MŠ.",
    freshDays: 7,
    rules: ZS_RULES,
    people: "děti při akci, výstava, výlet, ocenění",
    intro: "Koza Drběna čte aktuality na webu ZŠ a MŠ Kopidlno. Úspěchy žáků, akce a novinky pro rodiče napíše po svém, s odkazem na článek školy. Věci jen pro žáky a to, co už na drbně je, nechá být.",
    fetchItems: fetchSchoolFeeds,
  },
  zahradka: {
    tag: "zahradka",
    name: "zahradnické školy Kopidlno",
    page: "Zahradnická škola",
    site: "web školy",
    siteOf: "webu školy",
    term: "Termín v kalendáři školy",
    icon: "leaf",
    settingsTable: "zahradka_settings",
    itemsTable: "zahradka_items",
    rubric: "zahradnicka-skola",
    defaultFeeds: ["https://www.zahradnicka-skola-kopidlno.cz/wp-json/wp/v2/posts?per_page=20&_embed=1"],
    feedField: false,
    // Semináře a trhy škola vyhlašuje s měsíčním předstihem, píše ale málokdy. Dva týdny stačí.
    freshDays: 14,
    rules: ZAHRADKA_RULES,
    people: "studenti při soutěži, ocenění, vazba nebo výpěstky",
    intro: "Koza Drběna čte web Střední školy zahradnické Kopidlno. Bere jen úspěchy studentů, zahradnické trhy a semináře pro veřejnost (trhy v Kopidlně a semináře dá i do kalendáře akcí). Vnitřní věci školy nechá být.",
    // Projekty jsou povinné texty k dotacím, ty Drběna ani nečte.
    fetchItems: (urls, options) => fetchWordpressPosts(urls, { ...options, skip: ["Projekty"] }),
  },
  // Web města je na stejném Antee jako ZŠ. Úřední deska v RSS nese jen nadpis, proto jen aktuality.
  webmesta: {
    tag: "webmesta",
    name: "města Kopidlna",
    page: "Web města",
    site: "web města",
    siteOf: "webu města",
    term: "Termín v kalendáři města",
    icon: "home",
    settingsTable: "webmesta_settings",
    itemsTable: "webmesta_items",
    // Rubriku vybere Drběna sama jako u Munipolisu.
    rubric: "",
    defaultFeeds: ["https://www.kopidlno.cz/aktuality?action=atom"],
    feedField: true,
    feedHint: "Jedna na řádek. Prázdné pole vrátí aktuality města.",
    // Město zve na akce s předstihem i měsíc, píše ale málokdy.
    freshDays: 14,
    rules: WEB_MESTA_RULES,
    people: "lidé při akci, místo ve městě, koncert, výstava",
    intro: "Koza Drběna čte aktuality na webu města kopidlno.cz. Akce a novinky pro sousedy napíše po svém, s odkazem na článek města. Co už přišlo z Munipolisu nebo jinak na drbně je, pozná a nechá být.",
    fetchItems: fetchSchoolFeeds,
  },
};

export const SCHOOL_LIST = Object.values(SCHOOLS);
