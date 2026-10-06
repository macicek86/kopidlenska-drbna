// E-mail na otevírací dobu: pokyny pro levný model (Haiku), schéma odpovědi a přehled řádků, které odesílatel smí měnit.
import { hoursContext, weekFromSlots } from "../munipolis/hours.js";
import { callClaude } from "../claude.js";
import { changeSpan, normalizeWeek } from "../doctors.js";
import { formatLong } from "../format.js";
import { isoDate } from "../notices.js";
import { addDays } from "../waste.js";
import { clock } from "./describe.js";
import { hoursSummary as yardHours, parseTime } from "../yards.js";

const DAY_NAMES = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

export const MAIL_SYSTEM = `Jsi koza Drběna z Kopidlenské drbny, zpravodajského webu Kopidlna. Na adresu oteviracidoba@kopidlenskadrbna.org píšou správci míst (úřad, knihovna, KVC, ordinace, sběrný dvůr…) krátké e-maily o změně otevírací doby, často jen pár slov („15.8 kvc zavřeno“). Z e-mailu vytáhni změny, které se zapíšou na web.

verdict:
- "zmeny": e-mail říká, že některé místo z přehledu bude mít zavřeno, jinou dobu nebo novou běžnou dobu. Změny dej do changes.
- "nejasne": e-mail je o otevírací době, ale nejde jistě poznat, které místo, který den nebo jaké časy. changes nech prázdné a do question napiš krátkou otázku, co má odesílatel doplnit.
- "neni_doba": e-mail není o otevírací době (zpráva, tip na článek, pozvánka, dotaz, reklama, poděkování). changes prázdné.
Když jsou některé změny jasné a jiné ne, dej jasné do changes, verdict "zmeny" a do question napiš, co u ostatních chybí. Jinak nech question prázdné.
question piš česky, vykej, jednou nebo dvěma větami.

Pravidla:
- target je jen značka z přehledu ([misto:ID], [lekar:ID], [dvur:ID]). Jiná místa odesílatel měnit nesmí. Když e-mail mluví o místě, které v přehledu není, nezapisuj ho a zmiň to v question.
- Když je v přehledu jediný řádek a e-mail místo nejmenuje, myslí ten. Zkratky a hovorové názvy (kvc, knihovna, obecňák, doktorka…) přiřaď podle přehledu; když by mohly patřit ke dvěma řádkům, je to "nejasne".
- Datum bez roku je nejbližší takový den od dneška (dnešek včetně). Den v týdnu („v pátek“, „příští středu“) a slova „zítra“, „o víkendu“ počítej od dneška. Data ber z kalendáře v zadání, nepočítej je sám. Data piš jako RRRR-MM-DD.
- „Příští týden“ je celý příští týden od pondělí do neděle, „tento týden“ od dneška do neděle, „do konce měsíce“ od dneška do posledního dne měsíce. Na nic se v tom případě neptej, zapiš celé období.
- Ptej se ("nejasne") jen tehdy, když opravdu nejde poznat místo, kdy, nebo jaké časy. Co jde rozumně odvodit, odvoď a zapiš.
- Když zadání obsahuje předchozí e-mail a tvou otázku, nový e-mail je odpověď na ni: spoj oba dohromady (místo nebo důvod může být jen v tom předchozím).
- kind "zavreno": v těch dnech má zavřeno (slots nech prázdné). kind "docasna": v těch dnech má jinou dobu, do slots dej jen časy, kdy je v tom období otevřeno. Platí od starts_on do ends_on (u jednoho dne stejné datum).
- Když se jen dřív zavírá nebo později otevírá („zavřeno od 14“, „zavíráme už ve 14“, „otevíráme až v 10“), zapiš kind "docasna", slots nech prázdné a čas dej do close_at (zavírá v) nebo open_from (otevírá v). Běžné hodiny i polední pauzu z nich spočítá web sám, nepiš je. Jinak nech close_at i open_from prázdné.
- kind "trvala": nová běžná otevírací doba natrvalo („od září máme nově…“). Do starts_on den, od kdy platí (když ho e-mail neříká, dnešek), do slots celý nový týden, i dny, které se nemění (vezmi je z přehledu).
- Sběrný dvůr umí jen "zavreno" a "trvala" (jeden úsek denně). Jinou dobu na pár dní u dvora nezapisuj a zmiň to v question.
- Ordinace: když e-mail říká, kdo z lékařů kdy ordinuje, zapiš dočasnou změnu se slots podle běžných hodin a v poznámce slotu změň jen to, kdo ordinuje. Když lékař neordinuje a o sestře e-mail nic neříká, je zavřeno; když výslovně řekne, že sestra bude, nech otevřeno jen na odběry (poznámka „jen odběry, lékař neordinuje“).
- Změnu, která už v přehledu u místa je, nezapisuj znovu.
- slots: jeden řádek na souvislý úsek. day je den v týdnu (po, ut, st, ct, pa, so, ne), from a to jako HH:MM, note krátká poznámka, nebo prázdná.
- note: krátký důvod pro čtenáře („dovolená“, „školení“, „státní svátek“), bez data. Když ho e-mail neříká, nech prázdné. Nic si nevymýšlej.`;

