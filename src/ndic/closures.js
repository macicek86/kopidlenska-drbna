// Uzavírky a omezení z NDIC (Dopravní info): vzdálenost od Kopidlna a převod na oznámení pro web.
import { pragueNow } from "../waste.js";

// Střed Kopidlna (náměstí) v S-JTSK (EPSG:5514, metry) a ve WGS-84.
export const KOPIDLNO_SJTSK = { x: -679183, y: -1024114 };
export const KOPIDLNO_WGS = { lat: 50.3307, lon: 15.2704 };
export const DEFAULT_RADIUS_KM = 10;
export const MAX_RADIUS_KM = 50;
// Co je dál, se ani neukládá: odběr může posílat celou republiku.
export const KEEP_RADIUS_KM = MAX_RADIUS_KM;

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function pointKm(point) {
  if (point.x != null) return Math.hypot(point.x - KOPIDLNO_SJTSK.x, point.y - KOPIDLNO_SJTSK.y) / 1000;
  return haversineKm(KOPIDLNO_WGS, point);
}

// Nejbližší bod uzavírky v km, nebo null, když zpráva polohu v souřadnicích nemá.
export function distanceKm(points) {
  const list = (points ?? []).map(pointKm).filter(Number.isFinite);
  if (!list.length) return null;
  return Math.round(Math.min(...list) * 10) / 10;
}

const CLOSED = new Set(["roadClosed", "carriagewayClosures", "closedPermanentlyForTheWinter", "overnightClosures", "intermittentShortTermClosures"]);
const ALTERNATE = new Set(["singleAlternateLineTraffic"]);
const LANES = new Set(["laneClosures", "narrowLanes", "contraflow", "lanesDeviated", "doNotUseSpecifiedLanesOrCarriageways"]);

function roadLabel(road) {
  const text = String(road ?? "").trim();
  if (!text) return "";
  if (/^\d+$/.test(text)) return `silnice č. ${text}`;
  if (/^D\d/i.test(text)) return `dálnice ${text.toUpperCase()}`;
  return `silnice ${text}`;
}

function vehicleNote(vehicles) {
  if (!vehicles) return "";
  if (vehicles.weight) return `pro vozidla nad ${String(vehicles.weight).replace(".", ",")} t`;
  if (vehicles.height) return `pro vozidla vyšší než ${String(vehicles.height).replace(".", ",")} m`;
  if (vehicles.types?.includes("lorry")) return "pro nákladní auta";
  return "";
}

export function closureKind(record) {
  const types = record.management ?? [];
  if (types.some((type) => CLOSED.has(type)) || record.capacityRemaining === 0) return "uzavirka";
  if (types.some((type) => ALTERNATE.has(type))) return "kyvadlo";
  if (types.some((type) => LANES.has(type))) return "pruh";
  return "omezeni";
}

export function closureTitle(record) {
  const road = roadLabel(record.roads?.[0]);
  const vehicles = vehicleNote(record.vehicles);
  const kind = closureKind(record);
  const head = {
    uzavirka: road ? `Uzavírka: ${road}` : "Uzavírka silnice",
    kyvadlo: road ? `Kyvadlový provoz: ${road}` : "Kyvadlový provoz",
    pruh: road ? `Omezení: ${road}` : "Omezení provozu",
    omezeni: road ? `Omezení: ${road}` : "Omezení provozu",
  }[kind];
  return `${head}${vehicles ? ` ${vehicles}` : ""}`.slice(0, 120);
}

function distanceLine(km) {
  if (km == null) return "";
  if (km < 1.5) return "v Kopidlně nebo hned u něj";
  return `asi ${Math.round(km)} km od Kopidlna`;
}

// ISO čas se zónou na pražské datum a čas.
export function pragueStamp(iso) {
  const date = new Date(String(iso ?? ""));
  if (!iso || Number.isNaN(date.getTime())) return { date: "", time: "" };
  return pragueNow(date);
}

// Platí záznam ještě? Skončené nebo pozastavené se z webu i z databáze berou pryč.
export function recordEnded(record, now = new Date()) {
  if (record.validityStatus === "suspended") return true;
  if (!record.endsAt) return false;
  const end = new Date(record.endsAt);
  return !Number.isNaN(end.getTime()) && end.getTime() < now.getTime();
}

// Uložená uzavírka jako oznámení (stejný tvar jako notices), ať ji web vykreslí stejně jako uzavírky od redakce.
export function closureNotice(row, { radiusKm = DEFAULT_RADIUS_KM, enabled = true } = {}) {
  const start = pragueStamp(row.startsAt);
  const end = pragueStamp(row.endsAt);
  const near = row.distanceKm != null && row.distanceKm <= radiusKm;
  const roads = (row.roads ?? []).map(roadLabel).filter(Boolean);
  const places = [roads.join(", "), distanceLine(row.distanceKm)].filter(Boolean).join(", ");
  const note = [...(row.comments ?? []), ...(row.detour ?? []).map((text) => `Objížďka: ${text}`)].join(" ").slice(0, 600);
  return {
    id: `ndic-${row.id}`,
    kind: "uzavirka",
    title: row.title,
    startsOn: start.date || pragueNow().date,
    startsTime: start.time === "00:00" ? "" : start.time,
    endsOn: end.date && end.date !== start.date ? end.date : "",
    endsTime: end.time === "23:59" ? "" : end.time,
    openEnded: !end.date,
    places: places ? [places] : [],
    note,
    sourceUrl: "",
    // Redakce může uzavírku skrýt, nebo ukázat i mimo okruh (třeba když zpráva nemá polohu).
    published: Boolean(enabled && row.manual !== "skryt" && (near || row.manual === "ukazat")),
    source: "ndic",
  };
}
