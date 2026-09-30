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
  created_at text not null default (date('now')),
  author_id integer,
  author_name text not null default '',
  redacted integer not null default 0
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

create table if not exists copy (
  key text primary key,
  value text not null
);

insert into copy (key, value) values
  ('site_name', 'Kopidlenská drbna'),
  ('brand_line', 'Kopidlenská'),
  ('brand_accent', 'drbna'),
  ('nav_news', 'Zprávy'),
  ('nav_events', 'Akce'),
  ('nav_ads', 'Reklamy'),
  ('nav_bins', 'Popelnice'),
  ('nav_about', 'O nás'),
  ('menu_label', 'Menu'),
  ('skip', 'Přeskočit na obsah'),
  ('link_whole', 'Celé noviny'),
  ('footer_copy', '© 2026 Kopidlenská drbna'),
  ('footer_fine', 'Neoficiální informační stránka — není provozována Městem Kopidlno.'),
  ('footer_admin', 'Redakce'),
  ('home_description', 'Místní zprávy a pozvánky pro Kopidlno a jeho části.'),
  ('hero_pill', 'Kopidlno a jeho části'),
  ('hero_title', 'Kopidlenská'),
  ('hero_accent', 'drbna'),
  ('hero_lede', 'Místní zprávy, pozvánky a sousedské novinky z Kopidlna, Drahorazi, Mlýnce, Pševesi a Ledkova. Neúřední, přehledné a odsud.'),
  ('hero_alt', 'Maskot Kopidlenské drbny, černobílý kozel'),
  ('home_waste_eyebrow', 'Popelnice'),
  ('home_waste_button', 'Kdy se sváží'),
  ('home_news_heading', 'Zprávy'),
  ('home_news_all', 'Všechny'),
  ('home_events_heading', 'Akce'),
  ('home_events_all', 'Kalendář'),
  ('empty_articles', 'Zatím tu není žádná zpráva.'),
  ('empty_events', 'Zatím tu není zveřejněná pozvánka. Až ji redakce přidá, objeví se tady.'),
  ('news_description', 'Místní zprávy z Kopidlna a jeho částí.'),
  ('news_eyebrow', 'Rubrika'),
  ('news_heading', 'Zprávy'),
  ('chip_all', 'Vše'),
  ('cat_zpravy', 'Zprávy'),
  ('cat_komunita', 'Komunita'),
  ('cat_kultura', 'Kultura'),
  ('cat_prakticke', 'Praktické'),
  ('cat_sport', 'Sport'),
  ('news_empty', 'V téhle rubrice zatím nic není.'),
  ('article_back', 'Zpět na zprávy'),
  ('missing_heading', 'Tahle zpráva tu není'),
  ('missing_description', 'Tahle zpráva tu není.'),
  ('events_description', 'Pozvánky z Kopidlna a okolních částí.'),
  ('events_eyebrow', 'Kalendář'),
  ('events_heading', 'Akce'),
  ('events_lede', 'Pozvánky z Kopidlna a okolních částí. Co tu není, redakce ještě nepřidala.'),
  ('events_upcoming', 'Chystá se'),
  ('events_upcoming_empty', 'Žádná zveřejněná pozvánka. Až bude, objeví se tady.'),
  ('events_past', 'Už proběhlo'),
  ('bins_description', 'Nejbližší svoz směsného odpadu v Kopidlně.'),
  ('bins_title', 'Kdy se sváží'),
  ('bins_standalone', 'Popelnice'),
  ('bins_pill', 'Nejbližší svoz'),
  ('bins_more', 'Další termíny'),
  ('bins_kind', 'Směsný komunální odpad'),
  ('bins_alt', 'Kozel v montérkách s popelnicí na kopidlenském náměstí'),
  ('countdown_today', 'Svoz je dnes.'),
  ('countdown_tomorrow', 'Svoz je zítra.'),
  ('countdown_few', 'Za {n} dny.'),
  ('countdown_many', 'Za {n} dní.'),
  ('popelnice_label', 'popelnice.kopidlenskadrbna.org'),
  ('popelnice_url', 'https://popelnice.kopidlenskadrbna.org/'),
  ('about_description', 'Sousedská, ne úřední stránka pro Kopidlno a jeho části.'),
  ('about_eyebrow', 'O stránce'),
  ('about_heading', 'Sousedská, ne úřední'),
  ('about_lede', 'Kopidlenská drbna je místní noviny pro Kopidlno, Drahoraz, Mlýnec, Pševes a Ledkov. Píšeme zprávy, pozvánky a praktické věci, hlavně kdy vyvézt popelnici.'),
  ('about_disclaimer', 'Stránku neprovozuje Město Kopidlno. Vyhlášky, poplatky a úřední oznámení berte vždy z webu města.'),
  ('about_bins_link', 'Svoz popelnic'),
  ('about_alt', 'Maskot Kopidlenské drbny'),
  ('about_ads_link', 'Reklamy'),
  ('ads_description', 'Neplacené místní reklamy z Kopidlna a jeho částí.'),
  ('ads_eyebrow', 'Rubrika'),
  ('ads_heading', 'Reklamy'),
  ('ads_lede', 'Neplacené nabídky od sousedů. Na panelu je napsáno, že jde o reklamu. Občas se stejný panel objeví i mezi zprávami nebo u pozvánky.'),
  ('ads_empty', 'Zatím tu není žádná nabídka. Přidá ji kdokoli z redakce.'),
  ('ads_back', 'Všechny reklamy'),
  ('ads_flag', 'Reklama'),
  ('ads_sample', 'ukázka'),
  ('ads_more', 'Víc'),
  ('ads_missing', 'Tahle reklama tu není')
