export function formatLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const text = new Intl.DateTimeFormat("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatShort(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}. ${m}. ${y}`;
}

export function formatDayMonth(iso) {
  const [, m, d] = iso.split("-").map(Number);
  const months = [
    "ledna",
    "února",
    "března",
    "dubna",
    "května",
    "června",
    "července",
    "srpna",
    "září",
    "října",
    "listopadu",
    "prosince",
  ];
  return `${d}. ${months[m - 1]}`;
}

export function countdownLabel(days) {
  if (days <= 0) return "Svoz je dnes.";
  if (days === 1) return "Svoz je zítra.";
  if (days < 5) return `Za ${days} dny.`;
  return `Za ${days} dní.`;
}

const DAY_IN = ["neděli", "pondělí", "úterý", "středu", "čtvrtek", "pátek", "sobotu"];

export function ruleLabel(rule) {
  const day = DAY_IN[rule.weekday] ?? "pondělí";
  const prep = rule.weekday === 3 ? "ve" : "v";
  const parity = rule.weekParity === 1 ? "lichého" : "sudého";
  return `Jednou za ${rule.stepDays} dní, ${prep} ${day} ${parity} kalendářního týdne.`;
}

export function weekdayName(index) {
  return ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"][index] ?? "Pondělí";
}
