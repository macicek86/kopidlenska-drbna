// Facebook Pages jako zdroj importu (značka `facebook`, `/redakce/facebook`, tabulky `facebook_*`). Fronta, zpracování,
// fotky a stránka redakce jsou společné se školami a webem města (src/skola/), tady je jen čtení a pravidla.
import { FOLLOWUP_DECISION } from "../followup-rules.js";
import { fetchFacebookPages } from "./api.js";

export const DEFAULT_PAGES = ["https://www.facebook.com/kopidlenskelisty", "https://www.facebook.com/JicinevesCZ"];

const RULES = `Dostaneš jeden veřejný příspěvek z facebookové stránky (Page) města nebo místní organizace a přehled toho, co už na webu Kopidlenská drbna je. Ze které stránky příspěvek je, stojí u něj.

Kopidlenské listy vede město Kopidlno a stejné věci často dává i do Munipolisu a na web kopidlno.cz, ze kterých drbna taky čte. V přehledu jsou jako zprávy, akce, návrhy a dřívější převzaté zprávy se značkou munipolis:…, webmesta:… a vlozene:… (příspěvek, který redakce vložila ručně). Než něco napíšeš, porovnej příspěvek s nimi.

Rozhodni (pole decision):
- "duplicita": o stejné věci už na drbně je zpráva, akce, oznámení nebo čekající návrh, nebo ji město poslalo jinudy (značka munipolis:…, webmesta:…, vlozene:…), i když jinými slovy. Do duplicate_of dej značku z přehledu, třeba "zprava:12" nebo "munipolis:40". Když příspěvek přináší podstatnou novinku (jiný termín, zrušení, program, výsledek), není to duplicita: zvol "doplneni" (je-li o věci zpráva), jinak "vytvorit", a novinku zmiň v reason.
${FOLLOWUP_DECISION}
- "preskocit": příspěvek bez obsahu pro sousedy (sdílení bez vlastního textu, přání k svátkům, poděkování bez další zprávy, soutěž o lajky, reklama, výzva ke sdílení), odstávky, uzavírky a změny otevírací doby (ty drbna bere odjinud). Z jiné obce než Kopidlno ber jen to, co zajímá i lidi z Kopidlna (akce pro veřejnost, uzavírka cesty do Kopidla, společná věc obou obcí); vnitřní věci té obce přeskoč.
- "vytvorit": akce ve městě a okolí pro veřejnost a novinky, které zajímají sousedy.

Co vytvořit:
- Akce pro veřejnost s datem v Kopidlně: event a k tomu krátký článek s pozvánkou. Akce v jiné obci: jen článek, event include false.
- Cokoli jiného: článek.

Příspěvky na sociálních sítích bývají krátké, s emoji, hashtagy a výzvami ke sdílení. Nic z toho do článku nepřebírej. Údaje, které v textu chybí, bývají na přiložených obrázcích. Jména soukromých lidí z komentářů ani z příspěvku nepiš, když nejsou pro zprávu potřeba.`;

export const FACEBOOK_SOURCE = {
  tag: "facebook",
  name: "Facebooku",
  page: "Facebook",
  site: "Facebook",
  siteOf: "Facebooku",
  term: "",
  icon: "inbox",
  settingsTable: "facebook_settings",
  itemsTable: "facebook_items",
  // Rubriku vybere Drběna sama jako u Munipolisu.
  rubric: "",
  defaultFeeds: DEFAULT_PAGES,
  feedField: true,
  feedLabel: "Facebook Pages",
  feedHint: "Odkaz na Page, jeden na řádek. Jen oficiální stránky měst a organizací, osobní profily nejdou. Prázdné pole vrátí Kopidlenské listy a Jičíněves.",
  freshDays: 7,
  rules: RULES,
  people: "lidé při akci, místo ve městě, koncert, výstava",
  intro: "Koza Drběna čte veřejné příspěvky vybraných facebookových stránek města a místních organizací (Graph API). Akce a novinky napíše po svém, s odkazem na původní příspěvek. Co už přišlo z Munipolisu, webu města nebo jinak na drbně je, pozná a nechá být.",
  // Pod zprávou a u fotky: „Kopidlenské listy na Facebooku“ (section je jméno Page).
  credit: (section) => `${section || "Facebook"}${section ? " na Facebooku" : ""}`,
  itemHead: (section) => `Příspěvek z facebookové stránky ${section || "neznámé"}`,
  fetchItems: fetchFacebookPages,
};
