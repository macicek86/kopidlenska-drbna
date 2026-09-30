# Kopidlenská drbna: poznámky pro práci na kódu

Cloudflare Worker (D1 + R2), bez frameworku. HTML skládají funkce v `src/`, v prohlížeči běží jen malé skripty z `public/`.

## Kde co je

- `src/index.js`: router, formuláře a přesměrování po POST (`?ok=…` / `?chyba=…`)
- `src/view.js`: veřejné stránky a sdílené pomocné funkce (`esc`, `credit`, `adPanel`…)
- `src/admin/`: redakce, jeden modul na sekci (`articles.js`, `ads.js`, `doctors.js`…)
  - `shell.js`: rozvržení s postranním menu a přihlášení
  - `ui.js`: stavební prvky (`modal`, `panel`, `item`, `badge`, `field`, `confirmForm`…)
  - `hours.js`: mřížky otevíracích a ordinačních hodin
- `public/admin.css`, `public/admin.js`: vzhled a chování redakce
- `public/editor.js`: editor textu (Trix), zmenšení fotky, náhled reklamy. Nový obsah oživí událost `drbna:mount`.

## Redakce: jak fungují okna

Každé okno má svou adresu (`?novy=1`, `?id=3`, `?smazat=3`, `?navrh=5`, `?uzavreni=1`, `?hodiny=2`, `?zmena=2`, `?upravit=4`…).
Server okno na té adrese vykreslí otevřené (`<dialog data-autoopen>`), takže všechno funguje i bez JS.
S JS odkaz `data-modal` stránku stáhne na pozadí, vezme z ní okno a otevře ho. Odkaz `data-open` otevře okno, které už na stránce je (formuláře „Nový…“).
CSP povoluje jen skripty a styly z vlastní domény: žádné inline `style=""` ani `<script>`.

## Náhled v Chromu (i pro agenty)

Chrome je v `/usr/bin/google-chrome`, Playwright je v devDependencies (`playwright-core`).

```bash
npm run nahled:db          # jednou: čistá databáze jen pro náhled (.wrangler/nahled), výchozí heslo Drbna2026
npm run nahled             # server na http://127.0.0.1:8788 (běžná místní data na 8787 zůstanou netknutá)
npm run screens            # snímky redakce do .screens/ (desktop i mobil, i otevřená okna)
npm run screens -- lekari  # jen vybrané sekce
LOGIN=jana PASSWORD=… OUT=.screens/prispevatel npm run screens   # pohled přispěvatele
```

## Kontroly

- `npm run check`: jednotkové testy
- `BASE=http://127.0.0.1:8788 node test/smoke.mjs`: celý tok přihlášení, návrhu a schválení proti běžícímu serveru

## Zásady

- Když je soubor moc dlouhý, rozděl ho do modulů (jako `src/admin/`). Dělej to průběžně při každé práci.
- Texty v UI česky, krátce a lidsky. Commity česky, v rozkazovacím způsobu.
