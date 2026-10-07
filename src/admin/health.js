// Redakce: Stav drbny (jen hlavní redaktor). Jestli běží cron, jestli jdou zdroje a co čeká ve frontách (src/health/).
import { healthOf, when } from "../health/rules.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, item, list, pageHead, panel } from "./ui.js";

const BADGES = {
  ok: ["V pořádku", "ok"],
  pozor: ["Pozor", "warn"],
  chyba: ["Nefunguje", "bad"],
  vypnuto: ["Vypnuto", "off"],
};

const TONES = { chyba: "warn", vypnuto: "off" };

function healthItem(row, now) {
  const health = healthOf(row, now);
  const tried = row.triedAt ? `Naposledy ${when(row.triedAt)}` : "";
  const meta = [tried, esc(health.text)].filter(Boolean).join(" · ");
  return item({
    title: row.label,
    meta,
    badges: badge(...BADGES[health.state]),
    actions: row.page ? `<a class="btn btn-sm btn-line" href="${esc(row.page)}">Otevřít</a>` : "",
    tone: TONES[health.state] ?? "",
  });
}

function cronCallout(row, now) {
  if (!row) return callout("Cron tu ještě neběžel. Zapisuje se při každém běhu (každé 4 hodiny).", "warn");
  const health = healthOf(row, now);
  if (health.state === "chyba") return callout(`<b>${esc(health.text)}</b> Importy, odstávky ani index hledání se teď neaktualizují.`, "bad");
  return callout(`Cron běží každé 4 hodiny, naposledy ${esc(when(row.triedAt))}.`);
}

function queueItem(queue) {
  const parts = [queue.waiting ? `Čeká: ${queue.waiting}` : "Nic nečeká", queue.failed ? `s chybou: ${queue.failed}` : ""].filter(Boolean);
  return item({
    title: queue.label,
    meta: esc(parts.join(", ")),
    badges: queue.failed ? badge("Chyba u položky", "bad") : "",
    actions: `<a class="btn btn-sm btn-line" href="${esc(queue.page)}">Otevřít</a>`,
    tone: queue.failed ? "warn" : "",
  });
}

// Problémy nahoru, vypnuté dolů.
const ORDER = { chyba: 0, pozor: 1, ok: 2, vypnuto: 3 };

function sorted(rows, now) {
  return [...rows].sort((a, b) => ORDER[healthOf(a, now).state] - ORDER[healthOf(b, now).state] || a.label.localeCompare(b.label, "cs"));
}

export function adminHealth(ctx, data, message, now = new Date()) {
  const rows = data.health?.rows ?? [];
  const sources = sorted(rows.filter((row) => row.kind === "zdroj"), now);
  const jobs = sorted(rows.filter((row) => row.kind === "uloha"), now);
  // Úlohy bez chyby jen počtem, vypsané jsou ty s chybou.
  const failedJobs = jobs.filter((row) => healthOf(row, now).state !== "ok");
  const jobsNote = jobs.length
    ? `<p class="panel-note">${failedJobs.length ? `Ostatní (${jobs.length - failedJobs.length}) doběhly bez chyby.` : `Všech ${jobs.length} doběhlo při posledním běhu bez chyby.`}</p>`
    : "";
  const queues = data.health?.queues ?? [];
  const busy = queues.filter((queue) => queue.waiting || queue.failed);
  const search = data.health?.search ?? 0;
  const body = `${pageHead("Stav drbny", "Odkud drbna stahuje, jestli to jde a jestli doběhla práce na pozadí. Když něco přestane fungovat, přijde e-mail (vypnete v Můj účet).")}
    ${cronCallout(rows.find((row) => row.kind === "cron"), now)}
    ${panel({ id: "zdroje", title: "Zdroje", count: sources.length, body: list(sources.map((row) => healthItem(row, now)), "Zatím se nic nestahovalo.") })}
    <div class="cards-2">
      ${panel({ id: "ulohy", title: "Úlohy cronu", body: jobs.length ? `${failedJobs.length ? list(failedJobs.map((row) => healthItem(row, now)), "") : ""}${jobsNote}` : list([], "Cron ještě neběžel.") })}
      ${panel({
        id: "fronty",
        title: "Fronty",
        body: `${list(busy.map(queueItem), "Ve frontách importů nic nečeká.")}<p class="panel-note">${search ? `Na index hledání čeká zpráv: ${search}.` : "Index hledání je aktuální."}</p>`,
      })}
    </div>`;
  return adminShell(ctx, data, "stav", message, body, { title: "Stav drbny" });
}
