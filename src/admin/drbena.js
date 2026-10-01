// Redakce: povaha kozy Drběny. Jedno místo pro hlas, kterým píše zprávy města i fotbal.
import { DEFAULT_FOOTBALL, DEFAULT_PERSONA, FOOTBALL_MAX, PERSONA_MAX, ownFootball, ownPersona } from "../drbena.js";
import { TRY_DEMO, TRY_KINDS, TRY_TEXT_MAX } from "../drbena-try.js";
import { NOTICE_KINDS } from "../notices.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, field, input, pageHead } from "./ui.js";

const BASE = "/redakce/drbena";
const FORM = "drbena-povaha";

function state(own) {
  return own ? badge("Vlastní text", "info") : badge("Výchozí text");
}

function kindOptions(selected) {
  return Object.entries(TRY_KINDS)
    .map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${esc(label)}</option>`)
    .join("");
}

// Pole zkoušky patří k formuláři povahy (atribut form), ať Drběna píše i podle neuložené povahy.
// Bez zkoušky je ve formuláři ukázková zpráva, ať stačí kliknout.
function tryPanel(values = TRY_DEMO) {
  return `<section class="panel form" id="zkouska">
      <header class="panel-head"><h2>Vyzkoušet povahu</h2></header>
      <p class="panel-note">Vložte článek (nebo nechte ukázkovou zprávu) a Drběna ho napíše tak, jak by ho napsala při importu, podle povahy v polích nahoře (i neuložené). Nic se nezveřejní ani neuloží.</p>
      ${field("Druh", `<select class="${input}" name="kind" form="${FORM}">${kindOptions(values.kind)}</select>`)}
      ${field("Nadpis", `<input class="${input}" name="title" form="${FORM}" maxlength="200" value="${esc(values.title)}">`, "Nepovinné.")}
      ${field("Text článku", `<textarea class="${input}" name="text" form="${FORM}" rows="10" maxlength="${TRY_TEXT_MAX}">${esc(values.text)}</textarea>`)}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-line" type="submit" form="${FORM}" formaction="${BASE}/zkusit#ukazka" data-busy="Drběna píše…">Napsat ukázku</button></div>
    </section>`;
}

function extras(result) {
  const rows = [];
  if (result.event) {
    const when = [result.event.startsOn, result.event.startsTime].filter(Boolean).join(" ");
    rows.push(`<li><b>Akce do kalendáře:</b> ${esc(result.event.title)} · ${esc(when)} · ${esc(result.event.place)}</li>`);
  }
  if (result.notice) {
    const label = NOTICE_KINDS[result.notice.kind]?.label ?? "Oznámení";
    rows.push(`<li><b>${esc(label)}:</b> ${esc(result.notice.title)} · ${esc(result.notice.places.join(", "))}</li>`);
  }
  return rows.length ? `<ul class="drbena-extras">${rows.join("")}</ul>` : "";
}

function samplePanel(trial, unsaved) {
  const { result } = trial;
  let body;
  if (!result.ok) body = callout(esc(result.error), "bad");
  else {
    const article = result.article
      ? `<article class="drbena-sample">
          <h3>${esc(result.article.title)}</h3>
          <p class="drbena-sample-lede">${esc(result.article.excerpt)}</p>
          <div class="drbena-sample-body">${result.article.body}</div>
        </article>`
      : callout("Článek by Drběna nenapsala, jen to níž.");
    body = `${article}${extras(result)}`;
  }
  const note = unsaved ? callout("Ukázka je podle neuložené povahy. Když se vám líbí, uložte ji.", "warn") : "";
  return `<section class="panel" id="ukazka">
      <header class="panel-head"><h2>Jak by to Drběna napsala</h2>${badge(TRY_KINDS[trial.input.kind])}</header>
      ${note}
      ${body}
    </section>`;
}

// `trial` je zkouška povahy: { input, result }. Povaha se pak ukáže tak, jak byla v polích.
export function adminDrbena(ctx, data, message, trial = null) {
  const drbena = data.drbena ?? { persona: "", football: "" };
  const persona = trial ? trial.input.persona.trim() || DEFAULT_PERSONA : drbena.persona || DEFAULT_PERSONA;
  const football = trial ? trial.input.football.trim() || DEFAULT_FOOTBALL : drbena.football || DEFAULT_FOOTBALL;
  const ownP = trial ? ownPersona(persona) : drbena.persona;
  const ownF = trial ? ownFootball(football) : drbena.football;
  const unsaved = Boolean(trial) && (ownP !== drbena.persona || ownF !== drbena.football);
  const body = `${pageHead(
    "Koza Drběna",
    "Podle tohohle píše Drběna zprávy z Munipolisu i fotbal. Pravidla o faktech, datech, rubrikách a duplicitách platí vždy, tady jde jen o povahu a styl.",
  )}
    <form class="panel form${unsaved ? " is-dirty" : ""}" id="${FORM}" method="post" action="${BASE}/ulozit" data-dirty>
      <header class="panel-head"><h2>Povaha Drběny</h2>${state(ownP)}</header>
      ${callout("Když pole vymažete a uložíte, vrátí se výchozí text. Změna platí pro další články, napsané zůstanou, jak jsou.")}
      ${field("Kdo Drběna je a jak píše", `<textarea class="${input}" name="persona" rows="24" maxlength="${PERSONA_MAX}">${esc(persona)}</textarea>`, "Platí pro všechno, co Drběna píše.")}
      ${field(`U fotbalu ${state(ownF)}`, `<textarea class="${input}" name="football" rows="6" maxlength="${FOOTBALL_MAX}">${esc(football)}</textarea>`, "Fotbalové zvyky navíc. Ve fotbalových článcích se přidají k povaze.")}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit povahu</button></div>
    </form>
    ${tryPanel(trial?.input)}
    ${trial ? samplePanel(trial, unsaved) : ""}`;
  return adminShell(ctx, data, "drbena", message, body, { title: "Koza Drběna" });
}