on conflict(key) do nothing;


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

create table if not exists users (
  id integer primary key autoincrement,
  login text not null unique,
  name text not null,
  alias text not null default '',
  password_hash text not null,
  role text not null,
  session_token text,
  active integer not null default 1,
  created_at text not null default (date('now'))
);

insert into users (login, name, password_hash, role)
select 'redakce', 'Redakce', password_hash, 'hlavni'
from settings
where id = 1 and not exists (select 1 from users);

create table if not exists proposals (
  id integer primary key autoincrement,
  article_id integer,
  author_id integer not null,
  author_name text not null,
  title text not null,
  excerpt text not null,
  body text not null,
  category text not null,
  image_key text,
  submitted_title text not null,
  submitted_excerpt text not null,
  submitted_body text not null,
  submitted_category text not null,
  status text not null default 'pending',
  note text not null default '',
  created_at text not null default (date('now'))
);

create table if not exists user_permissions (
  user_id integer not null,
  code text not null,
  primary key (user_id, code)
);

create table if not exists yards (
  id integer primary key autoincrement,
  name text not null,
  place text not null,
  accepts text not null,
  hours text not null,
  sort_order integer not null default 0,
  published integer not null default 1
);

create table if not exists yard_closures (
  id integer primary key autoincrement,
  yard_id integer not null,
  starts_on text not null,
  ends_on text not null,
  reason text not null,
  created_by integer,
  created_at text not null default (date('now'))
);

create table if not exists doctors (
  id integer primary key autoincrement,
  name text not null,
  specialty text not null,
  place text not null,
  phone text not null default '',
  hours text not null,
  sort_order integer not null default 0,
  published integer not null default 1
);

create table if not exists ads (
  id integer primary key autoincrement,
  slug text not null unique,
  title text not null,
  body text not null,
  place text not null default '',
  link text not null default '',
  image_key text,
  enabled integer not null default 1,
  sample integer not null default 0,
  author_id integer,
  author_name text not null default '',
  created_at text not null default (date('now'))
);

create table if not exists ad_proposals (
  id integer primary key autoincrement,
  ad_id integer,
  author_id integer not null,
  author_name text not null,
  title text not null,
  body text not null,
  place text not null default '',
  link text not null default '',
  image_key text,
  enabled integer not null default 1,
  status text not null default 'pending',
  note text not null default '',
  created_at text not null default (date('now'))
);

create table if not exists doctor_changes (
  id integer primary key autoincrement,
  doctor_id integer not null,
  starts_on text not null,
  ends_on text not null,
  note text not null,
  hours text not null,
  created_by integer,
  created_at text not null default (date('now'))
);
