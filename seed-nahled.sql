-- Ukázkové zprávy jen pro místní náhled a smoke test. Na produkci se nenahrávají.

insert into articles (slug, title, excerpt, body, category)
select
  'vitejte',
  'Vítejte u Kopidlenské drbny',
  'Sousedské noviny pro Kopidlno a jeho části. Místní zprávy, pozvánky a praktické věci, bez úřední hatmatilky.',
  'Kopidlenská drbna je neoficiální vývěska pro lidi z Kopidlna, Drahorazi, Mlýnce, Pševesi a Ledkova.

Chceme, aby tu bylo příjemně, přehledně a hlavně místně. Nejsme městský úřad a nenahrazujeme úřední desku. Píšeme to, co se mezi námi chystá a hodí vědět.

Na titulce najdete poslední zprávy, nejbližší akce a hlavně kdy přijede popelářský vůz.',
  'Komunita'
where not exists (select 1 from articles where slug = 'vitejte');

insert into articles (slug, title, excerpt, body, category)
select
  'svoz-jednou-za-ctrnact-dni',
  'Směsný odpad se sváží jednou za čtrnáct dní',
  'Od roku 2024 jezdí v Kopidlně popelnice na směsný odpad v pondělí lichých týdnů. Nejbližší termín hlídáme spolu s popelnicemi.',
  'Od roku 2024 město přešlo na čtrnáctidenní svoz směsného komunálního odpadu z popelnic a kontejnerů. Týdenní interval skončil.

Drbna drží stejné pravidlo jako stránka popelnice.kopidlenskadrbna.org: svoz vychází na pondělí lichého kalendářního týdne. Svoz zpravidla probíhá i o svátcích.

Nejbližší den je na stránce Popelnice. Když se rytmus změní, redakce ho v administraci přepne a přepočítají se všechny termíny. Není to úřední harmonogram města — ten berte vždy z oficiálních zdrojů.',
  'Praktické'
where not exists (select 1 from articles where slug = 'svoz-jednou-za-ctrnact-dni');

insert into articles (slug, title, excerpt, body, category)
select
  'kopidlno-mezi-namestim-a-castmi',
  'Kopidlno mezi náměstím a částmi',
  'Hilmarovo náměstí, zámek a čtyři části, které k městu patří. Ať se v drbně vyzná i ten, kdo tu není odmalička.',
  'Kopidlno leží v okrese Jičín. Centrem je Hilmarovo náměstí, nad městem stojí zámek a k městu patří Drahoraz, Mlýnec, Pševes a Ledkov.

Drbna má být společná pro celé to území. Když se něco děje jen v jedné části, patří to sem stejně jako plakát z náměstí.

Úřední věci, vyhlášky a poplatky vždy berte z webu města. Tady je sousedský přehled, ne úřední deska.',
  'Zprávy'
where not exists (select 1 from articles where slug = 'kopidlno-mezi-namestim-a-castmi');

insert into articles (slug, title, excerpt, body, category)
select
  'jak-poslat-tip',
  'Jak poslat tip do redakce',
  'Krátce, s místem a časem. Redakce text uveřejní, upraví, nebo ho nechá být, když nejde ověřit.',
  'Máte pozvánku, ztrátu, otevření, uzavírku nebo něco, co by sousedé měli vědět?

Napište to věcně: co, kde, kdy a koho se to týká. Čím kratší, tím spíš se to vejde na titulku.

Texty vkládá redakce. Veřejný formulář tu schválně není, ať se tu nehromadí cizí jména a telefony. Kontakt na redakci je na stránce O nás, až si ho doplníte.',
  'Komunita'
where not exists (select 1 from articles where slug = 'jak-poslat-tip');
