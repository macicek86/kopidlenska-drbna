// Spolky, o kterých Drběna píše ze zpráv jiných webů (škola, Deník). Rubriky zakládá `src/schema.js`,
// pravidlo pro Claude se přidává do pokynů importů.
export const CLUB_PARENT = { name: "Spolky", slug: "spolky", sortOrder: 27 };

export const CLUBS = [
  {
    name: "Letečtí modeláři",
    slug: "letecti-modelari",
    sortOrder: 28,
    about: "letečtí modeláři (LMK Kopidlno, letecko-modelářský klub nebo kroužek, soutěže a mistrovství leteckých modelů)",
  },
];

const SCHOOL = "Takový článek napiš jako zprávu o spolku a jeho lidech, ne o škole: školu ani učitele nezmiňuj, vynech poděkování, chválu školy a řeči typu „jsme na ně hrdí“.";
const OTHERS = "Takový článek napiš jako zprávu o spolku a jeho lidech. Vynech poděkování a řeči typu „jsme na ně hrdí“, fakta ale nech (kdo spolku pomohl nebo přispěl).";

// Jen spolky, jejichž rubrika na webu je (redakce ji mohla smazat). Ze zpráv školy zmizí škola úplně,
// u Deníku a Munipolisu zůstanou fakta (kdo pomohl, kdo přispěl), jen omáčka ne.
export function clubRules(rubricSlugs, { hideSchool = false } = {}) {
  const clubs = CLUBS.filter((club) => rubricSlugs?.includes(club.slug));
  if (!clubs.length) return "";
  const lines = clubs.map((club) => `- ${club.about}: rubrika "${club.slug}"`);
  return `Spolky: když je článek hlavně o některém z těchto spolků, patří do jeho rubriky (má přednost před ostatními pravidly pro rubriku):
${lines.join("\n")}
${hideSchool ? SCHOOL : OTHERS} Místo omáčky přidej něco svého, jak to umíš. Výsledky, jména a umístění opiš přesně.`;
}
