create table if not exists settings (
  id integer primary key,
  password_hash text not null,
  session_token text,
  password_is_default integer not null default 1,
  contact_note text not null,
  waste_note text not null,
  holiday_note text not null,
  weekday integer not null default 1,
  week_parity integer not null default 1,
  step_days integer not null default 14
);

create table if not exists articles (
  id integer primary key autoincrement,
  slug text not null unique,
  title text not null,
  excerpt text not null,
  body text not null,
  category text not null,
  image_key text,
  published integer not null default 1,
  created_at text not null default (date('now'))
);

create table if not exists events (
  id integer primary key autoincrement,
  title text not null,
  place text not null,
  starts_on text not null,
  starts_time text not null default '',
  description text not null,
  published integer not null default 1
);

insert into settings (
  id,
  password_hash,
  password_is_default,
  contact_note,
  waste_note,
  holiday_note,
  weekday,
  week_parity,
  step_days
)
select
  1,
  'pbkdf2:6b6f7069646c656e736b612d6472626e612d7631:71910d0f1a33b6ce8f9647f30734fbf39e392f5194eaa5fcfc68df6730249132',
  1,
  'Kontakt na redakci si doplníte v administraci. Neposílejte sem úřední podání — ta patří na podatelnu města.',
  'Přehled svozu pro Kopidlno. Termíny se počítají jako na popelnice.kopidlenskadrbna.org: jednou za 14 dní v pondělí lichých kalendářních týdnů.',
  'Svoz zpravidla probíhá i o svátcích',
  1,
  1,
  14
where not exists (select 1 from settings where id = 1);

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
