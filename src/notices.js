// Odstávky vody a uzavírky silnic: oznámení s časem a místy, která zapisuje redakce nebo import z Munipolisu.
// Na rozdíl od elektřiny je nikdo nestahuje z API, takže mají vlastní tabulku a vlastní kartu.
import { formatLong } from "./format.js";
import { addDays, pragueNow } from "./waste.js";

export const NOTICE_KINDS = {
  voda: { label: "Odstávka vody", short: "Voda", fallbackTitle: "Nepoteče voda" },
  uzavirka: { label: "Uzavírka silnice", short: "Uzavírka", fallbackTitle: "Uzavírka silnice" },
};
// Druhy, které se ukazují na webu (stránka Odstávky a uzavírky a karta na titulce).
export const PUBLIC_NOTICE_KINDS = ["voda", "uzavirka"];
export const NOTICE_LEAD_DAYS = 7;
const PLACE_LIMIT = 30;

const PHASE_STATE = {
  voda: { now: "Právě neteče", soon: "Chystá se", later: "Naplánováno" },
  uzavirka: { now: "Právě uzavřeno", soon: "Chystá se", later: "Naplánováno" },
};

function clean(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function isoDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return text;
}

export function clockTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

export function placeLines(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const line = clean(raw, 160);
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
    if (out.length >= 60) break;
  }
  return out;
}

export function parseNoticeInput(input) {
  const kind = Object.hasOwn(NOTICE_KINDS, String(input?.kind ?? "")) ? String(input.kind) : "";
  if (!kind) return { ok: false, error: "Vyberte, jestli jde o vodu, nebo uzavírku." };
  const startsOn = isoDate(input?.startsOn);
  if (!startsOn) return { ok: false, error: "Doplňte den, kdy to začíná." };
  const endsOn = isoDate(input?.endsOn);
  if (endsOn && endsOn < startsOn) return { ok: false, error: "Konec nemůže být dřív než začátek." };
  const startsTime = clockTime(input?.startsTime);
  const endsTime = clockTime(input?.endsTime);
  if ((!endsOn || endsOn === startsOn) && startsTime && endsTime && endsTime <= startsTime) {
    return { ok: false, error: "Čas konce musí být po začátku." };
  }
  const places = placeLines(input?.places);
  if (!places.length) return { ok: false, error: "Doplňte aspoň jednu ulici nebo místo." };
  const source = String(input?.sourceUrl ?? "").trim();
  return {
    ok: true,
    notice: {
      kind,
      title: clean(input?.title, 120) || NOTICE_KINDS[kind].fallbackTitle,
      startsOn,
      startsTime,
      endsOn: endsOn && endsOn !== startsOn ? endsOn : "",
      endsTime,
      places,
      note: clean(input?.note, 600),
      sourceUrl: /^https:\/\/[^\s"<>]+$/i.test(source) ? source.slice(0, 300) : "",
      published: Boolean(input?.published),
    },
  };
}

function bounds(notice) {
  const start = `${notice.startsOn} ${notice.startsTime || "00:00"}`;
  const end = `${notice.endsOn || notice.startsOn} ${notice.endsTime || "23:59"}`;
  return { start, end };
}

export function noticePhase(notice, now = new Date()) {
  const clock = pragueNow(now);
  const stamp = `${clock.date} ${clock.time}`;
  const { start, end } = bounds(notice);
  if (end < stamp) return "past";
  if (start <= stamp) return "now";
  if (notice.startsOn <= addDays(clock.date, NOTICE_LEAD_DAYS)) return "soon";
  return "later";
}

function softDay(iso) {
  const day = formatLong(iso);
  return day.charAt(0).toLowerCase() + day.slice(1);
}

export function noticeSpan(notice) {
  const { startsOn, startsTime, endsOn, endsTime } = notice;
  if (!endsOn) {
    if (startsTime && endsTime) return `${formatLong(startsOn)}, ${startsTime}–${endsTime}`;
    if (startsTime) return `${formatLong(startsOn)} od ${startsTime}`;
    if (endsTime) return `${formatLong(startsOn)} do ${endsTime}`;
    return formatLong(startsOn);
  }
  const from = `${formatLong(startsOn)}${startsTime ? ` ${startsTime}` : ""}`;
  const to = `${softDay(endsOn)}${endsTime ? ` ${endsTime}` : ""}`;
  return `${from} – ${to}`;
}

export function presentNotice(notice, now = new Date()) {
  const phase = noticePhase(notice, now);
  return {
    ...notice,
    phase,
    kindLabel: NOTICE_KINDS[notice.kind]?.label ?? "",
    state: PHASE_STATE[notice.kind]?.[phase] ?? "",
    when: noticeSpan(notice),
    placeLabels: notice.places.slice(0, PLACE_LIMIT),
    morePlaces: Math.max(0, notice.places.length - PLACE_LIMIT),
  };
}

const PHASE_ORDER = { now: 0, soon: 1, later: 2 };

// Co z oznámení patří na web: jen zveřejněné, jen druhy, které už mají na webu místo, a ne proběhlé.
export function noticeBoard(notices, now = new Date()) {
  return (notices ?? [])
    .filter((notice) => notice.published && PUBLIC_NOTICE_KINDS.includes(notice.kind))
    .map((notice) => presentNotice(notice, now))
    .filter((item) => item.phase !== "past")
    .sort((a, b) => (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9) || bounds(a).start.localeCompare(bounds(b).start));
}
