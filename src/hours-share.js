// Náhled při sdílení jednoho místa, ordinace či sběrného dvora (`?misto=6`, `?lekar=2`, `?dvur=1`).
// Část za # server ani Facebook nevidí, proto adresa nese řádek v dotazu. Canonical zůstává na stránce sekce,
// jen og:url, nadpis, popis a obrázek patří řádku. Facebook si náhled drží podle adresy, proto odkaz ke sdílení
// nese i otisk textu (`v=`): změní se text, změní se adresa a náhled se stáhne znovu.
import { homeNotice, numeric } from "./doctors.js";
import { compactWeek } from "./hours-compact.js";
import { HOME_LEAD_DAYS, placeNotices } from "./places.js";
import { addDays } from "./waste.js";

// Obrázek podle druhu upozornění; bez upozornění výchozí obrázek webu.
export const SHARE_IMAGES = {
  closed: "/og-hodiny-zavreno.webp",
  change: "/og-hodiny-zmena.webp",
  new: "/og-hodiny-nova.webp",
};

export const SHARE_KINDS = {
  misto: { path: "/oteviraci-doba", hours: "otevírací doba" },
  lekar: { path: "/lekari", hours: "ordinační hodiny" },
  dvur: { path: "/sberne-dvory", hours: "otevírací doba" },
};

const MAX_DESCRIPTION = 200;

function sentence(text) {
  const clean = String(text ?? "").trim();
  if (!clean) return "";
  const capital = `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`;
}

function lowerFirst(text) {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function clip(text) {
  if (text.length <= MAX_DESCRIPTION) return text;
  const cut = text.slice(0, MAX_DESCRIPTION - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
}

// Věta jako na titulce: „Knihovna má 12. 10. zavřeno. Školení.“, u jiných hodin i rozpis.
function noticeText(notice) {
  const lead = sentence(`${notice.name} ${lowerFirst(notice.state)}`);
  const detail = notice.detail ? `${lead.slice(0, -1)}: ${notice.detail}.` : lead;
  return [detail, sentence(notice.note)].filter(Boolean).join(" ");
}

function regularText(label, row, hours) {
  const week = compactWeek(row.week);
  const summary = week || (row.legacy ?? "");
  return [sentence(label), summary ? sentence(`${hours}: ${summary}`) : ""].filter(Boolean).join(" ");
}

function yardNotice(yard, today) {
  const horizon = addDays(today, HOME_LEAD_DAYS);
  const closure = (yard.closures ?? [])
    .filter((item) => item.endsOn >= today && item.startsOn <= horizon)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  if (!closure) return null;
  const from = numeric(closure.startsOn, today);
  const when = closure.startsOn === closure.endsOn ? from : `od ${from} do ${numeric(closure.endsOn, today)}`;
  return { name: yard.name, state: `Má ${when} zavřeno.`, detail: "", note: closure.reason, kind: "closed" };
}

// { title, description, image } pro řádek; image je cesta, nebo "" pro výchozí obrázek.
export function shareInfo(kind, row, today) {
  const spec = SHARE_KINDS[kind];
  const notice =
    kind === "misto"
      ? placeNotices(row, today)[0]
      : kind === "lekar"
        ? homeNotice(row, today)
        : yardNotice(row, today);
  const label = kind === "misto" ? row.label : kind === "lekar" ? row.specialty : row.place;
  const description = notice ? noticeText(notice) : regularText(label, row, spec.hours);
  return {
    title: `${row.name}: ${spec.hours}`,
    description: clip(description),
    image: notice ? (SHARE_IMAGES[notice.kind] ?? "") : "",
  };
}

// Krátký otisk textu náhledu (FNV-1a), jen aby se adresa změnila se změnou textu.
export function shareVersion(info) {
  let hash = 0x811c9dc5;
  for (const char of `${info.title}|${info.description}|${info.image}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// Adresa ke sdílení: řádek a otisk v dotazu, kotva sjede na kartu.
export function sharePath(kind, row, today) {
  const info = shareInfo(kind, row, today);
  return `${SHARE_KINDS[kind].path}?${kind}=${row.id}&v=${shareVersion(info)}#${kind}-${row.id}`;
}

// Řádek z adresy stránky (`?misto=6`), nebo null. Neznámé či skryté číslo se tiše ignoruje.
export function sharedRow(kind, rows, params) {
  const id = Number(params?.get?.(kind));
  if (!Number.isInteger(id) || id <= 0) return null;
  return (rows ?? []).find((row) => row.id === id) ?? null;
}

// Pole pro layout: vlastní nadpis, popis, obrázek a og:url; canonical zůstane na stránce sekce.
export function shareLayout(kind, row, today, siteName) {
  if (!row) return {};
  const info = shareInfo(kind, row, today);
  return {
    title: `${info.title} | ${siteName}`,
    description: info.description,
    ...(info.image ? { image: info.image, imageSize: true } : {}),
    canonical: SHARE_KINDS[kind].path,
    shareUrl: `${SHARE_KINDS[kind].path}?${kind}=${row.id}&v=${shareVersion(info)}`,
  };
}
