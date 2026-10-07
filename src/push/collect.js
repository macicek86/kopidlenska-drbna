// Co poslat: novinky od posledního běhu (zprávy, změny hodin, odstávky a uzavírky) a večerní připomínky na zítřek
// (sběrný dvůr otevřený, akce, svoz popelnic). Každá zpráva má klíč, podle kterého odejde jen jednou (push_sent).
import { liveArticle, sqlStamp } from "../db-core.js";
import { loadOutageBoard, loadYards } from "../db.js";
import { loadEvents } from "../events-db.js";
import { describeChange, loadHoursChanges } from "../feeds/hours.js";
import { formatLong } from "../format.js";
import { loadNoticeBoard } from "../notices-db.js";
import { addDays, buildWasteView } from "../waste.js";
import { yardStatus } from "../yards.js";

// Novinky starší než tohle se už neposílají (třeba po vypnutí a zapnutí upozornění).
export const FRESH_HOURS = 36;
const TITLE_MAX = 100;
const BODY_MAX = 180;

function short(text, max) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function message({ key, topic, targets = [], title, body = "", url = "/", image = "" }) {
  return { key, topic, targets, title: short(title, TITLE_MAX), body: short(body, BODY_MAX), url, image, tag: key };
}

export function articleMessage(row) {
  const targets = [row.rubric_id, row.parent_id].map(Number).filter((id) => id > 0);
  return message({
    key: `zprava-${row.id}`,
    topic: "zpravy",
    targets,
    title: row.title,
    body: row.excerpt,
    url: `/zpravy/${encodeURIComponent(row.slug)}`,
    image: row.image_key ? `/media/${row.image_key}` : "",
  });
}

const CHANGE_TOPIC = { misto: "hodiny", lekar: "lekari", dvur: "dvory" };
const CHANGE_PAGE = { misto: "/oteviraci-doba", lekar: "/lekari", dvur: "/sberne-dvory" };

export function changeMessage(change) {
  const { title, lines } = describeChange(change);
  return message({
    key: `zmena-${change.section}-${change.id}`,
    topic: CHANGE_TOPIC[change.section],
    targets: [change.ownerId],
    title,
    body: lines.filter(Boolean).join(". "),
    url: `${CHANGE_PAGE[change.section]}#${change.section}-${change.ownerId}`,
  });
}

export function noticeMessage(item) {
  return message({
    key: `oznameni-${item.id}`,
    topic: "odstavky",
    targets: [item.kind],
    title: item.title || item.kindLabel,
    body: [item.when, (item.placeLabels ?? []).join(", ")].filter(Boolean).join(". "),
    url: "/odstavky",
  });
}

export function powerMessage(item) {
  return message({
    key: `elektrina-${item.id}`,
    topic: "odstavky",
    targets: ["elektrina"],
    title: `Nepůjde proud: ${item.areaName}`,
    body: [item.when, (item.placeLabels ?? []).join(", ")].filter(Boolean).join(". "),
    url: "/odstavky",
  });
}

// Den (YYYY-MM-DD) z data ve feedu: „2026-10-07“, „2026-10-07 10:00:00“ i ISO.
function dayOf(stamp) {
  return String(stamp ?? "").slice(0, 10);
}

// Novinky. `today` je pražský den, `now` okamžik běhu.
export async function collectNews(env, today, now = new Date()) {
  const since = sqlStamp(new Date(now.getTime() - FRESH_HOURS * 3600_000));
  const fromDay = addDays(today, -1);
  const [articles, changes, notices, power] = await Promise.all([
    env.DB.prepare(
      `select a.id, a.slug, a.title, a.excerpt, a.image_key, a.rubric_id, r.parent_id
       from articles a left join rubrics r on r.id = a.rubric_id
       where ${liveArticle("a", now)} and a.published_at >= ? order by a.published_at, a.id`,
    )
      .bind(since)
      .all(),
    loadHoursChanges(env, today),
    loadNoticeBoard(env, now),
    loadOutageBoard(env),
  ]);
  return [
    ...(articles.results ?? []).map(articleMessage),
    ...changes.filter((change) => dayOf(change.createdAt) >= fromDay).map(changeMessage),
    ...notices.filter((item) => dayOf(item.addedAt) >= fromDay).map(noticeMessage),
    ...(power.items ?? []).filter((item) => dayOf(item.seenAt) >= fromDay).map(powerMessage),
  ];
}

function hoursText(from, to) {
  return `${from}–${to}`;
}

export function yardMessage(yard, tomorrow) {
  const status = yardStatus(yard, tomorrow, "00:00");
  if (status.kind !== "later") return null;
  return message({
    key: `dvur-${yard.id}-${tomorrow}`,
    topic: "dvory",
    targets: [yard.id],
    title: `Zítra je otevřeno: ${yard.name}`,
    body: [hoursText(status.from, status.to), yard.place].filter(Boolean).join(", "),
    url: `/sberne-dvory#dvur-${yard.id}`,
  });
}

export function eventMessage(event, tomorrow) {
  if (!event.published || event.cancelled || event.startsOn !== tomorrow) return null;
  return message({
    key: `akce-${event.id}-${tomorrow}`,
    topic: "akce",
    title: `Zítra: ${event.title}`,
    body: [event.startsTime, event.place].filter(Boolean).join(", "),
    url: event.articleSlug ? `/zpravy/${encodeURIComponent(event.articleSlug)}` : `/akce#akce-${event.id}`,
  });
}

export function binsMessage(waste, tomorrow) {
  if (waste.nextDate !== tomorrow) return null;
  return message({
    key: `svoz-${tomorrow}`,
    topic: "svoz",
    title: "Zítra se vyváží popelnice",
    body: `${formatLong(tomorrow)}. Nachystejte popelnici včas před dům.`,
    url: "/popelnice",
  });
}

// Večerní připomínky na zítřek.
export async function collectEvening(env, today) {
  const tomorrow = addDays(today, 1);
  const [yards, events, rule] = await Promise.all([
    loadYards(env, { publicOnly: true, today }),
    loadEvents(env, { publicOnly: true }),
    env.DB.prepare("select weekday, week_parity, step_days from settings where id = 1").first(),
  ]);
  const waste = rule
    ? buildWasteView({ weekday: Number(rule.weekday), weekParity: Number(rule.week_parity), stepDays: Number(rule.step_days) }, tomorrow)
    : null;
  return [
    ...yards.map((yard) => yardMessage(yard, tomorrow)),
    ...events.map((event) => eventMessage(event, tomorrow)),
    waste ? binsMessage(waste, tomorrow) : null,
  ].filter(Boolean);
}
