// Jedna změna hodin jako řádek do e-mailu odesílateli („Dětská hernička: pondělí 12. října až neděle 18. října, zavřeno“).
// Bere uloženou hodnotu sekce (co vrací `read` akce), takže sedí i po úpravě redakcí při schválení.
import { hoursSummary, periodClosed, spanSummary } from "../doctors.js";
import { formatLong } from "../format.js";
import { hoursSummary as yardHours } from "../yards.js";

function day(iso) {
  const text = formatLong(iso);
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function span(value) {
  return value.startsOn === value.endsOn ? day(value.startsOn) : `${day(value.startsOn)} až ${day(value.endsOn)}`;
}

// Běžné hodiny lékaře a dvora datum nemají, run.js ho připíše z e-mailu.
function since(value) {
  return value.startsOn ? `od ${day(value.startsOn)} ` : "";
}

export function describeChange(section, action, value, name) {
  const who = name ? `${name}: ` : "";
  if (section === "dvory") {
    if (action === "uzavreni") return `${who}${span(value)}, zavřeno${value.reason ? ` (${value.reason})` : ""}`;
    return `${who}${since(value)}nová běžná doba: ${yardHours({ week: value.week })}`;
  }
  if (action === "hodiny") return `${who}${since(value)}nová běžná doba: ${hoursSummary({ week: value.week }, "")}`;
  if (value.kind === "trvala") return `${who}od ${day(value.startsOn)} nová běžná doba: ${hoursSummary({ week: value.week }, "")}`;
  const note = value.note ? ` (${value.note})` : "";
  return `${who}${span(value)}, ${periodClosed(value) ? "zavřeno" : spanSummary(value)}${note}`;
}
