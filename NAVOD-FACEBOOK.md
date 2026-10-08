# Facebook Pages a kontrola aplikace Meta

Implementace ručního importu je v `/redakce/facebook` (jen hlavní redaktor). Není to schválení přístupu od Meta. Cizí Pages se musí číst až s uděleným Page Public Content Access a odpovídajícím tokenem.

## Připravené chování

- Výchozí zdroje: `kopidlenskelisty` a `JicinevesCZ`. Přidávají se pouze při prvním založení tabulek, odebrané zdroje se při dalších migracích nevracejí.
- Načíst příspěvky provede nejvýš dvě stránky Graph API po 25 položkách. Bere jen veřejné publikované textové příspěvky s permalinkem; žádné fotografie, komentáře, reakce nebo soukromé zprávy. Načítání probíhá ručně, cron pouze uklízí podklady.
- Připravit shrnutí předá název zdroje, datum a text službě Anthropic. Vytvoří **čekající návrh**, nikdy článek rovnou na web. Odkaz na původní příspěvek ukládá aplikace do zdroje článku.
- Souběžné zpracování jedné položky blokuje zámek v D1. Existující návrh se dohledá podle zdrojového permalinku i po úklidu cache nebo po chybě při dokončení zápisu.
- Texty podkladů se uklízejí 30 dní po posledním načtení. Jednotlivý podklad nebo celou Page lze s potvrzením smazat. Redakční návrhy a články jsou samostatný archiv: případnou žádost o výmaz je potřeba vyřídit také v sekci Zprávy a v související historii změn.
- Nová migrace má verzi 57. Záznamy importu v historii změn neobsahují kopii zdrojového textu.

## Nastavení serveru

Přístupový token patří do tajemství Cloudflare Workeru `FACEBOOK_ACCESS_TOKEN`. Nedávat jej do GitHubu, formuláře webu, videa, URL ani do textu žádosti. Platnost, oprávnění a vazbu na aplikaci ověřit v nástrojích Meta. Typ tokenu a oprávnění zvolit podle aktuálních dokumentů Meta pro Page Public Content Access; token jiného projektu automaticky přístup nepřenáší.

Použitá výchozí verze je `v26.0`, volitelně ji lze změnit proměnnou `FACEBOOK_GRAPH_VERSION`. Volání jsou pouze na `https://graph.facebook.com`; token je v hlavičce Authorization. Skript neotevírá URL `paging.next` (mohla by obsahovat token), použije jen kurzor na stejném hostu.

Pro přípravu shrnutí se používá existující `ANTHROPIC_API_KEY` a společné volání Claude. Bez tajemství jsou příslušná tlačítka vypnutá. Žádná tajemství nejsou součástí této změny.

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

> Kopidlenská drbna is a local editorial news service for residents of Kopidlno and nearby communities. Its editor selects official municipal and local organization Facebook Pages, including facebook.com/kopidlenskelisty and facebook.com/JicinevesCZ. The app reads their public text posts through the Graph API to identify local events, road closures, public notices and other relevant community news. The editor selects a post, the app prepares a concise draft summary, and the editor reviews and approves it before publication. Each published summary includes a link to the original post. We request Page Public Content Access because these source Pages are administered by independent municipalities and organizations rather than our app operator. The feature does not read personal profiles, private messages, comments or follower lists, and visitors do not sign in with Facebook. Cloudflare hosts the service and stores the editorial source cache; Anthropic processes selected source text to prepare draft summaries. Raw cached source text is removed 30 days after its last retrieval; editorial drafts and published articles are managed separately by the editor.

## Skutečná ukázka pro App Review

Před schválením cizích Pages použít skutečnou testovací Page, kterou spravuje správce aplikace, a token s potřebným přístupem. Nelze vydávat ručně vložená nebo simulovaná data za úspěšné volání Graph API.

Video musí ukázat přihlášení do redakce, sekci Facebook Pages, načtení skutečného veřejného testovacího příspěvku, jeho datum/text/permalink, přípravu návrhu, redakční schválení a zdrojový odkaz u článku. Token nesmí být na videu. Konkrétní požadavky na přístup kontrolora a video ověřit v aktuální žádosti Meta.

Kontrolor potřebuje přístup ke skutečné funkci. Pro něj připravit oddělené testovací nasazení s vlastní databází a testovacím účtem hlavního redaktora; produkční účet ani jeho přihlašovací kód nesdílet. Tento commit nevytváří testovací účet ani nenahrává video. Bez platného testovacího tokenu nelze doložit živé načtení.

Dokumentace: [Page Public Content Access](https://developers.facebook.com/docs/features-reference/page-public-content-access/), [Page posts](https://developers.facebook.com/docs/graph-api/reference/page/posts/), [App Review](https://developers.facebook.com/docs/app-review/).
