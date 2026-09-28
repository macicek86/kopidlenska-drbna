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

Adresa `/redakce`. Výchozí heslo je `Drbna2026`. Po prvním přihlášení ho v záložce Heslo změň.

V záložce Zprávy jde přiložit fotka. Prohlížeč ji před odesláním zmenší a uloží jako WebP. Na webu je potom v bucketu `kopidlenska-drbna` pod `/media/...`.

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
