# Přihlášení do redakce kódem z e-mailu

Do redakce (`/redakce`) se přihlašuje e-mailem. Člověk zadá e-mail, drbna mu na něj pošle šestimístný kód (a odkaz) a po jeho zadání ho pustí dovnitř. Hesla se nepoužívají. Kdo nemá v redakci účet s tím e-mailem, kód nedostane, stránka mu ale řekne totéž co ostatním, ať nejde zjistit, které e-maily redakce zná.

Kód platí 10 minut a jde zadat pětkrát. Na jeden e-mail jde poslat nejvýš 5 kódů za hodinu, z jedné IP adresy 20. Formulář hlídá Turnstile (stejný widget jako chat, tajemství `TURNSTILE_SITE_KEY` a `TURNSTILE_SECRET`).

Přihlášení platí, dokud člověk v redakci něco dělá. Po nastavené době nečinnosti (výchozí 2 hodiny) a nejpozději po nejdelší době (výchozí 30 dní) chce redakce nový kód. Obojí mění hlavní redaktor v sekci **Lidé → Přihlášení**. V sekci **Můj účet** je seznam přihlášených zařízení a jde je odhlásit, každé zvlášť nebo všechna ostatní najednou. Tlačítko **Odhlásit** odhlásí jen tohle zařízení a vrátí na titulku webu.

## Odesílání e-mailů

Kódy chodí přes **Cloudflare Email Service** (binding `EMAIL` ve `wrangler.toml`, kód v `src/mail.js`) z adresy `redakce@kopidlenskadrbna.org`. Potřebuje Workers Paid a doménu přidanou pro odesílání:

1. V dashboardu Cloudflare otevři **Compute → Email Service → Email Sending**.
2. **Onboard Domain** a vyber `kopidlenskadrbna.org`.
3. Cloudflare přidá do DNS záznamy MX (vrácené e-maily), SPF, DKIM a DMARC. Před potvrzením je projdi: když na doméně přijímáš poštu jinde, nesmí se přepsat tvoje MX.
4. **Done**.

Bez toho Cloudflare e-mail odmítne a redakce ukáže „E-mail se nepodařilo odeslat“.

## Přechod z Cloudflare Access

Drž se tohohle pořadí, ať se neodřízneš:

1. Přidej doménu do Email Service (výše).
2. Zkontroluj, že každý v redakci má v účtu e-mail (dosud ho vyžadoval Access, takže by měl).
3. Nasaď: `npm run deploy`. Access zatím nech zapnutý, chvíli bude chtít přihlášení dvakrát.
4. Otevři `/redakce`, zadej svůj e-mail a přihlas se kódem. Když kód nepřijde, vrať předchozí verzi (`npx wrangler rollback`) a podívej se do logů Workeru.
5. Teprve teď v **Cloudflare One → Access controls → Applications** smaž aplikaci „Redakce drbny“ a smaž tajemství:

   ```bash
   npx wrangler secret delete ACCESS_TEAM
   npx wrangler secret delete ACCESS_AUD
   ```

## Nový člověk v redakci

V sekci **Lidé → Nový přispěvatel** vyplň jméno a e-mail. Víc nic: kód mu přijde na ten e-mail. Vypnutý účet se odhlásí ze všech zařízení.

## Místně a v náhledu

`npm run dev` i `npm run nahled` běží s `LOGIN_CODE_ECHO=1`: e-mail nikam nejde a kód se ukáže přímo na přihlašovací stránce (jen na `localhost` a `127.0.0.1`). V náhledu (`npm run nahled:db`) má hlavní redaktor e-mail `redakce@example.cz`. Když místní databáze žádný e-mail nemá, přihlašovací stránka napíše, jak ho nastavit.
