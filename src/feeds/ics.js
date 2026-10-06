// iCalendar (RFC 5545) pro kalendář akcí k odběru: Google Kalendář, iPhone, Outlook.
import { addDays } from "../waste.js";
import { pragueOffset } from "../seo.js";

const CRLF = "\r\n";

// Text v hodnotě: zpětné lomítko, středník, čárka a konec řádku se escapují.
export function icsText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Řádek nejvýš 75 bajtů, pokračování začíná mezerou. Nerozdělí znak UTF-8 v půlce.
export function foldLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

function compactDate(iso) {
  return iso.replaceAll("-", "");
}

// Čas akce v Praze jako UTC („20261012T160000Z“), ať kalendář nepotřebuje VTIMEZONE.
export function utcStamp(date, time) {
  const offset = pragueOffset(date) || "+01:00";
  const parsed = new Date(`${date}T${time}:00${offset}`);
  return parsed.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Akce s časem začíná v ten čas (konec neznáme), bez času je celodenní.
function eventTimes(event) {
  const time = /^\d{1,2}:\d{2}$/.test(event.startsTime) ? event.startsTime.padStart(5, "0") : "";
  if (time) return [`DTSTART:${utcStamp(event.startsOn, time)}`];
  return [`DTSTART;VALUE=DATE:${compactDate(event.startsOn)}`, `DTEND;VALUE=DATE:${compactDate(addDays(event.startsOn, 1))}`];
}

// Kdy záznam vznikl (DTSTAMP): ze SQL času UTC, jinak pevné datum, ať se kalendář bez změny nemění (ETag).
function dtstamp(value) {
  const sql = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? ""));
  return sql ? `${sql[1]}${sql[2]}${sql[3]}T${sql[4]}${sql[5]}${sql[6]}Z` : "20260101T000000Z";
}

// calendar: { name, description, events: [{ uid, stamp, startsOn, startsTime, title, place, description, url }] }.
export function icsCalendar(calendar) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kopidlenská drbna//Akce//CS",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendar.name)}`,
    `X-WR-CALDESC:${icsText(calendar.description)}`,
    "X-WR-TIMEZONE:Europe/Prague",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const event of calendar.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsText(event.uid)}`,
      `DTSTAMP:${dtstamp(event.stamp)}`,
      ...eventTimes(event),
      `SUMMARY:${icsText(event.title)}`,
      ...(event.cancelled ? ["STATUS:CANCELLED"] : []),
      ...(event.place ? [`LOCATION:${icsText(event.place)}`] : []),
      ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
      // URL je typ URI, ne text: neescapuje se.
      ...(event.url ? [`URL:${event.url.replace(/[\s"]/g, "")}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
