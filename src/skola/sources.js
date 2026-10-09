// Školy a web města, ze kterých Drběna píše (všechny na systému Antee nebo WordPressu). Každá má vlastní tabulky, stránku v redakci, způsob stahování a pravidla výběru;
// zbytek (fronta, zpracování, fotky, odkaz na zdroj) je společný v `run.js` a `store.js`.
import { FOLLOWUP_DECISION } from "../followup-rules.js";
import { DEFAULT_FEEDS, fetchSchoolFeeds } from "./feed.js";
import { fetchWordpressPosts } from "./wordpress.js";
import { fetchCityItems } from "./deska.js";
import { FACEBOOK_SOURCE } from "../facebook/source.js";

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
- Cokoli jiného: článek.

Úřední deska (rubrika Úřední deska): odtud drbna bere usnesení a zápisy rady a zastupitelstva města, pozvánky na zasedání zastupitelstva a další oznámení, která levný model podle nadpisu vybral jako zajímavá pro sousedy (ankety, volby, osadní výbory, změny dopravy, vyhlášky…). Text je v přiloženém PDF.
- Jiné oznámení (anketa, volby, vyhláška, nábor, změna v katastru): napiš krátký článek o tom, co se sousedů týká (co, kdo, kdy a kde, do kdy), zdroj je úřední deska. Je-li to jen formalita nebo to místní netýká, "preskocit".
- Usnesení a zápis: vyber rozhodnutí, která sousedy zajímají (stavby, opravy a cesty, dotace spolkům a akcím, ceníky a poplatky, vyhlášky, prodej a nákup městského majetku, nové služby, volba starosty a rady), a napiš jeden článek o tom, co rada nebo zastupitelstvo rozhodlo, se dnem schůze. Formality vynech (schválení programu, ověřovatelé, rozpočtové opatření bez podrobností, vzetí na vědomí). Kde „rada doporučuje zastupitelstvu“, rozhodne teprve zastupitelstvo, tak to i napiš. Jména lidí, kteří od města kupují nebo pronajímají pozemek či byt, nepiš, ani když v dokumentu jsou; starostu, zastupitele, spolky a firmy jmenovat smíš. Když v dokumentu pro sousedy nic není, "preskocit". Duplicita je jen zpráva o stejné schůzi.
- Pozvánka na zasedání zastupitelstva: event (zasedání je veřejné, den, čas a místo z pozvánky) a krátký článek s body programu, které sousedy zajímají.
- Rubrika "zpravy", pokud je v seznamu.`;

const PASTED_RULES = `Dostaneš jeden příspěvek, který redakce ručně zkopírovala ze sociální sítě (nejčastěji z facebookové stránky Kopidlenských listů, kterou vede město), a přehled toho, co už na webu Kopidlenská drbna je. Odkud příspěvek je, stojí u něj.

Město stejné věci často zveřejňuje i v Munipolisu a na webu kopidlno.cz, ze kterých drbna taky čte. V přehledu jsou jako zprávy, akce, návrhy a dřívější převzaté zprávy se značkou munipolis:… a webmesta:…. Než něco napíšeš, porovnej příspěvek s nimi.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, nebo ji město poslalo jinudy (značka munipolis:… či webmesta:…), i když jinými slovy. Do duplicate_of dej značku z přehledu, třeba "zprava:12" nebo "munipolis:40". Když příspěvek přináší podstatnou novinku (jiný termín, zrušení, program, výsledek, fotky z akce), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a novinku zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": jen když v příspěvku pro sousedy opravdu nic není (sdílení bez textu, přání bez dalšího obsahu, odkaz bez popisu). Redakce příspěvek vybrala, takže jinak piš.
- "vytvorit": cokoli dalšího.

Co vytvořit:
- Akce pro veřejnost s datem: event a k tomu krátký článek s pozvánkou.
- Cokoli jiného: článek. I odstávka, uzavírka nebo změna otevírací doby z tohoto zdroje je jen článek.

Příspěvky na sociálních sítích bývají krátké, s emoji, hashtagy a výzvami ke sdílení. Nic z toho do článku nepřebírej. Údaje, které v textu chybí, bývají na přiložených obrázcích.`;

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
  // Web města je na stejném Antee jako ZŠ. K aktualitám úřední deska (`deska.js`): jen usnesení, zápisy a pozvánky na zastupitelstvo,
  // text v PDF z přílohy.
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
    // Pozvánku na akci daleko dopředu píše Drběna až pár dní před ní (`defer.js`).
    defer: true,
    rules: WEB_MESTA_RULES,
    people: "lidé při akci, místo ve městě, koncert, výstava",
    intro: "Koza Drběna čte aktuality na webu města kopidlno.cz a z úřední desky usnesení a zápisy rady a zastupitelstva. Akce, novinky a to, co město rozhodlo, napíše po svém, s odkazem na zdroj. Co už přišlo z Munipolisu nebo jinak na drbně je, pozná a nechá být.",
    fetchItems: fetchCityItems,
  },
  // Příspěvky, které redakce sama vloží (Facebook města API nepustí). Nic se nestahuje: položku založí formulář
  // (`paste.js`), odkud je, nese `section`, fotky čekají v R2 v `kept_images`. Zpracuje se hned, i když je starší.
  vlozene: {
    tag: "vlozene",
    pasted: true,
    defaultFrom: "Facebook Kopidlenských listů",
    name: "",
    page: "Vložené příspěvky",
    site: "příspěvek",
    siteOf: "příspěvku",
    term: "",
    icon: "plus",
    settingsTable: "vlozene_settings",
    itemsTable: "vlozene_items",
    rubric: "",
    defaultFeeds: [],
    feedField: false,
    freshDays: 7,
    rules: PASTED_RULES,
    people: "lidé při akci, místo ve městě, koncert, výstava",
    intro: "Příspěvek z Facebooku (nebo odjinud) sem zkopírujte i s fotkami. Koza Drběna ho zpracuje stejně jako zprávy města: pozná, jestli už to na drbně je, akci dá do kalendáře a napíše článek po svém.",
    fetchItems: null,
  },
  // Facebook Pages přes Graph API (src/facebook/).
  facebook: FACEBOOK_SOURCE,
};

export const SCHOOL_LIST = Object.values(SCHOOLS);
