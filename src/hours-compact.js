// Běžný týden krátce na jeden řádek: stejné dny po sobě sloučené, zavřené vynechané, celé hodiny bez „:00“.
// „Po–Čt 9–12, 13–17; Pá 9–12“. Bere popis pro sdílení (src/hours-share.js) i seznamy v redakci.
const SHORT = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];

function time(value) {
  return String(value).replace(/^0/, "").replace(/:00$/, "");
}

// Úseky jednoho dne: místa a lékaři mají dopoledne a odpoledne, dvory jeden úsek.
function dayRanges(slot) {
  const parts = "morning" in slot ? [slot.morning, slot.afternoon] : [slot];
  return parts.filter((part) => part?.open).map((part) => `${time(part.from)}–${time(part.to)}`).join(", ");
}

export function compactWeek(week) {
  const groups = [];
  for (const slot of week ?? []) {
    const text = dayRanges(slot);
    const last = groups.at(-1);
    if (last && last.text === text && last.to === (slot.day + 6) % 7) last.to = slot.day;
    else groups.push({ text, from: slot.day, to: slot.day });
  }
  return groups
    .filter((group) => group.text)
    .map((group) => `${SHORT[group.from]}${group.to === group.from ? "" : `–${SHORT[group.to]}`} ${group.text}`)
    .join("; ");
}
