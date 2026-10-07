// Upozornění e-mailem: na začátku každého běhu cronu projde stav a hlavnímu redaktorovi napíše jen o změně
// (zdroj se rozbil, nebo zase jde). Dokud problém trvá, další e-mail nepřijde.
import { notifyEditors } from "../notify.js";
import { loadHealthRows, markAlerted } from "./store.js";
import { healthOf } from "./rules.js";

function plural(count, one, few, many) {
  return count === 1 ? one : count < 5 ? few : many;
}

export function healthChanges(rows, now = new Date()) {
  const broken = [];
  const fixed = [];
  for (const row of rows) {
    // Cron se zapsal právě teď. Že neběží, pozná jen hlídání zvenku (/stav.json).
    if (row.kind === "cron") continue;
    const health = healthOf(row, now);
    if (health.state === "chyba" && row.alerted !== "chyba") broken.push({ row, health });
    if ((health.state === "ok" || health.state === "vypnuto") && row.alerted === "chyba") fixed.push({ row, health });
  }
  return { broken, fixed };
}

export function healthMail({ broken, fixed }) {
  const subject = broken.length
    ? `Drbna: ${broken.length} ${plural(broken.length, "věc nefunguje", "věci nefungují", "věcí nefunguje")}`
    : `Drbna: ${fixed.length === 1 ? "zase funguje" : "zase fungují"} ${fixed.map(({ row }) => row.label).join(", ")}`;
  const fields = [
    ...broken.map(({ row, health }) => [row.label, health.text]),
    ...fixed.map(({ row }) => [row.label, "Zase funguje."]),
  ];
  const intro = broken.length
    ? "Drbna při kontrole zjistila, že něco přestalo fungovat. Další e-mail přijde, až to zase půjde."
    : "Co předtím nefungovalo, zase jde.";
  return { subject, intro, fields, path: "/redakce/stav" };
}

export async function checkHealth(env, now = new Date()) {
  const changes = healthChanges(await loadHealthRows(env), now);
  if (!changes.broken.length && !changes.fixed.length) return changes;
  await markAlerted(env, changes.broken.map(({ row }) => row.key), "chyba");
  await markAlerted(env, changes.fixed.map(({ row }) => row.key), "");
  await notifyEditors(env, "stav", healthMail(changes));
  return changes;
}
