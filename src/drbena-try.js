// Zkouška povahy: Drběna napíše z vloženého textu ukázku stejně jako při importu (i s nástroji na čtení zpráv). Nic se neukládá.
// Zpráva města dostane skutečný přehled toho, co na drbně je, a s pamětí i pravidlo src/drbena-memory.js.
import { askFootball } from "./fotbal/ai.js";
import { ownFootball, ownPersona, voiceFor } from "./drbena.js";
import { withMemory } from "./drbena-memory.js";
import { knownContent, rubricMap } from "./import-context.js";
import { askClaude } from "./munipolis/ai.js";
import { pragueNow } from "./waste.js";

export const TRY_KINDS = {
  mesto: "Zpráva města",
  zapas: "Fotbal: po zápase",
  pozvanka: "Fotbal: pozvánka",
  clanek: "Fotbal: klubová novinka",
};
export const TRY_TEXT_MAX = 8000;

// Vymyšlená zpráva města, ať jde povaha vyzkoušet hned. Má datum, čas, místo, ceny i výčet.
export const TRY_DEMO = {
  kind: "mesto",
  memory: true,
  title: "Pozvánka na Drakiádu 2026",
  text: `Město Kopidlno a Sbor dobrovolných hasičů Kopidlno zvou všechny děti i dospělé na tradiční Drakiádu, která se uskuteční v neděli 18. října 2026 od 14:00 na louce za fotbalovým hřištěm.

Program:
- soutěž o nejvýše létajícího draka
- soutěž o nejhezčího vlastnoručně vyrobeného draka
- opékání buřtů (buřty zajištěny, pití s sebou)

Startovné je 20 Kč za draka. Každý soutěžící dostane malou odměnu, vítězové obou kategorií věcné ceny.

V případě nepříznivého počasí (silný vítr nebo déšť) se akce přesouvá na neděli 25. října 2026. Změnu oznámíme hlášením místního rozhlasu a na webu města.

Bližší informace podá Jana Nováková, tel. 777 123 456.`,
};

function clean(value, max) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

// Co redakce do zkoušky vyplnila. Povaha je text z pole, i neuložený.
export function readTry(fields) {
  return {
    kind: Object.hasOwn(TRY_KINDS, fields.kind) ? fields.kind : "mesto",
    title: clean(fields.title, 200),
    text: clean(fields.articleText, TRY_TEXT_MAX),
    persona: String(fields.persona ?? ""),
    football: String(fields.football ?? ""),
    memory: Boolean(fields.memory),
    auto: Boolean(fields.auto),
  };
}

// Akce, na kterou Drběna v ukázce vzpomněla (jen z přehledu, nic se neoznačí), nebo null.
function recalledEvent(article, known) {
  const id = Number(String(article?.recall ?? "").replace("akce:", ""));
  return (known.recent ?? []).find((event) => event.id === id) ?? null;
}

// Vrací { ok: true, article, event, notice, recalled } nebo { ok: false, error }.
export async function tryVoice(env, input, { askCity = askClaude, askBall = askFootball, loadKnown = knownContent } = {}) {
  if (input.text.length < 20) return { ok: false, error: "Vložte text článku, aspoň pár vět." };
  const today = pragueNow().date;
  const drbena = { persona: ownPersona(input.persona), football: ownFootball(input.football) };
  const title = input.title || "(bez nadpisu)";
  if (input.kind === "mesto") {
    const rubrics = await rubricMap(env);
    const known = await loadKnown(env, { itemId: 0, today, recall: input.memory, about: { title: input.title, text: input.text } });
    const answer = await askCity(env, {
      item: { title, text: input.text, publishedAt: today },
      known,
      rubricSlugs: [...rubrics.keys()],
      voice: withMemory(voiceFor(drbena), input.memory),
      today,
      // Jako automatika smí Drběna zprávu přeskočit nebo ji mít za duplicitu, jinak ji napsat musí (jako ruční výběr).
      force: !input.auto,
    });
    return answer.ok ? { ...answer, recalled: recalledEvent(answer.article, known) } : answer;
  }
  const answer = await askBall(env, {
    item: { kind: input.kind, title, text: input.text, publishedOn: today },
    known: {},
    voice: voiceFor(drbena, "fotbal"),
    today,
    force: true,
  });
  return answer.ok ? { ...answer, event: null, notice: null } : answer;
}
