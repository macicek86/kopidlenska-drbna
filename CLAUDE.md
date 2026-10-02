# Kopidlenská drbna: poznámky pro práci na kódu

Cloudflare Worker (D1 + R2), bez frameworku. HTML skládají funkce v `src/`, v prohlížeči běží jen malé skripty z `public/`.

## Kde co je

- `src/index.js`: router, formuláře a přesměrování po POST (`?ok=…` / `?chyba=…`)
- `src/view.js`: veřejné stránky a sdílené pomocné funkce (`esc`, `credit`, `adPanel`…); `src/home.js` titulka (upozornění vedle maskota, na počítači ve dvou sloupcích, styly v `public/home.css`)
- `src/db.js`: data webu; `src/proposals-db.js` návrhy zpráv (uložení, schválení, vrácení, stažení, smazání); `src/db-core.js` přihlášení, oprávnění a drobné pomocníky; `src/ads-db.js` reklamy; `src/outages-db.js` odstávky elektřiny
- `src/notices.js` + `src/notices-db.js`: odstávky vody a uzavírky (uzavírky zatím jen v redakci, viz `PUBLIC_NOTICE_KINDS`); `src/outages-view.js` stránka a karta odstávek
- `src/munipolis/`: import zpráv města (`feed.js` RSS, `ai.js` pokyny pro Claude, `store.js` D1, `run.js` průchod). Spouští ho cron a tlačítko v redakci. Klíč je tajemství `ANTHROPIC_API_KEY`
- `src/fotbal/`: články z webu FK Kopidlno (`club.js` rozbor stránek Sklub.cz, `fotbalunas.js` oficiální rozpis, výsledky, střelci a tabulka soutěže z fotbalunas.cz (zdroj pravdy; fotbal.cz pustí jen prohlížeč), `collect.js` stažení aktualit a doplnění z obou webů, `dates.js` kontrola dne v týdnu, data, týmu a skóre: co opraví fotbalunas, smí jít ven, ostatní rozpory jdou jako návrh, `ai.js` pokyny, `store.js` D1, `run.js` průchod). Cron běží každé 4 h, fotbal se ale podívá jen tak často, jak je nastavené v redakci (výchozí jednou denně)
- `src/denik/`: články z Jičínského deníku (`feed.js` RSS, výběr jen Kopidlna a částí, volná část článku před paywallem; `ai.js` pokyny a kontrola podmínek Deníku; `store.js` D1; `run.js` průchod). Deník to dovolil jen takto: žádné citace ani opsané věty, žádné „jak píše Deník“, jen podstatné věci. `denikProblem` výsledek, který to poruší, vrátí Claudovi k přepsání. Fotky z Deníku se neberou, odkaz na zdroj jen se zapnutým nastavením
- `src/import-context.js`: společné pro Munipolis a Deník (co už na drbně je, rubriky, datum ze zdroje, souhrn)
- `src/drbena.js`: povaha kozy Drběny (výchozí text a `voiceFor`: povaha, u fotbalu k ní fotbalové zvyky); `src/drbena-db.js` ji ukládá (`drbena_settings`), redakce ji upravuje na stránce Koza Drběna (`src/admin/drbena.js`). Výchozí text se neukládá, ať změna v kódu platí všude. Tamtéž „Vyzkoušet povahu“ (`src/drbena-try.js`): vložený článek Drběna napíše stejnými pokyny jako import, podle povahy z polí (i neuložené), nic se neukládá
- `src/claude.js`: společné volání Claude (model, JSON podle schématu, chyby česky); `src/bot-article.js`: uložení článku od kozy Drběny (rovnou na web, nebo jako návrh)
- `src/background.js`: fronta importů. Cron (se zapnutým importem) bere sám jen čerstvé položky (`fresh_days` podle data ve zdroji, u zápasu den zápasu) a píše je s dnešním datem; starší odloží jako `stare`, i když už čekají ve frontě, ať se drbna po prvním spuštění nebo dlouhé pauze nenaplní starými věcmi. Tlačítko „Zkontrolovat teď“ jen načte položky jako `nacteno` a redakce zaškrtne, co zpracovat (`manual = 1`): to Drběna napíše vždy a s datem ze zdroje (`proposals.publish_on` se při schválení stane datem zprávy). Vybrané se píšou na pozadí (`ctx.waitUntil`, asi 30 s, krátká dávka) při výběru a při každém otevření stránky, ta se sama obnovuje (`data-refresh` v `public/admin.js`); zbytek dopíše cron. Zámek `running_at` nese čas, kdy vyprší
- `src/admin/imports.js`: společné kousky redakce pro Munipolis a fotbal (stav, zaškrtávání, pruh s tím, co Drběna dělá)
- `src/photo.js`: fotka u zprávy (bod výřezu jako třídy `fx-*`/`fy-*`, popisek, detail bez ořezu); `src/images.js`: ukládání fotek do R2
- `src/admin/`: redakce, jeden modul na sekci (`articles.js`, `ads.js`, `doctors.js`…)
  - `shell.js`: rozvržení s postranním menu a přihlášení
  - `ui.js`: stavební prvky (`modal`, `panel`, `item`, `badge`, `field`, `confirmForm`…)
  - `hours.js`: mřížky otevíracích a ordinačních hodin
- `public/admin.css`, `public/admin.js`: vzhled a chování redakce
- `public/editor.js`: editor textu (Trix), zmenšení fotky, náhled reklamy. Nový obsah oživí událost `drbna:mount`.
- `public/photo-pick.js`: v redakci náhled výřezu fotky a ťuknutí na místo, které má zůstat vidět

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

Import z Munipolisu, Deníku i fotbal jde v náhledu vyzkoušet bez skutečného Claude: `npx wrangler dev --port 8788 --persist-to .wrangler/nahled --var ANTHROPIC_API_KEY:x --var ANTHROPIC_BASE_URL:http://127.0.0.1:<port>` a na tom portu malý server, který na `POST /v1/messages` vrátí JSON podle schématu z `outputSchema()` (fotbal: `footballSchema()`).

## Kontroly

- `npm run check`: jednotkové testy
- `BASE=http://127.0.0.1:8788 node test/smoke.mjs`: celý tok přihlášení, návrhu a schválení proti běžícímu serveru

## Zásady

- Když je soubor moc dlouhý, rozděl ho do modulů (jako `src/admin/`). Dělej to průběžně při každé práci.
- Texty v UI česky, krátce a lidsky. Commity česky, v rozkazovacím způsobu.
