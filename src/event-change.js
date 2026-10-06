// Zrušení nebo změna akce, která už je v kalendáři. Zdroje (Munipolis, Deník, školy, web města) o téže akci píšou
// nezávisle, takže zrušení nebo jiný termín může přijít odkudkoli. Drběna k položce vrátí `event_change` se značkou akce
// z přehledu a import změnu propíše do kalendáře. Zrušená akce na webu zůstává s označením Zrušeno (`events.cancelled`).
import { clockTime, isoDate } from "./notices.js";

export const EVENT_CHANGE_RULE = `- event_change: když zpráva říká, že akce, která už je v kalendáři (značka akce:… z přehledu), se ruší, nebo že se mění její den, čas či místo, dej include true, do ref značku té akce a kind "zruseno", nebo "zmena" s novými údaji (date jako RRRR-MM-DD, time jako HH:MM, place; co se nemění, nech prázdné). Jinak include false a ostatní pole prázdná. Zrušení nebo změna akce není duplicita: napiš o tom zprávu (doplneni, je-li o akci zpráva, jinak vytvorit) a novou akci nezakládej (event include false). Akce označená v přehledu ZRUŠENO se nekoná: pozvánku na ni nepiš.`;

export function eventChangeSchema() {
  const text = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["include", "ref", "kind", "date", "time", "place"],
    properties: {
      include: { type: "boolean" },
      ref: text,
      kind: { type: "string", enum: ["zruseno", "zmena"] },
      date: text,
      time: text,
      place: text,
    },
  };
}

// Odpověď Claude na tvar pro `applyEventChange`, nebo null.
export function readEventChange(raw) {
  if (!raw?.include) return null;
  const ref = /^akce:(\d+)$/.exec(String(raw.ref ?? "").trim());
  if (!ref) return null;
  const eventId = Number(ref[1]);
  if (raw.kind === "zruseno") return { eventId, kind: "zruseno" };
  if (raw.kind !== "zmena") return null;
  const change = {
    eventId,
    kind: "zmena",
    startsOn: isoDate(raw.date) || "",
    startsTime: clockTime(raw.time) || "",
    place: String(raw.place ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
  };
  return change.startsOn || change.startsTime || change.place ? change : null;
}

// Propíše změnu do kalendáře. Vrátí větu pro redakci (připíše se ke zdůvodnění položky), nebo prázdný text.
export async function applyEventChange(env, change) {
  if (!change) return "";
  const event = await env.DB.prepare("select id, starts_on, starts_time, place, cancelled from events where id = ?").bind(change.eventId).first();
  if (!event) return "";
  const ref = `akce:${change.eventId}`;
  if (change.kind === "zruseno") {
    if (Number(event.cancelled)) return "";
    await env.DB.prepare("update events set cancelled = 1, updated_at = datetime('now') where id = ?").bind(change.eventId).run();
    return `Akci ${ref} v kalendáři označila jako zrušenou.`;
  }
  const next = {
    starts_on: change.startsOn || String(event.starts_on),
    starts_time: change.startsTime || String(event.starts_time ?? ""),
    place: change.place || String(event.place ?? ""),
  };
  const changed = Object.entries(next).filter(([field, value]) => value !== String(event[field] ?? ""));
  if (!changed.length) return "";
  await env.DB.prepare("update events set starts_on = ?, starts_time = ?, place = ?, updated_at = datetime('now') where id = ?")
    .bind(next.starts_on, next.starts_time, next.place, change.eventId)
    .run();
  const labels = { starts_on: "den", starts_time: "čas", place: "místo" };
  return `U akce ${ref} změnila ${changed.map(([field, value]) => `${labels[field]} na ${value}`).join(", ")}.`;
}

// Zdůvodnění položky se změnou akce (volá se hned po odpovědi Claude, před uložením položky).
export async function noteEventChange(env, answer) {
  const note = await applyEventChange(env, answer.eventChange);
  return note ? `${answer.reason} ${note}`.trim() : answer.reason;
}
