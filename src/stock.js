// Knihovna obrázků: ilustrační fotky podle témat. Koza Drběna je dává ke zprávám, u kterých nemá vlastní fotku
// (plakát, leták, nic přiloženého, Deník). Redakce je může vybrat i ručně u zprávy nebo návrhu.

export const STOCK_LABEL = "Ilustrační foto";

// Témata při prvním založení knihovny. Redakce je pak přejmenovává a přidává sama.
export const STOCK_SEEDS = [
  { slug: "obecne", name: "Kopidlno obecně", hint: "Náměstí, zámek, ulice, pohledy na město. Když nesedí nic jiného." },
  { slug: "kultura", name: "Kultura a akce", hint: "Koncerty, divadlo, plesy, výstavy, knihovna, slavnosti." },
  { slug: "sport", name: "Sport", hint: "Sportovní akce, závody, turnaje." },
  { slug: "urad", name: "Úřad a zastupitelstvo", hint: "Zasedání zastupitelstva, vyhlášky, poplatky, rozpočet, úřední hodiny." },
  { slug: "volby", name: "Volby", hint: "Volby, referendum, hlasování, volební místnosti." },
  { slug: "skola", name: "Škola a děti", hint: "Škola, školka, kroužky, akce pro děti." },
  { slug: "silnice", name: "Silnice a uzavírky", hint: "Uzavírky, objížďky, opravy silnic a chodníků, auta, parkování." },
  { slug: "vlaky-autobusy", name: "Vlaky a autobusy", hint: "Vlaky, autobusy, jízdní řády, zastávky, nádraží, výluky." },
  { slug: "voda", name: "Voda", hint: "Vodovod, odstávky vody, kanalizace, řeka Mrlina, povodně." },
  { slug: "elektrina-plyn", name: "Elektřina a plyn", hint: "Odstávky elektřiny, plyn, rozvody, energie, ceny energií." },
  { slug: "priroda", name: "Příroda a zeleň", hint: "Les, louky, rybníky, stromy, parky, výsadba zeleně, počasí." },
  { slug: "odpady", name: "Odpady a sběrný dvůr", hint: "Svoz odpadu, popelnice, tříděný odpad, kontejnery, sběrný dvůr." },
  { slug: "zdravi", name: "Zdraví a senioři", hint: "Lékaři, očkování, sociální služby, senioři." },
  { slug: "hasici", name: "Hasiči a bezpečnost", hint: "Hasiči, policie, nehody, varování." },
];

// Popisek fotky z knihovny ve zprávě. Vlastní popisek fotky (autor, licence) zůstane za ním.
export function stockCaption(caption) {
  const own = String(caption ?? "").replace(/\s+/g, " ").trim();
  return own ? `${STOCK_LABEL} · ${own}` : STOCK_LABEL;
}

// Téma fotky podle toho, o čem článek je: parkování k výstavě nemá dostat fotku silnice.
export const TOPIC_RULE =
  "Téma vyber podle toho, čeho se článek týká (akce, místo, událost), ne podle praktické podrobnosti kolem. Parkování, objížďka nebo autobus k výstavě je pořád článek o výstavě. Silnice, dopravu a podobně vyber jen tehdy, když jsou samy hlavní zprávou.";

// Témata pro Claude: značka, název a kdy téma použít.
export function topicsText(topics) {
  if (!topics.length) return "Témata knihovny obrázků: (žádná, image_topic nech prázdné)";
  const rows = topics.map((topic) => `- ${topic.slug}: ${topic.name}${topic.hint ? ` (${topic.hint})` : ""}`);
  return `Témata knihovny obrázků:\n${rows.join("\n")}\n${TOPIC_RULE}`;
}