export function mailSchema() {
  const text = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "question", "changes"],
    properties: {
      verdict: { type: "string", enum: ["zmeny", "nejasne", "neni_doba"] },
      question: text,
      changes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["target", "kind", "starts_on", "ends_on", "open_from", "close_at", "note", "slots"],
          properties: {
            target: text,
            kind: { type: "string", enum: ["zavreno", "docasna", "trvala"] },
            starts_on: text,
            ends_on: text,
            open_from: text,
            close_at: text,
            note: text,
            slots: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["day", "from", "to", "note"],
                properties: { day: { type: "string", enum: ["po", "ut", "st", "ct", "pa", "so", "ne"] }, from: text, to: text, note: text },
              },
            },
          },
        },
      },
    },
  };
}

function yardContext(yards) {
  if (!yards.length) return "";
  const rows = yards.map((yard) => {
    const closed = (yard.closures ?? []).map((closure) => `${closure.startsOn}${closure.endsOn !== closure.startsOn ? ` až ${closure.endsOn}` : ""} zavřeno`);
    return `[dvur:${yard.id}] ${yard.name} · ${yardHours(yard)}${closed.length ? ` · změny: ${closed.join("; ")}` : ""}`;
  });
  return `Sběrné dvory:\n${rows.join("\n")}`;
}

// Přehled jen s řádky, které odesílatel smí měnit (`allowed`: { places, doctors, yards }).
export function allowedContext(allowed) {
  const parts = [];
  if (allowed.places.length || allowed.doctors.length) {
    parts.push(
      hoursContext({ places: allowed.places, doctors: allowed.doctors })
        .split("\n\n")
        .filter((block) => !block.endsWith("(nic)"))
        .join("\n\n"),
    );
  }
  const yards = yardContext(allowed.yards);
  if (yards) parts.push(yards);
  return parts.join("\n\n");
}

// Kalendář na tři týdny dopředu, ať model data nepočítá (u „příští týden“ a dnů v týdnu se plete).
export function calendarText(today, weekday) {
  const toMonday = (8 - weekday) % 7 || 7;
  const nextMonday = addDays(today, toMonday);
  const thisSunday = addDays(nextMonday, -1);
  const days = [];
  for (let step = 0; step < 21; step += 1) {
    const iso = addDays(today, step);
    days.push(`${DAY_NAMES[(weekday + step) % 7]} ${iso}`);
  }
  return [
    `Tento týden: ${today} až ${thisSunday}. Příští týden: ${nextMonday} až ${addDays(nextMonday, 6)}.`,
    `Kalendář: ${days.join(", ")}`,
  ].join("\n");
}

