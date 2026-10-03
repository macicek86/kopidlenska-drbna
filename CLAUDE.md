# Kopidlenská drbna: poznámky pro práci na kódu

Cloudflare Worker (D1 + R2), bez frameworku. HTML skládají funkce v `src/`, v prohlížeči běží jen malé skripty z `public/`.

## Kde co je

- `src/index.js`: router, formuláře a přesměrování po POST (`?ok=…` / `?chyba=…`); obsluha formulářů jednotlivých sekcí je v `src/post-*.js`
- `src/view.js`: veřejné stránky a sdílené pomocné funkce (`esc`, `credit`, `adPanel`…); `src/home.js` titulka (upozornění vedle maskota, na počítači ve dvou sloupcích, styly v `public/home.css`)
- `src/schema.js`: založení a migrace databáze. Běží jen když verze v tabulce `schema_version` nesedí se `SCHEMA_VERSION`, jinak stojí studený start jeden dotaz. **Kdo změní migrace (tabulka, sloupec, index, výchozí data), zvedne `SCHEMA_VERSION`**; `test/schema.test.js` hlídá otisk SQL a řekne, co přepsat
- `src/db.js`: data webu (`loadPublic` a `loadAdmin` načítají všechno souběžně, seznamy zpráv bez textu); `src/users-db.js` účty redakce (heslo, e-mail, přispěvatelé, oprávnění); `src/proposals-db.js` návrhy zpráv (uložení, schválení, vrácení, stažení, smazání); `src/db-core.js` přihlášení, oprávnění a drobné pomocníky; `src/ads-db.js` reklamy; `src/outages-db.js` odstávky elektřiny
- `src/seo.js`: `robots.txt`, `sitemap.xml` (data z `src/seo-db.js`) a JSON-LD (titulka WebSite a vydavatel, zpráva NewsArticle s drobečky, akce Event). `layout` bere `canonical`, `noindex`, `ogType`, `image`, `jsonLd`; JSON-LD je datový `<script type="application/ld+json">`, CSP ho nehlídá
- `src/places.js` + `src/places-db.js`: otevírací doba míst (úřad, knihovna, KVC…), stránka `/oteviraci-doba` a karta na titulce (`src/hours-view.js` vykresluje ji i lékaře). Místa jsou v D1 a upravují se v redakci (`src/admin/places.js`), `PLACE_SEEDS` se vloží jen při prvním založení tabulky. Změna je `docasna` (i zavřeno) nebo `trvala` (nová doba, v den začátku ji `settleNewHours` propíše do běžné a titulka na ni upozorňuje 14 dní před i po). Oprávnění `oteviraci_doba`
- `src/visits.js` + `src/visits-db.js`: počítadlo návštěv veřejné části. Počítá Worker po vykreslení HTML (200, GET, ne redakce, ne boti, ne přihlášená redakce, ne prefetch) přes `ctx.waitUntil`. Bez cookies a IP: návštěvníka pozná otisk SHA-256 z denní soli, IP a prohlížeče; sůl a otisky se druhý den smažou. Denní součty (`visit_days`, `visit_pages`, `visit_sources` jen doména odkazu, jednou za den podle první stránky) zůstávají, `visit_totals` dává veřejné „Přečteno N×“ u zprávy. Stránka `src/admin/stats.js` s oprávněním `statistiky`
- `src/forms.js`: čtení adres redakce (`adminQuery`) a polí formulářů (`formFields`)
- `src/notices.js` + `src/notices-db.js`: odstávky vody a uzavírky (uzavírky zatím jen v redakci, viz `PUBLIC_NOTICE_KINDS`); `src/outages-view.js` stránka a karta odstávek
- `src/munipolis/`: import zpráv města (`feed.js` RSS, `ai.js` pokyny pro Claude, `hours.js` otevírací doba: zavření a dočasnou změnu míst i lékařů propíše bez článku, trvalou s článkem, `store.js` D1, `run.js` průchod). Spouští ho cron a tlačítko v redakci. Klíč je tajemství `ANTHROPIC_API_KEY`
- `src/fotbal/`: články z webu FK Kopidlno (`club.js` rozbor stránek Sklub.cz, `fotbalunas.js` oficiální rozpis, výsledky, střelci a tabulka soutěže z fotbalunas.cz (zdroj pravdy; fotbal.cz pustí jen prohlížeč), `collect.js` stažení aktualit a doplnění z obou webů, `dates.js` kontrola dne v týdnu, data, týmu a skóre: co opraví fotbalunas, smí jít ven, ostatní rozpory jdou jako návrh, `ai.js` pokyny, `store.js` D1, `run.js` průchod). Cron běží každé 4 h, fotbal se ale podívá jen tak často, jak je nastavené v redakci (výchozí jednou denně)
- `src/denik/`: články z Jičínského deníku (`feed.js` RSS, výběr jen Kopidlna a částí, volná část článku před paywallem; `ai.js` pokyny a kontrola podmínek Deníku; `store.js` D1; `run.js` průchod). Deník to dovolil jen takto: žádné citace ani opsané věty, žádné „jak píše Deník“, jen podstatné věci. `denikProblem` výsledek, který to poruší, vrátí Claudovi k přepsání. Fotky z Deníku se neberou, odkaz na zdroj jen se zapnutým nastavením
- `src/import-context.js`: společné pro Munipolis a Deník (co už na drbně je, rubriky, datum ze zdroje, souhrn)
- `src/drbena.js`: povaha kozy Drběny (výchozí text a `voiceFor`: povaha, u fotbalu k ní fotbalové zvyky); `src/drbena-db.js` ji ukládá (`drbena_settings`), redakce ji upravuje na stránce Koza Drběna (`src/admin/drbena.js`). Výchozí text se neukládá, ať změna v kódu platí všude. Tamtéž „Vyzkoušet povahu“ (`src/drbena-try.js`): vložený článek Drběna napíše stejnými pokyny jako import, podle povahy z polí (i neuložené), nic se neukládá
- `src/chat/`: chat s Drběnou, plovoucí okénko na každé veřejné stránce (`public/chat.js`, `public/chat.css`; rozhovor drží v sessionStorage). `prompt.js` pokyny (mluví v první osobě; povaha z článků + „Jak se chová v chatu“), `context.js` co ví: stránky služeb vykreslené z D1 stejnými funkcemi jako web a převedené na text (`htmlText`), posledních 30 zpráv a nástroje `hledat_zpravy`, `precist_zpravu` (u zprávy z Munipolisu či fotbalu přiloží původní text ze zdroje), `precist_zdroj` (zdroje Munipolisu a fotbalu, ze kterých zpráva zatím není; Deník nikdy, jeho podmínky to nedovolují). `ai.js` model (Sonnet 5.5 / Haiku 4.5 podle redakce) a cena, `pass.js` Turnstile a podepsaný lístek na rozhovor, `store.js` nastavení, denní součty, limity (na návštěvníka podle otisku z počítadla návštěv, za den, měsíční rozpočet v Kč) a uložené otázky (mažou se po `keep_days`), `run.js` adresy `POST /chat/zacit` a `/chat/zeptat` (JSON, routuje se před čtením formuláře). Redakce `src/admin/chat.js` (jen hlavní redaktor), ve výchozím stavu vypnuto. Turnstile zapnou tajemství `TURNSTILE_SITE_KEY` a `TURNSTILE_SECRET`, bez nich chat chrání jen limity
- `src/claude.js`: společné volání Claude (model, JSON podle schématu, chyby česky); `src/bot-article.js`: uložení článku od kozy Drběny (rovnou na web, nebo jako návrh)
- `src/background.js`: fronta importů. Cron (se zapnutým importem) bere sám jen čerstvé položky (`fresh_days` podle data ve zdroji, u zápasu den zápasu) a píše je s dnešním datem; starší odloží jako `stare`, i když už čekají ve frontě, ať se drbna po prvním spuštění nebo dlouhé pauze nenaplní starými věcmi. Tlačítko „Zkontrolovat teď“ jen načte položky jako `nacteno` a redakce zaškrtne, co zpracovat (`manual = 1`): to Drběna napíše vždy a s datem ze zdroje (`proposals.publish_on` se při schválení stane datem zprávy). Vybrané se píšou na pozadí (`ctx.waitUntil`, asi 30 s, krátká dávka) při výběru a při každém otevření stránky, ta se sama obnovuje (`data-refresh` v `public/admin.js`); zbytek dopíše cron. Zámek `running_at` nese čas, kdy vyprší
- `src/admin/imports.js`: společné kousky redakce pro Munipolis a fotbal (stav, zaškrtávání, pruh s tím, co Drběna dělá)
- `src/stock.js` + `src/stock-db.js`: knihovna obrázků (ilustrační fotky podle témat; témata držet úzká, ať fotky v jednom sedí ke stejným zprávám, `src/admin/stock.js`, oprávnění `obrazky`). Munipolis: Claude v `image_use` řekne, jestli je přiložená fotka pěkná (`vlastni`), nebo jde o plakát či leták (`knihovna`, plakát se zahodí); Deník bere fotku vždy z knihovny, fotbal ne. `pickStockImage` bere z tématu (`image_topic`) nejdéle nepoužitou fotku, jinak z náhradního tématu (v redakci jde vypnout, pak je zpráva bez obrázku). Popisek „Ilustrační foto“. Fotky z knihovny sdílí víc zpráv, `releaseImage` je proto nemaže. U zprávy a návrhu jde fotku vybrat z knihovny (`stock_id`, `src/admin/stock-pick.js`)
- `src/yards-db.js`, `src/doctors-db.js`: sběrné dvory a lékaři v D1 (`db.js` je znovu exportuje)
- `src/photo.js`: fotka u zprávy (bod výřezu jako třídy `fx-*`/`fy-*`, popisek, detail bez ořezu); `src/images.js`: ukládání fotek do R2
- `src/admin/`: redakce, jeden modul na sekci (`articles.js`, `ads.js`, `doctors.js`…)
  - `shell.js`: rozvržení s postranním menu a přihlášení
  - `ui.js`: stavební prvky (`modal`, `panel`, `item`, `badge`, `field`, `confirmForm`…)
  - `hours.js`: mřížky otevíracích a ordinačních hodin
