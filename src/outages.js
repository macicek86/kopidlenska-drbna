import { formatLong, formatShort } from "./format.js";
import { addDays, pragueNow } from "./waste.js";

// Veřejný widget ČEZ (api.bezstavy.cz) není zdokumentované API.
// Ptá se ho jen worker, výsledek drží D1 a stránky už ČEZ nevolají.
export const BEZSTAVY_API = "https://api.bezstavy.cz";
export const BEZSTAVY_CDN = "https://cdn.bezstavy.cz";
export const USER_AGENT = "KopidlenskaDrbna/1.0 (+https://kopidlenskadrbna.org)";
export const KOPIDLNO = { code: "573060", name: "Kopidlno" };
export const MAX_AREAS = 12;
export const HOME_LEAD_DAYS = 7;
export const STALE_MS = 6 * 60 * 60 * 1000;
export const PLACE_LIMIT = 40;
export const PARCEL_LIMIT = 12;

const BURST = 4;
const GAP_MS = 1100;
const PHASE_STATE = {
  now: "Právě probíhá",
  soon: "Chystá se",
  later: "Naplánováno",
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function listOf(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function timeOf(value) {
  const written = clean(value);
  if (!written) return null;
  const parsed = Date.parse(written);
  return Number.isFinite(parsed) ? parsed : null;
}

function pragueStamp(iso) {
  const parsed = timeOf(iso);
  if (parsed == null) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(parsed));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour").padStart(2, "0");
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    time: `${hour}:${pick("minute").padStart(2, "0")}`,
  };
}

function softDay(isoDate) {
  const day = formatLong(isoDate);
  return day.charAt(0).toLowerCase() + day.slice(1);
}

function entryList(payload, key) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, entries: [] };
  if (!Object.prototype.hasOwnProperty.call(payload, key) || payload[key] == null) return { ok: true, entries: [] };
  if (!Array.isArray(payload[key])) return { ok: false, entries: [] };
  return { ok: true, entries: payload[key] };
}

function pushParcels(territories, parcels) {
  for (const territory of listOf(territories)) {
    for (const plot of listOf(territory.plots)) {
      const parcel = clean(plot.plot);
      if (!parcel) continue;
      parcels.push({
        cadastralCode: clean(plot.cadastral_code) ?? clean(territory.code),
        plot: parcel,
      });
    }
  }
}

function placesFrom(addresses) {
  const places = [];
  const parcels = [];
  const body = addresses && typeof addresses === "object" ? addresses : {};
  for (const town of listOf(body.towns)) {
    const townName = clean(town.name);
    const district = clean(town.district);
    pushParcels(town.cadastral_territories, parcels);
    for (const districtRow of listOf(town.town_districts)) {
      for (const part of listOf(districtRow.town_parts)) {
        for (const street of listOf(part.streets)) {
          places.push({
            town: townName,
            part: clean(part.name),
            street: clean(street.name),
            houseNums: clean(street.house_nums),
            evNums: clean(street.ev_nums),
            streetNums: clean(street.street_nums),
            district,
          });
        }
      }
    }
  }
  pushParcels(body.orphan_territories, parcels);
  return {
    places: places.filter((place) => place.street || place.houseNums || place.evNums || place.streetNums),
    parcels: dedupeParcels(parcels),
  };
}

