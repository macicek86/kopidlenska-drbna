// Témata upozornění, která si čtenář na /upozorneni zaškrtá, a co si u nich může vybrat.
// `pick`: seznam, ze kterého si vybere jen některé (prázdný výběr = všechno).
export const PUSH_TOPICS = [
  { key: "zpravy", label: "Nové zprávy", hint: "Když na drbně vyjde zpráva.", pick: "rubrics", pickLabel: "Jen některé rubriky" },
  { key: "hodiny", label: "Otevírací doba", hint: "Úřad, knihovna a další místa: když mají zavřeno nebo jinou dobu.", pick: "places", pickLabel: "Jen některá místa" },
  { key: "lekari", label: "Lékaři", hint: "Dovolená a změny ordinačních hodin.", pick: "doctors", pickLabel: "Jen někteří lékaři" },
  { key: "dvory", label: "Sběrný dvůr", hint: "Večer předem, když je druhý den otevřeno, a když bude zavřeno.", pick: "yards", pickLabel: "Jen některé dvory" },
  { key: "akce", label: "Akce", hint: "Večer předem, co se zítra v Kopidlně koná." },
  { key: "svoz", label: "Svoz popelnic", hint: "Večer před svozem." },
  { key: "odstavky", label: "Odstávky a uzavírky", hint: "Kdy nepoteče voda, nepůjde proud nebo bude zavřená silnice.", pick: "kinds", pickLabel: "Jen něco z toho" },
];

export const TOPIC_KEYS = PUSH_TOPICS.map((topic) => topic.key);
export const PICK_KEYS = ["rubrics", "places", "doctors", "yards", "kinds"];
export const NOTICE_PICKS = [
  ["voda", "Voda"],
  ["elektrina", "Elektřina"],
  ["uzavirka", "Silnice"],
];

const MAX_PICKS = 200;

// Nastavení od prohlížeče: jen známá témata, výběry jako čísla (druhy odstávek jako slova).
export function readPrefs(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const topics = [...new Set((Array.isArray(input.topics) ? input.topics : []).map(String))].filter((key) => TOPIC_KEYS.includes(key));
  const source = input.pick && typeof input.pick === "object" ? input.pick : {};
  const pick = {};
  for (const key of PICK_KEYS) {
    const list = Array.isArray(source[key]) ? source[key] : [];
    const values =
      key === "kinds"
        ? list.map(String).filter((kind) => NOTICE_PICKS.some(([value]) => value === kind))
        : list.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    pick[key] = [...new Set(values)].slice(0, MAX_PICKS);
  }
  return { topics, pick };
}

export function parsePrefs(text) {
  try {
    return readPrefs(JSON.parse(String(text || "{}")));
  } catch {
    return readPrefs({});
  }
}

// Patří zpráva k odběru? `message.topic` a `message.targets` (id rubriky a nadřazené, id místa, druh odstávky…).
export function wants(prefs, message) {
  if (!prefs.topics.includes(message.topic)) return false;
  const topic = PUSH_TOPICS.find((item) => item.key === message.topic);
  const chosen = topic?.pick ? prefs.pick[topic.pick] ?? [] : [];
  if (!chosen.length) return true;
  return (message.targets ?? []).some((target) => chosen.includes(target));
}
