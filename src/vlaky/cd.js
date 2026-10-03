// Výluky a mimořádnosti vlaků z webu Českých drah (stránka Omezení provozu).
// Oficiální RSS ukazuje výluku až v den, kdy začne. Proto se ptáme stejného rozhraní jako stránka:
// na zvolený den a trať vrátí JSON se vším, co ten den platí, i na týdny dopředu. Není zdokumentované,
// takže čtení je opatrné: co nesedí, se přeskočí, a když se změní, drbna jen přestane výluky dostávat.
import { USER_AGENT } from "../outages.js";

export const CD_BASE = "https://www.cd.cz";
export const CD_PAGE = `${CD_BASE}/jizdni-rad/omezeni-provozu/`;
const CD_DAY_URL = `${CD_BASE}/jizdni-rad/omezeni-provozu/Ajax_LoadDataRegion`;

// Kopidlnem vede jen trať 061. Číslo v rozhraní ČD (id) se může s novým jízdním řádem změnit,
// proto ho drbna jednou denně ověří ze stránky (trackIdFromPage) a tohle je jen záloha.
export const TRACK = { code: "061", id: 1038, name: "Nymburk – Jičín" };

const TIMEOUT_MS = 15_000;

// „01.10.2026 00:00“ → { date: "2026-10-01", time: "00:00" }
export function cdTime(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!match) return { date: "", time: "" };
  const [, day, month, year, hour = "0", minute = "00"] = match;
  return { date: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, time: `${hour.padStart(2, "0")}:${minute}` };
}

// „2026-10-04“ → „04.10.2026“, jak ho chce rozhraní ČD.
export function cdDate(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${day}.${month}.${year}`;
}

// „Trať 061: úsek Nymburk hlavní nádraží – Jičín“ → „Nymburk hlavní nádraží – Jičín“
export function sectionLabel(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.replace(/^Trať\s+\S+:\s*(úsek\s+)?/i, "").replace(/^(stanice|zastávka)\s+/i, "") || clean;
}

function cleanList(values, max = 10) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

function readItem(raw, type) {
  const cdId = Number(raw?.Id);
  const start = cdTime(raw?.Od);
  if (!Number.isInteger(cdId) || cdId <= 0 || !start.date) return null;
  const end = cdTime(raw?.Do);
  const href = String(raw?.Href ?? "");
  return {
    id: `${type}-${cdId}`,
    cdId,
    type,
    sections: cleanList(raw?.Useky).map(sectionLabel),
    measures: [...new Set(cleanList((raw?.Icons ?? []).map((icon) => icon?.Type)))],
    startsOn: start.date,
    startsTime: start.time,
    endsOn: end.date,
    endsTime: end.time,
    cause: String(raw?.Pricina ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    link: href.startsWith("/jizdni-rad/omezeni-provozu/") ? `${CD_BASE}${href.replace(/\/?$/, "/")}` : "",
  };
}

// Odpověď rozhraní na jeden den: výluky (Vyluky) a mimořádnosti (Mimo).
export function parseDay(data) {
  if (!data || typeof data !== "object" || (!Array.isArray(data.Vyluky) && !Array.isArray(data.Mimo))) return null;
  const items = [
    ...(data.Vyluky ?? []).map((raw) => readItem(raw, "vyluka")),
    ...(data.Mimo ?? []).map((raw) => readItem(raw, "mimo")),
  ];
  return items.filter(Boolean);
}

export async function fetchDay(isoDay, trackId, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(CD_DAY_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": USER_AGENT },
      body: new URLSearchParams({ kraj: "0", trat: String(trackId), date: cdDate(isoDay) }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "České dráhy neodpověděly." };
  }
  if (!response.ok) return { ok: false, error: `České dráhy odpověděly chybou ${response.status}.` };
  let data;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: "Odpověď Českých drah se nedala přečíst." };
  }
  const items = parseDay(data);
  if (!items) return { ok: false, error: "České dráhy poslaly něco jiného než přehled výluk." };
  return { ok: true, items };
}

// Číslo trati v rozhraní ČD podle výběru tratí na stránce: <option value="1038">061 | Nymburk hl.n. - Jičín
export function trackIdFromPage(html, code = TRACK.code) {
  const pattern = new RegExp(`<option[^>]*value="(\\d+)"[^>]*>\\s*${code}\\s*\\|`, "i");
  const match = String(html ?? "").match(pattern);
  return match ? Number(match[1]) : null;
}

export async function fetchTrackId(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(CD_PAGE, { headers: { Accept: "text/html", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return trackIdFromPage(await response.text());
  } catch {
    return null;
  }
}

function plain(html) {
  return String(html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, " ");
}

const DESCRIPTION_MAX = 600;

// Dlouhý popis zkrátit na konci věty, ne uprostřed slova.
function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return end > max / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

// Detail výluky: popis (co se děje s vlaky) a výlukový jízdní řád v PDF.
// Popis je za prvním nadpisem <h2 class="h3"> („Popis:“, u mimořádnosti třeba „Obecné opatření…“) až k <hr>.
export function parseDetail(html) {
  const source = String(html ?? "");
  const block = source.match(/<h2 class="h3">[\s\S]*?<\/h2>([\s\S]*?)<hr/i);
  const description = shorten(plain(block?.[1] ?? "").replace(/\s+/g, " ").trim(), DESCRIPTION_MAX);
  // Jen výlukový jízdní řád, ne jiná PDF ze stránky (mapa sítě v patičce).
  const pdf = source.match(/href="((?:https:\/\/www\.cd\.cz)?\/jizdni-rad\/tratove-jizdni-rady\/[^"]*?\.pdf)"/i);
  const pdfUrl = pdf ? (pdf[1].startsWith("http") ? pdf[1] : `${CD_BASE}${pdf[1]}`) : "";
  return { description, pdfUrl };
}

export async function fetchDetail(link, fetchImpl = fetch) {
  if (!link.startsWith(`${CD_BASE}/`)) return null;
  try {
    const response = await fetchImpl(link, { headers: { Accept: "text/html", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return null;
    return parseDetail(await response.text());
  } catch {
    return null;
  }
}
