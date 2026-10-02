# Přihlášení do redakce přes Cloudflare Access

Redakci (`/redakce`) hlídá Cloudflare Access. Kdo chce dovnitř, zadá e-mail, Cloudflare mu na něj pošle kód a pustí ho dál. Redakce pak podle e-mailu pozná, kdo to je a co smí. Hesla se nepoužívají.

Veřejný web zůstává otevřený, Access hlídá jen cestu `/redakce`.

Dokud Access nezapneš (kroky 5 a 6), redakce se přihlašuje heslem jako dřív. Místní vývoj a náhled se heslem přihlašují vždycky.

Názvy tlačítek v Cloudflare dashboardu se můžou trochu lišit.

## Postup

Drž se tohohle pořadí, jinak se do redakce nedostaneš.

### 1. Nasaď kód a vyplň e-maily

```bash
npm run deploy
```

Pak se v redakci přihlas heslem jako dosud:

- **Můj účet**: vyplň svůj e-mail a ulož.
- **Lidé**: u každého přispěvatele **Upravit** a vyplnit e-mail.

Bez e-mailu se po zapnutí Accessu nikdo z nich nepřihlásí.

### 2. Zapni Zero Trust (jen poprvé)

1. Na [dash.cloudflare.com](https://dash.cloudflare.com) otevři v levém menu **Zero Trust**.
2. Zvol si **název týmu**, třeba `drbna`. Vznikne z něj adresa `drbna.cloudflareaccess.com`. Ten název budeš potřebovat jako `ACCESS_TEAM`.
3. Vyber tarif **Free** (zdarma do 50 lidí). Cloudflare může chtít platební kartu, i když se nic neplatí.

### 3. Založ aplikaci pro redakci

„Aplikace“ je v Accessu jen záznam, který říká, jakou adresu hlídat a koho na ni pustit.

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Název: třeba `Drbna redakce`.
3. Adresa, kterou hlídat:
   - teď, při vývoji: subdoména `kopidlenska-drbna.<tvůj-účet>`, doména `workers.dev`, cesta `redakce` (přesnou adresu Workeru najdeš ve **Workers & Pages**),
   - až pojede vlastní doména: viz [Přechod na kopidlenskadrbna.org](#přechod-na-kopidlenskadrbnaorg).
4. **Policy** (pravidlo, koho pustit):
   - Action: **Allow**
   - Include: **Emails**, sem vypiš e-maily všech z redakce (stejné jako v redakci).
5. Ulož aplikaci.

Způsob přihlášení „kód na e-mail“ (**One-time PIN**) je zapnutý sám od sebe.

Pozor: v nastavení Workeru **nezapínej** Access pro celý Worker ani přepínač u `workers.dev`. To by zamklo i veřejný web.

### 4. Zkopíruj AUD

V aplikaci, kterou jsi právě založil, najdi **Application Audience (AUD) Tag**. Je to dlouhý řetězec písmen a čísel.

### 5. Předej oba údaje Workeru

```bash
npx wrangler secret put ACCESS_TEAM   # vložíš název týmu, třeba: drbna
npx wrangler secret put ACCESS_AUD    # vložíš AUD tag
```

Od té chvíle se redakce přihlašuje jen přes Access.

### 6. Vyzkoušej

V anonymním okně prohlížeče:

- `…workers.dev/` se otevře normálně, bez přihlašování.
- `…workers.dev/redakce` se zeptá na e-mail. Po zadání kódu z e-mailu jsi v redakci.
- E-mail, který v pravidle není, Cloudflare nepustí.

## Přidání a odebrání člověka

E-mail je potřeba na dvou místech:

1. **Cloudflare**: v **Zero Trust → Access → Applications → Drbna redakce → Policies** přidej e-mail do pravidla.
2. **Redakce**: v sekci **Lidé** přidej přispěvatele s tím e-mailem.

Když má někdo skončit, stačí mu v sekci Lidé vypnout účet. Dovnitř se nedostane hned, i když je v Cloudflare pořád uvedený. Pro pořádek ho odeber i z pravidla v Cloudflare.

Když nechceš e-maily vpisovat dvakrát, dej v pravidle místo **Emails** volbu **Everyone**. Cloudflare pak pustí každého, kdo si ověří e-mail kódem, a o zbytku rozhodne redakce: kdo v ní nemá účet, uvidí jen hlášku, že pro jeho e-mail účet není. Je to pohodlnější, ale o jednu vrstvu ochrany méně.

## Když se nemůžeš přihlásit

- **Vrátit hesla**: `npx wrangler secret delete ACCESS_AUD`. Redakce se zase přihlašuje heslem. Cloudflare tě ale dál pustí k `/redakce` jen s e-mailem z pravidla. Kdyby nepouštěl, aplikaci v Zero Trust smaž.
- **Dopsat svůj e-mail rovnou do databáze**:

  ```bash
  npx wrangler d1 execute kopidlenska-drbna --remote --command "update users set email='tvuj@email.cz' where role='hlavni'"
  ```

- **Hláška „Pro tenhle e-mail tu účet není“**: Cloudflare tě pustil, ale v redakci ten e-mail nikdo nemá, nebo je účet vypnutý. Zkontroluj překlep v sekci Lidé nebo Můj účet.

## Přechod na kopidlenskadrbna.org

Až drbna pojede na vlastní doméně:

1. Ve `wrangler.toml` odkomentuj `routes` a nahoru k `name` přidej `workers_dev = false` a `preview_urls = false`. Návod je i přímo v souboru. Pak `npm run deploy`.
2. V aplikaci v Zero Trust změň hlídanou adresu na tyhle tři, všechny s cestou `redakce`:
   - `kopidlenskadrbna.org`
   - `www.kopidlenskadrbna.org`
   - `popelnice.kopidlenskadrbna.org`
3. `ACCESS_TEAM` i `ACCESS_AUD` zůstávají, pokud je to pořád stejná aplikace.

## Jak to funguje uvnitř

Cloudflare ke každému požadavku do redakce přidá podepsaný token s e-mailem (hlavička `Cf-Access-Jwt-Assertion`). Worker ověří podpis proti klíčům tvého týmu, AUD, vydavatele a platnost (`src/access.js`) a podle e-mailu najde účet (`users.email`). Kdo přijde bez platného tokenu, třeba přes jinou adresu Workeru, dovnitř se nedostane.

Víc v dokumentaci Cloudflare: [Workers a Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
