// Otevírací doba ze zpráv města: pokyny pro Claude, schéma, kontrola odpovědi a uložení.
// Zavření a dočasně jinou dobu Drběna jen propíše (bez článku), novou trvalou dobu propíše a napíše o ní článek.
import { changeSpan, hoursSummary, normalizeWeek } from "../doctors.js";
import { isoDate } from "../notices.js";
import { insertPlaceChange, placeByName } from "../places-db.js";

export const HOURS_RULES = `Otevírací doba (pole hours):
- Zpráva, že úřad, knihovna, KVC, hernička, infocentrum, lékárna, pošta, ordinace nebo jiné místo bude mít zavřeno nebo jinou otevírací (ordinační) dobu, patří do hours. Každé místo zvlášť, i když jsou ve zprávě spolu.
- target: značka místa z přehledu "Otevírací doba míst" ([misto:ID]) nebo lékaře z přehledu "Lékaři" ([lekar:ID]). Když místo v přehledu není, dej "nove" a název do new_place (krátce, s velkým písmenem, třeba "Lékárna") a popisek do new_place_label.
- kind "zavreno": v těch dnech má zavřeno (slots nech prázdné). kind "docasna": v těch dnech má jinou dobu, do slots dej jen časy, kdy je v tom období otevřeno. Platí od starts_on do ends_on (u jednoho dne stejné datum).
- kind "trvala": nová běžná otevírací doba natrvalo. Do starts_on den, od kdy platí (když ho zpráva neříká, den zveřejnění), do slots celý nový týden. U lékařů trvalou změnu nezapisuj, napiš o ní jen článek.
- Když zpráva jen připomíná obecnou otevírací dobu, porovnej ji s přehledem. Sedí-li, nic nezapisuj a zvol "preskocit" (v reason napiš, že doba sedí). Když se liší, posuď, jestli jde o změnu dočasnou (prázdniny, svátky, sezóna, dovolená, jeden den) nebo trvalou, a podle toho zvol kind.
- Ordinace, kde se střídá víc lékařů, má v poznámkách hodin, kdo ordinuje („ordinuje MUDr. …“). Když zpráva říká, kdo z nich kdy ordinuje nebo neordinuje, zapiš jednu dočasnou změnu na celé období ze zprávy (od prvního do posledního dne, který zpráva jmenuje). Ve slots nech běžné hodiny a v poznámce změň jen to, kdo ordinuje, zbytek poznámky opiš (bez slov „dopoledne“ a „odpoledne“, ta jsou jen v přehledu). Dny, kdy podle zprávy nikdo neordinuje, vynech (jsou zavřené). Den s jinými hodinami zapiš navíc jako samostatnou změnu na ten den, ta má přednost.
- Odběry dělá sestra, ne lékař. Kde lékař ordinuje, počítej s tím, že sestra je taky a odběry platí jako obvykle. Jen když zpráva výslovně řekne, že sestra nebude, odběry z poznámky toho dne vynech. Když lékař neordinuje a zpráva výslovně řekne, že sestra bude, nech otevřeno jen na odběry (čas odběrů z běžných hodin, poznámka třeba „jen odběry, lékař neordinuje“). Když lékař neordinuje a o sestře zpráva nic neříká, je zavřeno.
- Změnu, která už v přehledu u místa je, nezapisuj znovu.
- slots: jeden řádek na souvislý úsek. day je den v týdnu (po, ut, st, ct, pa, so, ne), from a to jako HH:MM, note krátká poznámka, nebo prázdná.
- note: krátký důvod nebo poznámka pro čtenáře, třeba "školení k volbám" nebo "dovolená". Bez data, to se ukáže samo. Ukáže se u každého dne změny, tak ať sedí ke všem (třeba „MUDr. Ulrych má volno, zastupuje MUDr. Ulrychová“). Co platí jen pro některé dny (zavřeno, sestra nebude), patří do poznámky v slots toho dne, nebo to vyplyne z toho, že den je zavřený.
- Článek: u zavření a dočasné změny žádný (article include false), stačí hours. Článek jen u trvalé změny, nebo když zpráva říká ještě něco dalšího.`;

const DAYS = { ne: 0, po: 1, ut: 2, st: 3, ct: 4, pa: 5, so: 6 };

export function hoursSchema() {
  const text = { type: "string" };
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["target", "new_place", "new_place_label", "kind", "starts_on", "ends_on", "note", "slots"],
      properties: {
        target: text,
        new_place: text,
        new_place_label: text,
        kind: { type: "string", enum: ["zavreno", "docasna", "trvala"] },
        starts_on: text,
        ends_on: text,
        note: text,
        slots: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["day", "from", "to", "note"],
            properties: { day: { type: "string", enum: Object.keys(DAYS) }, from: text, to: text, note: text },
          },
        },
      },
    },
  };
}

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function time(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

// Úseky z odpovědi na týden: první úsek dne je dopoledne, druhý odpoledne. Jediný úsek od poledne je odpoledne.
export function weekFromSlots(slots) {
  const byDay = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    const day = DAYS[slot?.day];
    const from = time(slot?.from);
    const to = time(slot?.to);
    if (day == null || !from || !to || from >= to) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ open: true, from, to, note: clean(slot.note, 160) });
  }
  const week = [...byDay.entries()].map(([day, parts]) => {
    const sorted = parts.sort((a, b) => a.from.localeCompare(b.from)).slice(0, 2);
    if (sorted.length === 1) return sorted[0].from >= "12:00" ? { day, afternoon: sorted[0] } : { day, morning: sorted[0] };
    return { day, morning: sorted[0], afternoon: sorted[1] };
  });
  return normalizeWeek(week);
}

