# Uzavírky silnic z Dopravního info (NDIC)

Drbna umí přijímat uzavírky a omezení silnic z Národního dopravního informačního centra (NDIC, patří pod ŘSD). Je to ten zdroj, ze kterého bere data web dopravniinfo.cz.

Uzavírky si drbna nestahuje sama. Posílá je NDIC na adresu drbny, a to pokaždé, když se nějaká uzavírka změní (tomu se říká PUSH). Proto musí být drbna nasazená a adresa nastavená dřív, než v portálu NDIC založíš odběr.

Co se pak děje:

- Uzavírky z okolí Kopidlna se ukážou na stránce **Odstávky a uzavírky** a v kartě na titulce. Skončené zmizí samy.
- Se zapnutou Kozou Drběnou je Drběna přepíše lidsky. Když už stejná uzavírka na drbně je (třeba od města z Munipolisu), schová ji jako duplicitu. K delší uzavírce napíše článek do rubriky Praktické, rovnou na web, nebo jako návrh.
- V redakci je všechno pod **Odstávky → Uzavírky z Dopravního info**.

Názvy tlačítek v portálu NDIC a v Cloudflare se můžou trochu lišit.

## Postup

Drž se tohohle pořadí.

### 1. Registrace a licence v portálu NDIC

Portál je na [mobilitydata.rsd.cz](https://mobilitydata.rsd.cz).

1. Přihlas se a v **Odběratel** zaškrtni **Souhlasím s licenčními podmínkami** a ulož.
2. Podmínky (Podmínky používání digitalizovaných informací o silničním provozu) podepsané pošli na `mobilitydata@rsd.cz`, pokud to po tobě portál chce.
3. Počkej, až ŘSD souhlas potvrdí. Dřív odběr nezakládej.

### 2. Vymysli jméno a heslo pro příjem

Tímhle jménem a heslem se bude NDIC hlásit na drbně. Nemá nic společného s přihlášením do portálu NDIC.

- Jméno: třeba `ndic`.
- Heslo: dlouhé a náhodné, třeba z příkazu:

```bash
openssl rand -base64 24
```

Obojí si poznamenej, v kroku 5 to zadáš i do portálu NDIC.

### 3. Předej jméno a heslo Workeru

```bash
npx wrangler secret put NDIC_PUSH_USER       # vložíš jméno, třeba: ndic
npx wrangler secret put NDIC_PUSH_PASSWORD   # vložíš heslo z kroku 2
```

Bez nich je příjem vypnutý a adresa odpovídá „Příjem uzavírek není nastavený.“

### 4. Nasaď a vyzkoušej adresu

```bash
npm run deploy
```

Adresa pro NDIC je `https://<adresa-drbny>/ndic/uzavirky`. Přesně ji ukazuje redakce v **Odstávky → Uzavírky z Dopravního info**.

Vyzkoušej ji:

```bash
curl -i https://<adresa-drbny>/ndic/uzavirky
# čekáš 401 a „Přihlaste se.“

curl -i -u 'ndic:HESLO' https://<adresa-drbny>/ndic/uzavirky
# čekáš 405 a „Sem se posílá POST.“ To znamená, že jméno a heslo sedí.
```

Kdyby místo toho přišla přihlašovací stránka Cloudflare, hlídá Cloudflare Access i tuhle adresu. Access má hlídat jen cestu `/redakce` (viz [NAVOD-ACCESS.md](NAVOD-ACCESS.md)). Uprav aplikaci v Accessu, nebo pro cestu `ndic` přidej pravidlo s akcí **Bypass**.

### 5. Založ odběr v portálu NDIC

1. **Zdroje dat** → najdi **DATEX II - Uzavírky a omezení (v2)** → založit odběr.
2. Vyplň:
   - **URL**: adresa z kroku 4 (`https://<adresa-drbny>/ndic/uzavirky`).
   - **Jméno a heslo** (Basic authentication): stejné jako v kroku 2.
   - **Komprese gzip**: zapnout.
   - **Souřadnicový systém**: je to jedno, drbna umí S-JTSK i WGS-84.
   - **Geografický filtr (oblast)**: co nejmenší oblast, ve které leží Kopidlno, třeba okres Jičín nebo Královéhradecký kraj. Celá republika by posílala zbytečně moc dat (drbna si stejně nechává jen uzavírky do 50 km).
3. Ulož. Odběr je nejdřív **Čeká na vyřízení**, správce NDIC ho musí schválit.

Po schválení pošle NDIC hned všechny právě platné uzavírky z oblasti a dál jen změny.

### 6. Zkontroluj v redakci

V **Odstávky → Uzavírky z Dopravního info**:

- Nahoře má být **Poslední zpráva od NDIC** s datem a počtem situací. Když tam je pořád „Od NDIC zatím nic nepřišlo“, odběr ještě není schválený, nebo nesedí adresa či heslo.
- V **Přijatých uzavírkách** je vidět, co přišlo, jak daleko to je od Kopidlna a jestli se to ukazuje na webu.

### 7. Nastav, co se má dít

V **Nastavení** na stejné stránce:

- **Ukazovat uzavírky z Dopravního info na webu**: hlavní vypínač.
- **Okruh kolem Kopidlna (km)**: na webu jsou jen uzavírky, které mají nejbližší místo do téhle vzdálenosti. Výchozích 10 km.
- **Koza Drběna uzavírky přepisuje a píše k nim články**: zapne Drběnu. Potřebuje tajemství `ANTHROPIC_API_KEY` (stejné jako Munipolis).
- **Článek k uzavírce od (dní)**: k uzavírce, která zasahuje aspoň do tolika dní (počítá se první i poslední den), napíše Drběna i článek. Uzavírka do odvolání ho dostane vždy. Výchozí 2.
- **Články rovnou na web**: jinak čekají jako návrh ve **Zprávách**. Na začátek je dobré nechat vypnuté a první články zkontrolovat.

U každé uzavírky jde:

- **Skrýt**: na webu se neukáže.
- **Ukázat i tak**: ukáže se, i když je mimo okruh, nemá polohu, nebo ji Drběna měla za duplicitu.
- **Vrátit automaticky**: zruší ruční skrytí nebo ukázání.
- **Zpracovat znovu**: Drběna se na ni podívá znovu (přepis a duplicita). Článek, který už napsala, zůstane a druhý nevznikne.

## Když něco nejde

### Drbna byla dlouho nedostupná

NDIC zkouší nedoručené zprávy posílat znovu zhruba 24 hodin. Pak odběr zastaví. Po obnovení počkej asi 15 minut: když v redakci nepřibude nová zpráva od NDIC, odběr je zastavený.

1. V redakci dej **Smazat vše** (u Přijatých uzavírek). Uzavírky se jen schovají a zapamatuje se, co k nim napsala Drběna.
2. V portálu NDIC u odběru dej **Obnovit** (spustit znovu) a pak **Reset**. NDIC pošle všechny platné uzavírky znovu.

Uzavírky, které NDIC pošle znovu, se vrátí i s přepisem a článkem. Ty, které už neplatí, se za týden smažou.

### Na webu je uzavírka, která už skončila

Nejspíš se nepovedlo zpracovat zprávu o jejím zkrácení. Udělej totéž co výš: **Smazat vše** a v portálu **Reset**.

### V redakci je hlášená chyba

- „Přišla zpráva, která není DATEX II.“: v odběru je zvolený jiný formát, než DATEX II.
- „Zpráva od NDIC byla moc velká.“: zmenši v odběru oblast.
- „Zprávu se nepodařilo zpracovat…“: chyba na straně drbny. NDIC to zkusí znovu sám, když to trvá, ozvi se.

## Licence

Podle podmínek ŘSD:

- U uzavírek, které drbna ukazuje beze změny, musí být věta „Zdrojem digitalizovaných informací o silničním provozu je NDIC.“ Drbna ji na stránku Odstávky a uzavírky dává sama.
- U textu, který Drběna přepsala, a v článcích se NDIC jako zdroj uvádět nesmí. Drbna ho tam proto nepíše.
- Data se nesmí dávat dál v nezpracované podobě a nesmí to vypadat, že drbnu provozuje nebo za ni ručí ŘSD.

## Přechod na kopidlenskadrbna.org

Až drbna pojede na vlastní doméně, změň v portálu NDIC u odběru **URL** na `https://kopidlenskadrbna.org/ndic/uzavirky`. Jméno a heslo zůstávají. Přesnou adresu zase ukáže redakce.
