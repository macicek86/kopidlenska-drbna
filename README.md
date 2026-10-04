# Kopidlenská drbna pro Cloudflare

Samostatný Worker. Články, akce, účty redakce a pravidlo svozu jsou v **D1**. Fotky nahrané v redakci jdou do **R2**. Maskot je soubor `public/kozel-maskot.webp`.

Adresa `popelnice.kopidlenskadrbna.org` jen přesměruje na `/popelnice` (samostatný web popelnic skončil).

## Co potřebuješ

- Node.js 20 nebo novější
- účet Cloudflare (stačí free)
- přihlášení ve vlastním terminálu, token nikam neposílej

## Nasazení

Ve složce tohoto balíčku:

```bash
npm install
npx wrangler login
npm run nasadit
```

`npm run nasadit` založí databázi D1, bucket R2, nahraje schéma a výchozí zprávy a nasadí Worker. Adresu `*.workers.dev` vypíše na konci.

Pak v Cloudflare otevři Worker **kopidlenska-drbna** a v Settings → Domains and routes přidej:

- `kopidlenskadrbna.org`
- `www.kopidlenskadrbna.org` (když ji používáš)
- `popelnice.kopidlenskadrbna.org`

Domény musí být na stejném účtu. Stejné řádky jsou připravené zakomentované ve `wrangler.toml`. Až je odkomentuješ, znovu spusť `npx wrangler deploy`.

## Redakce

Adresa `/redakce`. Přihlašuje se do ní kódem z e-mailu, nastavení odesílání a přihlášení je v [NAVOD-PRIHLASENI.md](NAVOD-PRIHLASENI.md). Po přihlášení se otevře Přehled: co čeká na schválení a co se chystá. Vlevo je menu sekcí (na mobilu nahoře). Úpravy, nové položky i mazání se otevírají v okně, seznamy jde prohledávat a před zavřením okna s neuloženými změnami se redakce zeptá. Ctrl+S uloží otevřený formulář. Účty jsou dvou druhů.

Hlavní redaktor je jeden. Přihlašuje se e-mailem, který zadáš při `npm run nasadit`. Může zprávy, akce, texty, svoz, sběrné dvory, odstávky elektřiny i účty. Jeho vlastní zpráva jde na web hned. Výchozí jméno pod článkem je Redakce. V sekci Můj účet si každý nastaví jméno a volitelný alias. Když alias používá, na webu se u jeho zpráv ukáže alias.

Přispěvatele přidá hlavní redaktor v sekci Lidé: jméno pod článkem, volitelný alias, e-mail pro přihlášení a oprávnění. Teď je tu oprávnění Sběrný dvůr. Přispěvatel píše nové zprávy a u zveřejněné zprávy, i cizí, může jen navrhnout úpravu. Na web se dostane až to, co hlavní redaktor schválí. Cizí text přímo nezmění a návrh úpravy jeho vlastní zprávy taky čeká na schválení. Člověk s oprávněním na sběrný dvůr navíc zapíše mimořádné uzavření a důvod. Dvůr, popis a otevírací dobu mění jen hlavní redaktor.

Hlavní redaktor může text před schválením upravit, nejčastěji češtinu. Veřejně se neukáže, co se měnilo. Když se zveřejněné znění liší od návrhu, u autora je nanejvýš slovo Redigováno. Autor příspěvku zůstává přispěvatel. U návrhu úpravy cizí zprávy zůstává původní autor.

Text zprávy se píše s nadpisy, odrážkami, tučným písmem, citací a odkazy. Skripty a jiné vložené kódy se neuloží. V sekci Zprávy jde přiložit fotka. Prohlížeč ji před odesláním zmenší a uloží jako WebP. Na webu je potom v bucketu `kopidlenska-drbna` pod `/media/...`.

Sekce Texty webu mění nápisy, titulky a odstavce na veřejných stránkách. Samotné zprávy a pozvánky mají vlastní záložky. Kontakt, vysvětlení svozu a poznámka ke svátkům zůstávají u Popelnic. Po aktualizaci znovu spusť `npm run nasadit`, ať se v databázi doplní tabulka textů.

## Místní náhled bez účtu

```bash
npm install
npm run db:local
npm run dev
```

Otevři `http://127.0.0.1:8787`. Místní D1 i R2 jsou jen na tom počítači, na účet se nic neposílá.

Náhled redakce v Chromu, třeba po úpravě vzhledu: `npm run nahled:db`, `npm run nahled` a v druhém terminálu `npm run screens`. Snímky jsou pak ve složce `.screens/`. Víc je v `CLAUDE.md`.

## Svoz

Pravidlo je stejné jako na popelnice.kopidlenskadrbna.org: pondělí lichého kalendářního týdne, jednou za 14 dní. V redakci se dá den, sudý/lichý týden i interval přepnout. Není to úřední harmonogram města.

## Sběrné dvory

Veřejná stránka je `/sberne-dvory`. Hlavní redaktor v sekci Sběrné dvory přidá i víc dvorů: místo, co se tam vozí a u každého dne v týdnu od–do. Na titulce je u každého dvora podle pražského času, jestli je právě otevřený, kdy zas otevře, nebo že je mimořádně zavřený do data. Mimořádné uzavření a důvod k němu zapíše hlavní redaktor, nebo přispěvatel s oprávněním Sběrný dvůr. Není to úřední deska města.
