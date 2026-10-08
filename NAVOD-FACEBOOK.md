# Facebook Pages a kontrola aplikace Meta

Implementace ručního importu je v `/redakce/facebook` (jen hlavní redaktor). Není to schválení přístupu od Meta. Cizí Pages se musí číst až s uděleným Page Public Content Access a odpovídajícím tokenem.

## Připravené chování

- Facebook je zdroj importu jako web města a školy (`src/facebook/`: `api.js` Graph API, `source.js` pravidla pro Drběnu; fronta, zpracování a stránka redakce jsou společné v `src/skola/`). Redakce `/redakce/facebook` (jen hlavní redaktor), tabulky `facebook_settings` a `facebook_items`.
- Pages jsou v nastavení zdroje, jeden odkaz na řádek. Výchozí `kopidlenskelisty` a `JicinevesCZ`. Jedna nefunkční Page ostatní nezastaví.
- Z každé Page nejvýš dvě stránky Graph API po 25 příspěvcích. Bere jen zveřejněné příspěvky s textem a permalinkem, k nim až 3 fotky (stahují se až při zpracování přes `fetchImage`). Komentáře, reakce ani soukromé zprávy ne.
- S „Kontrolovat Facebook automaticky“ se cron dívá každé 4 h a čerstvé příspěvky Drběna zpracuje jako ostatní importy: porovná s přehledem (Munipolis, web města, vložené příspěvky), napíše článek, akci dá do kalendáře, nebo přeskočí. Zatím vždy **jako návrh** ke schválení redaktorem (`draftsOnly` v `source.js`, přepínač „Rovnou zveřejňovat“ stránka nemá).
- Zdroj pod zprávou je „<Page> na Facebooku“ s odkazem na příspěvek, fotka (jen se zapnutým „Brát fotky z Facebooku“) má stejný popisek.

## Nastavení serveru

Přístupový token patří do tajemství Cloudflare Workeru `FACEBOOK_ACCESS_TOKEN`. Nedávat jej do GitHubu, formuláře webu, videa, URL ani do textu žádosti. Platnost, oprávnění a vazbu na aplikaci ověřit v nástrojích Meta. Typ tokenu a oprávnění zvolit podle aktuálních dokumentů Meta pro Page Public Content Access; token jiného projektu automaticky přístup nepřenáší.

Použitá výchozí verze je `v26.0`, volitelně ji lze změnit proměnnou `FACEBOOK_GRAPH_VERSION`. Volání jsou pouze na `https://graph.facebook.com`; token je v hlavičce Authorization. Skript neotevírá URL `paging.next` (mohla by obsahovat token), použije jen kurzor na stejném hostu.

Články píše Drběna přes existující `ANTHROPIC_API_KEY`. Bez `FACEBOOK_ACCESS_TOKEN` stav importu ukáže chybu a nic se nestahuje. Žádná tajemství nejsou součástí této změny.

Místní náhled:

```sh
npm ci
npm run check
npm run nahled:db
npm run nahled
```

Místní přihlášení používá `redakce@example.cz` a náhled zobrazí kód. Tento režim funguje pouze na localhost; nesmí se zapnout pro veřejnou kontrolu Meta. Databáze náhledu je oddělená od produkce.

## Žádost o Page Public Content Access

Aplikace: Kopidlenská drbna, ID `1727278622295680`, portfolio camledian. Starší aplikace ID `2633189493777237` se tímto nemění. Dosavadní žádost o přístup je rozepsaná; ověření firmy bylo odeslané a čekalo na kontrolu.

Po schválení a nasazení změn doplnit do Meta:

- Privacy Policy URL: `https://www.kopidlenskadrbna.org/soukromi`
- User Data Deletion: varianta **Instructions URL**, `https://www.kopidlenskadrbna.org/smazani-dat` (nejde o OAuth callback).
- Ikonu aplikace: stávající `public/icon-512.png` po kontrole vzhledu.
- Data handling: uvést Cloudflare pro hosting/D1 a Anthropic pro zpracování zdrojového textu, podle skutečně používaných účtů a podmínek. Před zveřejněním zásad provozovatel potvrdí kontakt, skutečné doby uchování a smluvní záruky při předávání dat mimo EHP.

Anglický popis zamýšleného použití:

> Kopidlenská drbna is a local editorial news service for residents of Kopidlno and nearby communities. Its editor selects official municipal and local organization Facebook Pages, including facebook.com/kopidlenskelisty and facebook.com/JicinevesCZ. The app reads their public posts (text and attached photos) through the Graph API to identify local events and other relevant community news. For each new post the app prepares a short draft article, and the editor reviews and approves it before publication. Each published article includes a link to the original post and credits the Page for any photo used. We request Page Public Content Access because these source Pages are administered by independent municipalities and organizations rather than our app operator. The feature does not read personal profiles, private messages, comments or follower lists, and visitors do not sign in with Facebook. Cloudflare hosts the service and stores the editorial source cache; Anthropic processes selected source text to prepare draft summaries. Source posts are kept as editorial material and removed on request.

## Skutečná ukázka pro App Review

Před schválením cizích Pages použít skutečnou testovací Page, kterou spravuje správce aplikace, a token s potřebným přístupem. Nelze vydávat ručně vložená nebo simulovaná data za úspěšné volání Graph API.

Video musí ukázat přihlášení do redakce, stránku Facebook (nastavení Pages, „jako návrh“), Zkontrolovat teď, načtený skutečný testovací příspěvek s datem, textem a odkazem, návrh od Drběny, schválení v Zprávách a zdrojový odkaz u článku. Token nesmí být na videu. Konkrétní požadavky na přístup kontrolora a video ověřit v aktuální žádosti Meta.

Kontrolor potřebuje přístup ke skutečné funkci. Pro něj připravit oddělené testovací nasazení s vlastní databází a testovacím účtem hlavního redaktora; produkční účet ani jeho přihlašovací kód nesdílet. Tento commit nevytváří testovací účet ani nenahrává video. Bez platného testovacího tokenu nelze doložit živé načtení.

Dokumentace: [Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/), [Page posts](https://developers.facebook.com/docs/graph-api/reference/page/posts/), [App Review](https://developers.facebook.com/docs/app-review/).
