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

export function countdownLabel(days, copy = {}) {
  const pick = (key, fallback) => {
    const value = copy?.[key];
    return typeof value === "string" && value.trim() ? value : fallback;
  };
  if (days <= 0) return pick("countdown_today", "Svoz je dnes.");
  if (days === 1) return pick("countdown_tomorrow", "Svoz je zítra.");
  const template = days < 5 ? pick("countdown_few", "Za {n} dny.") : pick("countdown_many", "Za {n} dní.");
  return template.replaceAll("{n}", String(days));
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
