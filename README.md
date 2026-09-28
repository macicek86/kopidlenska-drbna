# Kopidlenská drbna pro Cloudflare

Samostatný Worker. Články, akce, heslo redakce a pravidlo svozu jsou v **D1**. Fotky nahrané v redakci jdou do **R2**. Maskot se po `npm install` složí z `images/` do `public/`.

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

V záložce Zprávy jde přiložit fotka. Ta se uloží do bucketu `kopidlenska-drbna` a na webu je pod `/media/...`.

## Místní náhled bez účtu

```bash
npm install
npm run db:local
npm run dev
```

Otevři `http://127.0.0.1:8787`. Místní D1 i R2 jsou jen na tom počítači, na účet se nic neposílá.

## Svoz

Pravidlo je stejné jako na popelnice.kopidlenskadrbna.org: pondělí lichého kalendářního týdne, jednou za 14 dní. V redakci se dá den, sudý/lichý týden i interval přepnout. Není to úřední harmonogram města.
