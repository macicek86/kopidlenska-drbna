// Školy, ze kterých Drběna píše. Každá má vlastní tabulky, stránku v redakci, způsob stahování a pravidla výběru;
// zbytek (fronta, zpracování, fotky, odkaz na zdroj) je společný v `run.js` a `store.js`.
import { DEFAULT_FEEDS, fetchSchoolFeeds } from "./feed.js";
import { fetchWordpressPosts } from "./wordpress.js";

const ZS_RULES = `Dostaneš jeden článek z webu Základní a mateřské školy Kopidlno a přehled toho, co už na webu Kopidlenská drbna je.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy (třeba ze zpráv města). Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když článek přináší podstatnou novinku (jiný termín, zrušení, výsledek), není to duplicita: zvol "vytvorit" a novinku zmiň v reason.
- "preskocit": věc jen pro žáky a učitele bez zajímavosti pro sousedy (rozvrh, dokument ke stažení, přání krásných prázdnin, hospodaření spolku), nebo článek nemá dost obsahu.
- "vytvorit": úspěchy žáků, akce školy a školky (i pro veřejnost), novinky, které zajímají rodiče i ostatní sousedy (zápis, ceny stravného, ředitelské volno, nové kroužky, projekty).

Co vytvořit:
- Akce, kam může přijít veřejnost nebo rodiče s dětmi, s datem: event a k tomu krátký článek s pozvánkou. Termín ze školního kalendáře je u článku uvedený zvlášť. Akce jen pro žáky (třída jede na výlet) do kalendáře nedávej, stačí článek.
- Cokoli jiného: článek.`;

const ZAHRADKA_RULES = `Dostaneš jeden článek z webu Střední školy zahradnické Kopidlno a přehled toho, co už na webu Kopidlenská drbna je.

Od téhle školy drbna bere jen tři věci: úspěchy studentů, zahradnické trhy a semináře pro veřejnost. Všechno ostatní je vnitřní věc školy, která sousedy nezajímá.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, i když ho napsal někdo jiný a jinými slovy (třeba ze zpráv města). Do duplicate_of dej jeho značku z přehledu, třeba "zprava:12". Když článek přináší podstatnou novinku (jiný termín, zrušení, výsledek), není to duplicita: zvol "vytvorit" a novinku zmiň v reason.
- "preskocit": všechno, co není úspěch studentů, trhy ani seminář pro veřejnost. Hlavně projekty a dotace (šablony, OP JAK), život školy (ples, tančení, exkurze, výlety), dražba nebo prodej majetku školy, volná místa a hledání zaměstnanců, přijímací řízení, den otevřených dveří, maturity, závěrečné zkoušky, suplování, dokumenty. Taky seminář, o kterém škola píše, že je už naplněný, a článek bez dost obsahu.
- "vytvorit": úspěchy studentů (soutěže, mistrovství, ocenění, umístění třeba ve floristice, rybářství nebo zahradnictví), zahradnické trhy a semináře pro veřejnost.

Co vytvořit:
- Úspěch studentů: jen článek, event include false.
- Trhy, které se konají v Kopidlně (ve škole, ve sklenících školního hospodářství, v zámeckém parku): event a k tomu krátký článek s pozvánkou. Trhy jinde než v Kopidlně: jen článek, event include false.
- Seminář pro veřejnost: event na den semináře a k tomu článek s pozvánkou. Do článku i do event.description napiš, o čem seminář je, dokdy se přihlásit a kolik je míst, když to škola uvádí. Přihlášku ani propozice nepřikládej, odkaz na článek školy drbna doplní pod zprávu sama.`;

export const SCHOOLS = {
  skola: {
    tag: "skola",
    // Jméno se píše za slovo „web“: web ZŠ a MŠ Kopidlno, z webu zahradnické školy Kopidlno.
    name: "ZŠ a MŠ Kopidlno",
    page: "Škola",
    icon: "school",
    settingsTable: "skola_settings",
    itemsTable: "skola_items",
    rubric: "skola",
    defaultFeeds: DEFAULT_FEEDS,
    feedField: true,
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
};

export const SCHOOL_LIST = Object.values(SCHOOLS);
