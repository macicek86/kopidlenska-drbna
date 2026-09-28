# Kopidlenská drbna pro Cloudflare

Samostatný Worker. Články, akce, heslo redakce a pravidlo svozu jsou v **D1**. Fotky nahrané v redakci jdou do **R2**. Maskot a popelář jsou soubory `public/kozel-maskot.webp` a `public/kozel-popelar.webp`.

Stejný Worker obslouží i `popelnice.kopidlenskadrbna.org`: na té doméně je titulka jen stránka svozu.

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

Adresa `/redakce`. Účty jsou dvou druhů.

Hlavní redaktor je jeden. Výchozí přihlášení je jméno `redakce` a heslo `Drbna2026`. Po prvním vstupu si heslo změň v záložce Heslo. Může zprávy, akce, texty, svoz i účty. Jeho vlastní zpráva jde na web hned a podepíše se jeho jménem. Výchozí jméno je Redakce, v záložce Heslo se dá přepsat.

Přispěvatele přidá hlavní redaktor v záložce Lidé: jméno pod článkem, přihlašovací jméno a heslo. Přispěvatel píše nové zprávy a u zveřejněné zprávy, i cizí, může jen navrhnout úpravu. Na web se dostane až to, co hlavní redaktor schválí. Cizí text přímo nezmění a návrh úpravy jeho vlastní zprávy taky čeká na schválení.

Hlavní redaktor může text před schválením upravit, nejčastěji češtinu. Veřejně se neukáže, co se měnilo. Když se zveřejněné znění liší od návrhu, u autora je nanejvýš slovo Redigováno. Autor příspěvku zůstává přispěvatel. U návrhu úpravy cizí zprávy zůstává původní autor.

Text zprávy se píše s nadpisy, odrážkami, tučným písmem, citací a odkazy. Skripty a jiné vložené kódy se neuloží. V záložce Zprávy jde přiložit fotka. Prohlížeč ji před odesláním zmenší a uloží jako WebP. Na webu je potom v bucketu `kopidlenska-drbna` pod `/media/...`.

Záložka Texty mění nápisy, titulky a odstavce na veřejných stránkách. Samotné zprávy a pozvánky mají vlastní záložky. Kontakt, vysvětlení svozu a poznámka ke svátkům zůstávají u Popelnic. Po aktualizaci znovu spusť `npm run nasadit`, ať se v databázi doplní tabulka textů.

## Místní náhled bez účtu

```bash
npm install
npm run db:local
npm run dev
```

Otevři `http://127.0.0.1:8787`. Místní D1 i R2 jsou jen na tom počítači, na účet se nic neposílá.

## Svoz

Pravidlo je stejné jako na popelnice.kopidlenskadrbna.org: pondělí lichého kalendářního týdne, jednou za 14 dní. V redakci se dá den, sudý/lichý týden i interval přepnout. Není to úřední harmonogram města.
