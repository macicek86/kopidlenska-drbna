// Feed změn otevírací doby (/oteviraci-doba/feed.xml): dočasné změny a nová doba míst, změny u lékařů
// a uzavření sběrných dvorů. Běžné hodiny jsou ve strukturovaných datech stránek a v /oteviraci-doba.json.
import { text as tx } from "../copy.js";
import { hoursSummary, parseHours, periodClosed, spanSummary } from "../doctors.js";
import { formatShort } from "../format.js";
import { esc } from "../html.js";
import { NEW_HOURS_DAYS, PLACE_MISSING } from "../places.js";
import { addDays } from "../waste.js";
import { TAG, atomFeed } from "./atom.js";

export const HOURS_LIMIT = 50;

// Jen změny, které ještě platí nebo teprve přijdou (nová doba do NEW_HOURS_DAYS po začátku), a jen u zveřejněných.
export async function loadHoursChanges(env, today) {
  const [places, doctors, yards] = await Promise.all([
    env.DB.prepare(
      `select c.id, c.place_id as owner_id, c.kind, c.starts_on, c.ends_on, c.note, c.hours, c.created_at, p.name, p.label as detail
       from place_changes c join places p on p.id = c.place_id
       where p.published = 1 and ((c.kind = 'docasna' and c.ends_on >= ?) or (c.kind = 'trvala' and c.starts_on >= ?))
       order by c.created_at desc, c.id desc limit ?`,
    )
      .bind(today, addDays(today, -NEW_HOURS_DAYS), HOURS_LIMIT)
      .all(),
    env.DB.prepare(
      `select c.id, c.doctor_id as owner_id, c.starts_on, c.ends_on, c.note, c.hours, c.created_at, d.name, d.specialty as detail
       from doctor_changes c join doctors d on d.id = c.doctor_id
       where d.published = 1 and c.ends_on >= ? order by c.created_at desc, c.id desc limit ?`,
    )
      .bind(today, HOURS_LIMIT)
      .all(),
    env.DB.prepare(
      `select c.id, c.yard_id as owner_id, c.starts_on, c.ends_on, c.reason as note, c.created_at, y.name, y.place as detail
       from yard_closures c join yards y on y.id = c.yard_id
       where y.published = 1 and c.ends_on >= ? order by c.created_at desc, c.id desc limit ?`,
    )
      .bind(today, HOURS_LIMIT)
      .all(),
  ]);
  const map = (section) => (row) => ({
    section,
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    kind: row.kind === "trvala" ? "trvala" : "docasna",
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    endsOn: String(row.ends_on ?? "").slice(0, 10),
    note: String(row.note ?? ""),
    week: section === "dvur" ? [] : parseHours(row.hours),
    createdAt: String(row.created_at ?? ""),
    name: String(row.name ?? ""),
    detail: String(row.detail ?? ""),
  });
  return [
    ...(places.results ?? []).map(map("misto")),
    ...(doctors.results ?? []).map(map("lekar")),
    ...(yards.results ?? []).map(map("dvur")),
  ];
}

function span(change) {
  if (change.startsOn === change.endsOn) return formatShort(change.startsOn);
  return `${formatShort(change.startsOn)} – ${formatShort(change.endsOn)}`;
}

// Odkaz vede rovnou na kartu místa, lékaře nebo dvora.
const PAGES = { misto: "/oteviraci-doba", lekar: "/lekari", dvur: "/sberne-dvory" };

function changeUrl(base, change) {
  return `${base}${PAGES[change.section]}#${change.section}-${change.ownerId}`;
}

// Nadpis a řádky textu jedné změny.
export function describeChange(change) {
  if (change.section === "dvur") return { title: `${change.name}: zavřeno ${span(change)}`, lines: [change.note] };
  if (change.kind === "trvala") {
    return {
      title: `${change.name}: nová otevírací doba od ${formatShort(change.startsOn)}`,
      lines: [hoursSummary(change, PLACE_MISSING), change.note],
    };
  }
  const closed = periodClosed(change);
  const other = change.section === "lekar" ? "jiné ordinační hodiny" : "jiná otevírací doba";
  return {
    title: `${change.name}: ${closed ? "zavřeno" : other} ${span(change)}`,
    lines: [closed ? "" : spanSummary(change), change.note],
  };
}

export function hoursFeed(base, changes, copy) {
  const site = tx(copy, "site_name");
  const newest = [...changes]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, HOURS_LIMIT);
  const entries = newest.map((change) => {
    const { title, lines } = describeChange(change);
    const text = lines.filter(Boolean);
    return {
      id: `${TAG}zmena-${change.section}-${change.id}`,
      // Místa, lékaři a dvory mají vlastní řady id.
      seq: change.id * 3 + ["misto", "lekar", "dvur"].indexOf(change.section),
      title,
      url: changeUrl(base, change),
      updated: change.createdAt,
      published: change.createdAt,
      summary: [change.detail, ...text].filter(Boolean).join(". "),
      content: [change.detail ? `<p><em>${esc(change.detail)}</em></p>` : "", ...text.map((line) => `<p>${esc(line)}</p>`)].join(""),
    };
  });
  return atomFeed({
    id: `${TAG}zmeny-oteviraci-doby`,
    title: `${site}: změny otevírací doby`,
    subtitle: "Kdy mají v Kopidlně úřad, knihovna, lékaři a sběrné dvory zavřeno nebo jinak.",
    self: `${base}/oteviraci-doba/feed.xml`,
    alternate: `${base}/oteviraci-doba`,
    author: site,
    icon: `${base}/icon-192.png`,
    entries,
  });
}