function dedupeParcels(parcels) {
  const seen = new Set();
  const unique = [];
  for (const parcel of parcels) {
    const key = `${parcel.cadastralCode ?? ""}:${parcel.plot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(parcel);
  }
  return unique;
}

export function announcementUrl(key) {
  const path = clean(key);
  if (!path) return null;
  const relative = path.replace(/^\/+/, "");
  if (relative.includes("..") || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,180}$/.test(relative)) return null;
  return `${BEZSTAVY_CDN}/${relative}`;
}

function outageFrom(entry, area) {
  const id = clean(entry?.id);
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || !id) return null;
  const where = placesFrom(entry.addresses);
  return {
    id,
    areaCode: area.code,
    openedAt: timeOf(entry.opened_at) == null ? null : clean(entry.opened_at),
    fixExpectedAt: timeOf(entry.fix_expected_at) == null ? null : clean(entry.fix_expected_at),
    announcementUrl: announcementUrl(entry.announcement_key),
    places: where.places,
    parcels: where.parcels,
  };
}

export function normalizeTownPayload(payload, area) {
  const planned = entryList(payload, "outages_in_town");
  const other = entryList(payload, "outages");
  if (!planned.ok || !other.ok) return { ok: false, outages: [] };
  const outages = [];
  for (const entry of [...planned.entries, ...other.entries]) {
    const outage = outageFrom(entry, area);
    if (outage) outages.push(outage);
  }
  return { ok: true, outages: dedupeById(outages) };
}

export function outagePhase(outage, now = new Date()) {
  const start = timeOf(outage?.openedAt);
  const end = timeOf(outage?.fixExpectedAt);
  const instant = now.getTime();
  if (end != null && end <= instant) return "past";
  if (start == null || start <= instant) return "now";
  const today = pragueNow(now).date;
  const startDay = pragueStamp(outage.openedAt)?.date;
  if (startDay && startDay <= addDays(today, HOME_LEAD_DAYS)) return "soon";
  return "later";
}

export function outageSpan(outage) {
  const start = pragueStamp(outage?.openedAt);
  const end = pragueStamp(outage?.fixExpectedAt);
  if (start && end && start.date === end.date) return `${formatLong(start.date)}, ${start.time}–${end.time}`;
  if (start && end) return `${formatLong(start.date)} ${start.time} – ${softDay(end.date)} ${end.time}`;
  if (start) return `${formatLong(start.date)} od ${start.time}`;
  if (end) return `${formatLong(end.date)} do ${end.time}`;
  return "Čas není uvedený.";
}

export function placeLabel(place) {
  const part = place?.part ?? null;
  const town = place?.town ?? null;
  const where = part && town && part !== town ? `${part}, ${town}` : part || town || "";
  const street = place?.street || "bez ulice";
  const nums = [
    place?.houseNums ? `popisná ${place.houseNums}` : "",
    place?.evNums ? `evidenční ${place.evNums}` : "",
    place?.streetNums ? `orientační ${place.streetNums}` : "",
  ].filter(Boolean);
  if (!where && !place?.street && !nums.length) return "";
  return [where, street, nums.join(", ")].filter(Boolean).join(" · ");
}

export function parcelLabel(parcels) {
  const list = Array.isArray(parcels) ? parcels : [];
  if (!list.length) return "";
  const shown = list.slice(0, PARCEL_LIMIT).map((parcel) => parcel.plot).filter(Boolean);
  if (!shown.length) return "";
  const extra = list.length - shown.length;
  const word = list.length === 1 ? "Parcela" : "Parcely";
  return `${word} ${shown.join(", ")}${extra > 0 ? ` a dalších ${extra}` : ""}`;
}

function presentOutage(outage, phase, areaName) {
  const labels = outage.places.map(placeLabel).filter(Boolean);
  return {
    ...outage,
    areaName,
    phase,
    state: PHASE_STATE[phase] ?? "",
    when: outageSpan(outage),
    placeLabels: labels.slice(0, PLACE_LIMIT),
    morePlaces: Math.max(0, labels.length - PLACE_LIMIT),
    parcelLine: parcelLabel(outage.parcels),
  };
}

const PHASE_ORDER = { now: 0, soon: 1, later: 2 };

export function buildBoard({ fetchedAt = null, status = "", note = "", areas = [], outages = [], now = new Date() } = {}) {
  const names = new Map(areas.map((area) => [String(area.code), String(area.name)]));
  const items = [];
  for (const outage of outages) {
    if (!outage || typeof outage !== "object") continue;
    const areaName = names.get(String(outage.areaCode));
    if (!areaName) continue;
    const phase = outagePhase(outage, now);
    if (phase === "past") continue;
    items.push(presentOutage(outage, phase, areaName));
  }
  items.sort((a, b) => {
    const order = (PHASE_ORDER[a.phase] ?? 9) - (PHASE_ORDER[b.phase] ?? 9);
    if (order) return order;
    return (timeOf(a.openedAt) ?? 0) - (timeOf(b.openedAt) ?? 0);
  });
  const stamp = pragueStamp(fetchedAt);
  return {
    fetchedAt: fetchedAt || null,
    status: status || "",
    note: note || "",
    areas: areas.map((area) => ({ code: String(area.code), name: String(area.name) })),
    items,
    checked: stamp ? `Naposledy ověřeno ${formatShort(stamp.date)} v ${stamp.time}.` : "",
  };
}

export function boardJson(board) {
  return {
    fetched_at: board.fetchedAt,
    status: board.status || (board.fetchedAt ? "ok" : "empty"),
    note: board.note || "",
    areas: board.areas.map((area) => ({ code: area.code, name: area.name })),
    outages: board.items.map((item) => ({
      id: item.id,
      area_code: item.areaCode,
      area_name: item.areaName,
      opened_at: item.openedAt,
      fix_expected_at: item.fixExpectedAt,
      announcement_url: item.announcementUrl,
      phase: item.phase,
      state: item.state,
      when: item.when,
      places: item.places.map((place) => ({
        obec: place.town,
        cast: place.part,
        ulice: place.street,
        cisla_popisna: place.houseNums,
        cisla_evidencni: place.evNums,
        cisla_orientacni: place.streetNums,
        okres: place.district,
      })),
      parcels: item.parcels.map((parcel) => ({
        kod_katastru: parcel.cadastralCode,
        parcela: parcel.plot,
      })),
    })),
  };
}

export function feedIsStale(board, now = Date.now()) {
  const fetched = Date.parse(board?.fetchedAt ?? "");
  if (!Number.isFinite(fetched)) return true;
  return now - fetched >= STALE_MS;
}

export function parseAreaInput(input) {
  const name = String(input?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const code = String(input?.code ?? "").trim();
  const rawSort = String(input?.sortOrder ?? "").trim();
  if (name.length < 2) return { ok: false, error: "Doplňte název obce." };
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Kód obce je šest číslic, třeba 573060 pro Kopidlno." };
  let sortOrder = 100;
  if (rawSort) {
    if (!/^\d{1,3}$/.test(rawSort)) return { ok: false, error: "Pořadí je číslo od 0 do 999." };
    sortOrder = Number(rawSort);
  }
  return {
    ok: true,
    area: { name, code, enabled: Boolean(input?.enabled), sortOrder },
  };
}

function dedupeById(outages) {
  const seen = new Set();
  const unique = [];
  for (const outage of outages) {
    if (!outage?.id || seen.has(outage.id)) continue;
    seen.add(outage.id);
    unique.push(outage);
  }
  return unique;
}

export function mergeFresh(previous, results) {
  const failed = new Set(results.filter((result) => !result.ok).map((result) => result.code));
  const fresh = results.filter((result) => result.ok).flatMap((result) => result.outages);
  const kept = (previous ?? []).filter((item) => item && failed.has(item.areaCode));
  return dedupeById([...fresh, ...kept]);
}

function czechList(names) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} a ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} a ${names[names.length - 1]}`;
}

export function refreshNote(results) {
  const failed = results.filter((result) => !result.ok);
  if (!failed.length) return { status: "ok", note: "" };
  if (failed.length === results.length) {
    return { status: "error", note: "Distributor teď neodpověděl. Na webu zůstává poslední uložený přehled." };
  }
  const names = failed.map((result) => result.name || result.code);
  const label = names.length === 1 ? "obce" : "obcí";
  return { status: "partial", note: `U ${label} ${czechList(names)} se přehled nenačetl.` };
}

async function readTown(area, fetchImpl, sleep) {
  const url = `${BEZSTAVY_API}/cezd/api/inspecttown/${encodeURIComponent(area.code)}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
    } catch {
      return { ok: false, code: area.code, name: area.name, error: "Distributor neodpověděl.", outages: [] };
    }
    if (response.status === 429) {
      if (attempt === 3) {
        return {
          ok: false,
          code: area.code,
          name: area.name,
          error: "Distributor požádal, ať se zeptáme později.",
          outages: [],
        };
      }
      const retry = Number(response.headers.get("Retry-After"));
      const seconds = Number.isFinite(retry) && retry > 0 ? retry : 2 ** attempt;
      await sleep(Math.min(seconds, 15) * 1000);
      continue;
    }
    if (!response.ok) {
      return {
        ok: false,
        code: area.code,
        name: area.name,
        error: `Distributor odpověděl ${response.status}.`,
        outages: [],
      };
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, code: area.code, name: area.name, error: "Odpověď nešla přečíst.", outages: [] };
    }
    const parsed = normalizeTownPayload(payload, area);
    if (!parsed.ok) {
      return { ok: false, code: area.code, name: area.name, error: "Odpověď nemá seznam odstávek.", outages: [] };
    }
    return { ok: true, code: area.code, name: area.name, error: "", outages: parsed.outages };
  }
  return { ok: false, code: area.code, name: area.name, error: "Distributor neodpověděl.", outages: [] };
}

export async function fetchAreaOutages(areas, { fetchImpl = fetch, sleep = wait } = {}) {
  const results = [];
  let asked = 0;
  for (const area of areas) {
    if (!/^\d{6}$/.test(String(area.code ?? ""))) {
      results.push({ ok: false, code: String(area.code ?? ""), name: area.name, error: "Kód obce není šest číslic.", outages: [] });
      continue;
    }
    asked += 1;
    if (asked > BURST) await sleep(GAP_MS);
    results.push(await readTown(area, fetchImpl, sleep));
  }
  return results;
}
