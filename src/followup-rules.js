// Pravidlo o navazující zprávě do pokynů importů. Bez závislostí, ať ho pokyny můžou vzít hned při načtení modulu.
// K jedné zprávě nejvýš tolik doplnění (zprávy i čekající návrhy). Pak už je to duplicita.
export const MAX_FOLLOWUPS = 2;

export const FOLLOWUP_DECISION = `- "doplneni": o stejné věci už na drbně je zpráva (značka zprava:…), ale nová zpráva přináší podstatná nová fakta, která v ní nejsou: výsledek, jména, průběh, jiný termín, zrušení nebo víc podrobností. Do duplicate_of dej značku té zprávy. Článek ani oznámení teď nepiš (include false), navazující zprávu napíšeš v dalším kroku. Jen když nová zpráva přináší den akce pro veřejnost, která mezi akcemi v přehledu ještě není (třeba stará zpráva znala jen měsíc), vyplň event a akce půjde do kalendáře. Jen ke zprávám, ne k návrhům. Ke zprávě, která má „doplněno už ${MAX_FOLLOWUPS}×“, doplnění nepiš, zvol "duplicita". Drobnost nebo totéž jinými slovy je "duplicita".`;