function readTarget(raw) {
  const text = String(raw?.target ?? "").trim();
  const match = text.match(/^(misto|lekar):(\d+)$/);
  if (match) return { type: match[1], id: Number(match[2]) };
  const name = clean(raw?.new_place, 120);
  if (text === "nove" && name.length >= 2) return { type: "nove", name, label: clean(raw?.new_place_label, 120) };
  return null;
}

// Jedna změna z odpovědi Claude, nebo null, když nedává smysl.
export function readHoursChange(raw) {
  const target = readTarget(raw);
  if (!target) return null;
  const kind = ["zavreno", "docasna", "trvala"].includes(raw?.kind) ? raw.kind : "";
  if (!kind || (kind === "trvala" && target.type === "lekar")) return null;
  const startsOn = isoDate(raw.starts_on);
  const span = changeSpan(startsOn, kind === "trvala" ? "" : isoDate(raw.ends_on) || startsOn);
  if (span.error) return null;
  const parsed = kind === "zavreno" ? normalizeWeek([]) : weekFromSlots(raw.slots);
  if (parsed.error) return null;
  const open = parsed.week.some((slot) => slot.morning.open || slot.afternoon.open);
  if (kind === "trvala" && !open) return null;
  return {
    target,
    kind: kind === "trvala" ? "trvala" : "docasna",
    startsOn: span.startsOn,
    endsOn: span.endsOn,
    note: clean(raw.note, 400),
    week: parsed.week,
  };
}

export function readHours(list) {
  return (Array.isArray(list) ? list : []).map(readHoursChange).filter(Boolean).slice(0, 12);
}

function line(value, max = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function changesText(changes) {
  if (!changes?.length) return "";
  const parts = changes.map((change) => {
    const when = change.kind === "trvala" ? `nová doba od ${change.startsOn}` : `${change.startsOn}${change.endsOn !== change.startsOn ? ` až ${change.endsOn}` : ""}`;
    const open = change.week.some((slot) => slot.morning.open || slot.afternoon.open);
    return `${when} ${open ? hoursSummary(change, "") : "zavřeno"}${change.note ? ` (${line(change.note, 80)})` : ""}`;
  });
  return ` · změny: ${parts.join("; ")}`;
}

// Přehled míst a lékařů pro Claude, ať pozná, jestli doba sedí a jestli změna už není zapsaná.
export function hoursContext(known) {
  const places = (known.places ?? []).map(
    (place) => `[misto:${place.id}] ${place.name}${place.label ? ` (${line(place.label, 60)})` : ""} · ${hoursSummary(place, "doba není doplněná")}${changesText(place.changes)}`,
  );
  const doctors = (known.doctors ?? []).map(
    (doctor) => `[lekar:${doctor.id}] ${doctor.name} (${line(doctor.specialty, 60)}) · ${hoursSummary(doctor, "hodiny nejsou doplněné")}${changesText(doctor.changes)}`,
  );
  const block = (heading, rows) => `${heading}:\n${rows.length ? rows.join("\n") : "(nic)"}`;
  return [block("Otevírací doba míst", places), block("Lékaři", doctors)].join("\n\n");
}

// Uloží změny od Drběny rovnou na web. Vrací značky do import_items.hours_ids.
export async function saveHoursChanges(env, changes, { sourceUrl = "", createdBy = null } = {}) {
  const refs = [];
  for (const change of changes ?? []) {
    if (change.target.type === "lekar") {
      const doctor = await env.DB.prepare("select id from doctors where id = ?").bind(change.target.id).first();
      if (!doctor) continue;
      const same = await env.DB.prepare("select id from doctor_changes where doctor_id = ? and starts_on = ? and ends_on = ? and hours = ?")
        .bind(doctor.id, change.startsOn, change.endsOn, JSON.stringify(change.week))
        .first();
      if (same) {
        refs.push(`ordinace:${Number(same.id)}`);
        continue;
      }
      const result = await env.DB.prepare(
        "insert into doctor_changes (doctor_id, starts_on, ends_on, note, hours, created_by) values (?, ?, ?, ?, ?, ?)",
      )
        .bind(doctor.id, change.startsOn, change.endsOn, change.note || "Podle zprávy města.", JSON.stringify(change.week), createdBy)
        .run();
      refs.push(`ordinace:${Number(result.meta.last_row_id)}`);
      continue;
    }
    let placeId = change.target.id;
    if (change.target.type === "nove") placeId = await placeByName(env, change.target.name, change.target.label);
    else if (!(await env.DB.prepare("select id from places where id = ?").bind(placeId).first())) continue;
    const id = await insertPlaceChange(env, { ...change, placeId, sourceUrl, createdBy });
    refs.push(`doba:${id}`);
  }
  return refs;
}
