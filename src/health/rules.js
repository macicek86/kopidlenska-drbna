// Kdy je zdroj nebo úloha v pořádku. Jedna chyba nebo jeden prázdný běh je jen „pozor“ (web zdroje chvíli
// nejde), problém („chyba“) až když trvá; teprve ten jde e-mailem (src/health/check.js).
import { formatShort } from "../format.js";
import { pragueNow } from "../waste.js";

export const FAIL_HOURS = 24;
export const JOB_FAIL_HOURS = 8;
export const EMPTY_DAYS = 3;
// Cron běží každé 4 hodiny, s rezervou.
export const CRON_STALE_HOURS = 6;

const HOUR = 60 * 60 * 1000;

export function when(iso) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const clock = pragueNow(new Date(parsed));
  return `${formatShort(clock.date)} v ${clock.time}`;
}

function hoursSince(iso, now) {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? (now.getTime() - parsed) / HOUR : Infinity;
}

// Za jak dlouho bez stažení je zdroj podezřelý. 0 = nehlídat (úlohy cronu, příjem od NDIC).
export function staleHours(row) {
  if (row.kind === "cron") return CRON_STALE_HOURS;
  if (row.kind === "uloha" || !row.everyHours) return 0;
  return Math.max(24, row.everyHours * 2);
}

// { state: "ok" | "pozor" | "chyba" | "vypnuto", text }
export function healthOf(row, now = new Date()) {
  if (row.off) return { state: "vypnuto", text: "Vypnuté v redakci." };
  const stale = staleHours(row);
  if (stale && hoursSince(row.triedAt, now) > stale) {
    const last = when(row.triedAt);
    if (row.kind === "cron") return { state: "chyba", text: `Cron neběží, naposledy ${last}.` };
    return { state: "chyba", text: last ? `Nestahuje se, naposledy ${last}.` : "Ještě se nestáhl." };
  }
  if (row.error) {
    const limit = row.kind === "uloha" ? JOB_FAIL_HOURS : FAIL_HOURS;
    if (hoursSince(row.failingSince, now) >= limit) return { state: "chyba", text: `Nejde od ${when(row.failingSince)}: ${row.error}` };
    return { state: "pozor", text: `Naposledy nešlo: ${row.error}` };
  }
  if (row.items === 0 && !row.allowEmpty) {
    if (!row.emptySince) return { state: "pozor", text: "Ve zdroji teď nic není." };
    if (hoursSince(row.emptySince, now) >= EMPTY_DAYS * 24) return { state: "chyba", text: `Ve zdroji nic není od ${when(row.emptySince)}. Nezměnil se web?` };
    return { state: "pozor", text: "Ve zdroji teď nic není." };
  }
  if (row.kind === "uloha") return { state: "ok", text: "Doběhla bez chyby." };
  if (row.kind === "cron") return { state: "ok", text: `Naposledy ${when(row.triedAt)}.` };
  return { state: "ok", text: row.items === null ? "V pořádku." : `Ve zdroji: ${row.items}.` };
}

// Kolik řádků má problém (pro menu a Přehled).
export function problemCount(rows, now = new Date()) {
  return rows.filter((row) => healthOf(row, now).state === "chyba").length;
}
