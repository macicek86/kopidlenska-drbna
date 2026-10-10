// Formulář „Zavřeno nebo jiná doba“ s více obdobími: místa, lékaři a sběrné dvory mají stejný postup.
// Každé období je jedna dočasná změna (stejná jako dřív jedno období ve formuláři), formulář je jen
// pohodlnější obal: jedním odesláním se zapíše víc změn a každá jde svou cestou (rovnou, nebo ke schválení).
//
// Pole formuláře: `p<n>-from`, `p<n>-to` (datum od a do), `p<n>-mode` (zavreno, jendo, azod, jina), `p<n>-time`
// (čas k „jen do“ a „až od“), `p<n>-note` (důvod) a týden pod „jina“ (`p<n>-am-open-<den>`… u míst a lékařů,
// `p<n>-open-<den>`… u dvorů).
import { blankWeek, changeSpan } from "./doctors.js";
import { clock } from "./mailin/describe.js";
import { spanWeekdays, trimWeek, weekDiffers } from "./week-shift.js";
import { WEEK_DAYS, normalizeWeek as yardNormalize, parseTime } from "./yards.js";

export const MAX_PERIODS = 10;
export const MODES = ["zavreno", "jendo", "azod", "jina"];

const text = (form, name) => String(form.get(name) ?? "").trim();

// Z odeslaného formuláře. Prázdné období (nic nevyplněné) se přeskočí.
export function readPeriods(form) {
  const periods = [];
  for (let index = 1; index <= MAX_PERIODS; index += 1) {
    const prefix = `p${index}-`;
    const mode = text(form, `${prefix}mode`);
    const period = {
      index,
      startsOn: text(form, `${prefix}from`),
      endsOn: text(form, `${prefix}to`),
      mode: MODES.includes(mode) ? mode : "zavreno",
      time: text(form, `${prefix}time`),
      note: text(form, `${prefix}note`),
      // Týden pod „Jiná doba“: místa a lékaři dopoledne a odpoledne, dvory jeden úsek.
      week2: WEEK_DAYS.map(({ day }) => ({
        day,
        morning: { open: form.get(`${prefix}am-open-${day}`) === "1", from: text(form, `${prefix}am-from-${day}`), to: text(form, `${prefix}am-to-${day}`), note: text(form, `${prefix}am-note-${day}`) },
        afternoon: { open: form.get(`${prefix}pm-open-${day}`) === "1", from: text(form, `${prefix}pm-from-${day}`), to: text(form, `${prefix}pm-to-${day}`), note: text(form, `${prefix}pm-note-${day}`) },
      })),
      week1: WEEK_DAYS.map(({ day }) => ({
        day,
        open: form.get(`${prefix}open-${day}`) === "1",
        from: text(form, `${prefix}from-${day}`),
        to: text(form, `${prefix}to-${day}`),
      })),
    };
    const touched = period.startsOn || period.endsOn || period.time || period.note || period.week2.some((slot) => slot.morning.open || slot.afternoon.open) || period.week1.some((slot) => slot.open);
    if (touched) periods.push(period);
  }
  return periods;
}

function label(index) {
  return `Období ${index}`;
}

function overlapError(items) {
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      if (items[a].startsOn <= items[b].endsOn && items[b].startsOn <= items[a].endsOn) {
        return `${label(items[a].index)} a ${label(items[b].index)} se překrývají. Jeden den smí mít jen jednu změnu.`;
      }
    }
  }
  return "";
}

function fallbackNote(mode, time) {
  if (mode === "zavreno") return "Mimořádně zavřeno";
  if (mode === "jendo") return `Zavírá už v ${clock(time)}`;
  if (mode === "azod") return `Otevírá až v ${clock(time)}`;
  return "Jiná otevírací doba";
}

function periodText(item) {
  return item.startsOn === item.endsOn ? item.startsOn : `${item.startsOn} – ${item.endsOn}`;
}

// Období z formuláře → změny k zápisu. `regular` je běžný týden řádku (pro „jen do“ a „až od“; u návrhu ke
// schválení bez něj nejsou tyto dvě volby k dispozici), `shape`: "week2" místa a lékaři, "week1" dvory.
// Vrací { items: [{ index, startsOn, endsOn, note, week }] } (week null = zavřeno), nebo { error }.
export function buildPeriods(periods, { regular = null, shape }) {
  if (!periods.length) return { error: "Doplňte aspoň jedno období: od kdy do kdy se doba mění." };
  if (periods.length > MAX_PERIODS) return { error: `Najednou jde zapsat nejvýš ${MAX_PERIODS} období.` };
  const items = [];
  for (const period of periods) {
    const name = label(period.index);
    const span = changeSpan(period.startsOn, period.endsOn);
    if (span.error) return { error: `${name}: ${span.error}` };
    const days = spanWeekdays(span.startsOn, span.endsOn);
    let week = null;
    if (period.mode === "jendo" || period.mode === "azod") {
      const time = parseTime(period.time);
      if (!time) return { error: `${name}: doplňte čas, ${period.mode === "jendo" ? "do kdy" : "od kdy"} je otevřeno.` };
      if (!regular) return { error: `${name}: „Jen do“ a „Až od“ u tohohle návrhu nejde, použijte Jiná doba.` };
      const trimmed = trimWeek(regular, period.mode === "azod" ? time : "", period.mode === "jendo" ? time : "", days);
      if (!weekDiffers(regular, trimmed, days)) {
        return { error: `${name}: zadaný čas nic nemění, v ty dny je běžně otevřeno stejně nebo míň. Použijte Jiná doba, když chcete dobu prodloužit.` };
      }
      week = trimmed;
    } else if (period.mode === "jina") {
      const slots = shape === "week1" ? period.week1 : period.week2;
      const open = slots.some((slot) => (shape === "week1" ? slot.open : slot.morning.open || slot.afternoon.open));
      if (open) {
        if (shape === "week1") {
          const checked = yardNormalize(slots);
          if (checked.error) return { error: `${name}: ${checked.error}` };
          week = checked.week;
        } else {
          week = slots;
        }
      }
    }
    items.push({ index: period.index, startsOn: span.startsOn, endsOn: span.endsOn, note: period.note || fallbackNote(period.mode, parseTime(period.time)), week, mode: period.mode, time: parseTime(period.time) });
  }
  const overlap = overlapError(items);
  if (overlap) return { error: overlap };
  items.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return { items };
}

// Vstup jedné změny pro akci sekce (pole, která čte `read` akce).
export function changeFields(section, item) {
  if (section === "dvory") {
    return { startsOn: item.startsOn, endsOn: item.endsOn, reason: item.note, ...(item.week ? { week: item.week } : {}) };
  }
  const doctorWeek = item.week ?? blankWeek();
  const base = { startsOn: item.startsOn, endsOn: item.endsOn, changeNote: item.note, doctorWeek };
  return section === "oteviraci-doba" ? { ...base, kind: "docasna" } : base;
}
