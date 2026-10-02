// Knihovna obrázků: ilustrační fotky podle témat. Koza Drběna je dává ke zprávám, u kterých nemá vlastní fotku
// (plakát, leták, nic přiloženého, Deník). Redakce je může vybrat i ručně u zprávy nebo návrhu.

export const STOCK_LABEL = "Ilustrační foto";

// Témata při prvním založení knihovny. Redakce je pak přejmenovává a přidává sama.
export const STOCK_SEEDS = [
  { slug: "obecne", name: "Kopidlno obecně", hint: "Náměstí, zámek, ulice, pohledy na město. Když nesedí nic jiného." },
  { slug: "kultura", name: "Kultura a akce", hint: "Koncerty, divadlo, plesy, výstavy, knihovna, slavnosti." },
  { slug: "sport", name: "Sport", hint: "Sportovní akce, závody, turnaje." },
  { slug: "urad", name: "Úřad a zastupitelstvo", hint: "Zasedání, vyhlášky, volby, poplatky, rozpočet." },
  { slug: "skola", name: "Škola a děti", hint: "Škola, školka, kroužky, akce pro děti." },
  { slug: "doprava", name: "Doprava a silnice", hint: "Uzavírky, opravy silnic, autobusy, vlaky." },
  { slug: "voda-energie", name: "Voda a energie", hint: "Odstávky vody, kanalizace, elektřina, plyn." },
  { slug: "priroda", name: "Příroda a odpady", hint: "Rybníky, les, zeleň, počasí, svoz odpadu, sběrný dvůr." },
  { slug: "zdravi", name: "Zdraví a senioři", hint: "Lékaři, očkování, sociální služby, senioři." },
  { slug: "hasici", name: "Hasiči a bezpečnost", hint: "Hasiči, policie, nehody, varování." },
];

// Popisek fotky z knihovny ve zprávě. Vlastní popisek fotky (autor, licence) zůstane za ním.
export function stockCaption(caption) {
  const own = String(caption ?? "").replace(/\s+/g, " ").trim();
  return own ? `${STOCK_LABEL} · ${own}` : STOCK_LABEL;
}

// Témata pro Claude: značka, název a kdy téma použít.
export function topicsText(topics) {
  if (!topics.length) return "Témata knihovny obrázků: (žádná, image_topic nech prázdné)";
  const rows = topics.map((topic) => `- ${topic.slug}: ${topic.name}${topic.hint ? ` (${topic.hint})` : ""}`);
  return `Témata knihovny obrázků:\n${rows.join("\n")}`;
}
