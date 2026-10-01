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
  ('hero_alt', 'Koza Drběna, maskot Kopidlenské drbny'),
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
  ('bins_alt', 'Koza Drběna v montérkách s popelnicí na kopidlenském náměstí'),
  ('countdown_today', 'Svoz je dnes.'),
  ('countdown_tomorrow', 'Svoz je zítra.'),
  ('countdown_few', 'Za {n} dny.'),
  ('countdown_many', 'Za {n} dní.'),
  ('popelnice_label', 'popelnice.kopidlenskadrbna.org'),
  ('popelnice_url', 'https://popelnice.kopidlenskadrbna.org/'),
  ('about_description', 'Sousedská, ne úřední stránka pro Kopidlno a jeho části.'),
  ('about_eyebrow', 'O stránce'),
  ('about_heading', 'Sousedská, ne úřední'),
  ('about_body', 'Kopidlenská drbna je sousedský projekt od místních pro místní.

Vznikla proto, aby bylo jednodušší zjistit, co se u nás děje, co se chystá, kam vyrazit nebo co by nám nemělo uniknout. Najdete tu praktické informace, pozvánky, zajímavosti i obyčejné sousedské zprávy.

Drbnu provozuje Daniel Meca ve svém volném čase a na vlastní náklady. Není to stránka města, úřadu ani žádné politické strany.

Je to prostě místo, kde si můžeme mezi sebou předávat informace, tipy a novinky z našeho okolí.

Máte něco, co by měli vědět i ostatní? Dejte nám vědět. Drbna je tu pro nás všechny.'),
  ('about_bins_link', 'Svoz popelnic'),
  ('about_alt', 'Koza Drběna, maskot Kopidlenské drbny'),
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

create table if not exists outage_areas (
  id integer primary key autoincrement,
  code text not null unique,
  name text not null,
  enabled integer not null default 1,
  sort_order integer not null default 100
);

create table if not exists outage_feed (
  id integer primary key,
  fetched_at text,
  status text not null default '',
  note text not null default '',
  payload text not null default '[]',
  fetching_at text
);

insert into outage_feed (id, payload)
select 1, '[]'
where not exists (select 1 from outage_feed where id = 1);

create table if not exists rubrics (
  id integer primary key autoincrement,
  parent_id integer,
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0
);

insert into rubrics (parent_id, name, slug, sort_order)
select null, 'Zprávy', 'zpravy', 10
where not exists (select 1 from rubrics where slug = 'zpravy');

insert into rubrics (parent_id, name, slug, sort_order)
select null, 'Komunita', 'komunita', 20
where not exists (select 1 from rubrics where slug = 'komunita');

insert into rubrics (parent_id, name, slug, sort_order)
select null, 'Kultura', 'kultura', 30
where not exists (select 1 from rubrics where slug = 'kultura');

insert into rubrics (parent_id, name, slug, sort_order)
select null, 'Praktické', 'prakticke', 40
where not exists (select 1 from rubrics where slug = 'prakticke');

insert into rubrics (parent_id, name, slug, sort_order)
select null, 'Sport', 'sport', 50
where not exists (select 1 from rubrics where slug = 'sport');

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

create table if not exists notices (
  id integer primary key autoincrement,
  kind text not null,
  title text not null,
  starts_on text not null,
  starts_time text not null default '',
  ends_on text not null default '',
  ends_time text not null default '',
  places text not null default '',
  note text not null default '',
  source_url text not null default '',
  published integer not null default 0,
  created_at text not null default (date('now'))
);

create table if not exists import_settings (
  id integer primary key,
  enabled integer not null default 0,
  feed_url text not null default '',
  auto_publish integer not null default 0,
  voice text not null default '',
  since text not null default '',
  checked_at text,
  status text not null default '',
  note text not null default '',
  running_at text
);

create table if not exists import_items (
  id integer primary key autoincrement,
  guid text not null unique,
  link text not null default '',
  title text not null,
  text text not null default '',
  images text not null default '[]',
  published_at text not null default '',
  status text not null default 'nove',
  reason text not null default '',
  duplicate_of text not null default '',
  article_id integer,
  proposal_id integer,
  event_id integer,
  notice_id integer,
  attempts integer not null default 0,
  created_at text not null default (datetime('now')),
  processed_at text
);

insert into import_settings (id)
select 1
where not exists (select 1 from import_settings where id = 1);