export function mailContent({ today, weekday, sender, mail, allowed, earlier = null }) {
  const before = earlier
    ? `Předchozí e-mail od stejného odesílatele (${earlier.subject || "bez předmětu"}):\n${earlier.text}\n\nMoje otázka na něj: ${earlier.question}`
    : "";
  return [
    `Dnes je ${DAY_NAMES[weekday]} ${today} (${formatLong(today)}).`,
    calendarText(today, weekday),
    `Odesílatel: ${sender.label ? `${sender.label}, ` : ""}${mail.from}`,
    `Co smí měnit:\n${allowedContext(allowed)}`,
    before,
    `Předmět: ${mail.subject || "(bez předmětu)"}\n\nText e-mailu:\n${mail.text || "(prázdný)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function askDrbena(env, content) {
  return callClaude(env, { system: MAIL_SYSTEM, content, schema: mailSchema(), cheap: true });
}

// U sběrného dvora je den jeden úsek: od prvního začátku do posledního konce.
function yardWeek(slots) {
  const byDay = new Map();
  const days = { ne: 0, po: 1, ut: 2, st: 3, ct: 4, pa: 5, so: 6 };
  for (const slot of slots ?? []) {
    const day = days[slot?.day];
    const from = parseTime(slot?.from);
    const to = parseTime(slot?.to);
    if (day == null || !from || !to) continue;
    const prev = byDay.get(day);
    byDay.set(day, { day, open: true, from: !prev || from < prev.from ? from : prev.from, to: !prev || to > prev.to ? to : prev.to });
  }
  return [...byDay.values()];
}

// Jedna změna z odpovědi, převedená na formulář sekce (stejná pole jako v redakci), nebo { error }.
// Běžný týden zkrácený na „otevírá v“ / „zavírá v“: úseky se jen oříznou, polední pauza zůstane.
export function trimWeek(week, openFrom, closeAt) {
  const cut = (part) => {
    if (!part?.open) return part;
    const from = openFrom && openFrom > part.from ? openFrom : part.from;
    const to = closeAt && closeAt < part.to ? closeAt : part.to;
    return from < to ? { ...part, from, to } : { ...part, open: false };
  };
  return (week ?? []).map((slot) => ({ ...slot, morning: cut(slot.morning), afternoon: cut(slot.afternoon) }));
}

// `regular`: značka řádku ("misto:3") → jeho běžný týden; jen řádky, které adresa smí měnit.
export function changeInput(raw, regular) {
  const target = String(raw?.target ?? "").trim().replace(/^\[|\]$/g, "");
  const match = target.match(/^(misto|lekar|dvur):(\d+)$/);
  if (!match || !regular.has(target)) return { error: "místo, které z téhle adresy měnit nejde" };
  const id = Number(match[2]);
  const kind = ["zavreno", "docasna", "trvala"].includes(raw?.kind) ? raw.kind : "docasna";
  const startsOn = isoDate(raw?.starts_on);
  const span = changeSpan(startsOn, kind === "trvala" ? "" : isoDate(raw?.ends_on) || startsOn);
  if (span.error) return { error: "chybí nebo nesedí datum" };
  const note = String(raw?.note ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  const closed = kind === "zavreno";
  if (match[1] === "dvur") {
    if (kind === "docasna") return { error: "jinou dobu na pár dní u sběrného dvora zapsat nejde, jen zavřeno nebo novou běžnou dobu" };
    if (closed) return { section: "dvory", action: "uzavreni", targetId: id, kind, span, input: { startsOn: span.startsOn, endsOn: span.endsOn, reason: note || "Mimořádně zavřeno" } };
    return { section: "dvory", action: "hodiny", targetId: id, kind, span, input: { week: yardWeek(raw.slots) } };
  }
  const openFrom = parseTime(raw?.open_from);
  const closeAt = parseTime(raw?.close_at);
  const shifted = kind === "docasna" && (openFrom || closeAt);
  const parsed = closed ? normalizeWeek([]) : shifted ? normalizeWeek(trimWeek(regular.get(target), openFrom, closeAt)) : weekFromSlots(raw?.slots);
  if (parsed.error) return { error: "nejde přečíst časy" };
  const open = parsed.week.some((slot) => slot.morning.open || slot.afternoon.open);
  if (!closed && !open) return { error: "chybí časy, kdy je otevřeno" };
  const shiftNote = [openFrom && `otevírá až v ${clock(openFrom)}`, closeAt && `zavírá už v ${clock(closeAt)}`].filter(Boolean).join(", ");
  const fallback = closed ? "Mimořádně zavřeno" : shifted ? shiftNote.charAt(0).toUpperCase() + shiftNote.slice(1) : "Jiná otevírací doba";
  const changeNote = note || fallback;
  if (match[1] === "lekar") {
    if (kind === "trvala") return { section: "lekari", action: "hodiny", targetId: id, kind, span, input: { doctorWeek: parsed.week } };
    return { section: "lekari", action: "zmena", targetId: id, kind, span, input: { startsOn: span.startsOn, endsOn: span.endsOn, changeNote, doctorWeek: parsed.week } };
  }
  return {
    section: "oteviraci-doba",
    action: "zmena",
    targetId: id,
    kind,
    span,
    input: { kind: kind === "trvala" ? "trvala" : "docasna", startsOn: span.startsOn, endsOn: span.endsOn, changeNote: kind === "trvala" ? note : changeNote, doctorWeek: parsed.week, placeId: id },
  };
}