- `public/admin.css`, `public/admin.js`: vzhled a chování redakce
- `public/editor.js`: editor textu (Trix), zmenšení fotky, náhled reklamy. Nový obsah oživí událost `drbna:mount`.
- `public/photo-pick.js`: v redakci náhled výřezu fotky a ťuknutí na místo, které má zůstat vidět

## Přihlášení do redakce: Cloudflare Access

Na produkci hlídá redakci Cloudflare Access (Zero Trust), zatím na adrese `*.workers.dev`. Worker ověří token z hlavičky `Cf-Access-Jwt-Assertion` (podpis, AUD, vydavatel, platnost; `src/access.js`) a podle e-mailu najde účet v `users.email`. Hesla jsou pak vypnutá, odhlášení vede na `/cdn-cgi/access/logout`.
Zapíná se to tajemstvími `ACCESS_TEAM` a `ACCESS_AUD` (`npx wrangler secret put …`). Bez nich (místně, náhled, smoke test) se redakce přihlašuje heslem jako dřív.
Až drbna přejde na kopidlenskadrbna.org, vypnout `workers_dev` a `preview_urls` (návod je ve `wrangler.toml`) a Access nastavit na všechny tři domény.

## Redakce: jak fungují okna

Každé okno má svou adresu (`?novy=1`, `?id=3`, `?smazat=3`, `?navrh=5`, `?uzavreni=1`, `?hodiny=2`, `?zmena=2`, `?upravit=4`…).
Server okno na té adrese vykreslí otevřené (`<dialog data-autoopen>`), takže všechno funguje i bez JS.
S JS odkaz `data-modal` stránku stáhne na pozadí, vezme z ní okno a otevře ho. Odkaz `data-open` otevře okno, které už na stránce je (formuláře „Nový…“).
CSP povoluje jen skripty a styly z vlastní domény: žádné inline `style=""` ani `<script>`. Jediná výjimka je skript a rámeček Turnstile z `challenges.cloudflare.com` (chat s Drběnou).

## Náhled v Chromu (i pro agenty)

Chrome je v `/usr/bin/google-chrome`, Playwright je v devDependencies (`playwright-core`).

```bash
npm run nahled:db          # jednou: čistá databáze jen pro náhled (.wrangler/nahled), výchozí heslo Drbna2026
npm run nahled             # server na http://127.0.0.1:8788 (běžná místní data na 8787 zůstanou netknutá)
npm run screens            # snímky redakce do .screens/ (desktop i mobil, i otevřená okna)
npm run screens -- lekari  # jen vybrané sekce
LOGIN=jana PASSWORD=… OUT=.screens/prispevatel npm run screens   # pohled přispěvatele
```

Chat s Drběnou jde vyzkoušet stejně (zapnout v redakci na stránce Chat s Drběnou); Turnstile s testovacími klíči Cloudflare `--var TURNSTILE_SITE_KEY:1x00000000000000000000AA --var TURNSTILE_SECRET:1x0000000000000000000000000000000AA`. Prohlížeč bez okna (HeadlessChrome) chat odmítne jako robota, v Playwrightu nastavit běžný `userAgent`.

Import z Munipolisu, Deníku i fotbal jde v náhledu vyzkoušet bez skutečného Claude: `npx wrangler dev --port 8788 --persist-to .wrangler/nahled --var ANTHROPIC_API_KEY:x --var ANTHROPIC_BASE_URL:http://127.0.0.1:<port>` a na tom portu malý server, který na `POST /v1/messages` vrátí JSON podle schématu z `outputSchema()` (fotbal: `footballSchema()`).

## Kontroly

- `npm run check`: jednotkové testy
- `BASE=http://127.0.0.1:8788 node test/smoke.mjs`: celý tok přihlášení, návrhu a schválení proti běžícímu serveru

## Zásady

- Když je soubor moc dlouhý, rozděl ho do modulů (jako `src/admin/`). Dělej to průběžně při každé práci.
- Texty v UI česky, krátce a lidsky. Commity česky, v rozkazovacím způsobu.
