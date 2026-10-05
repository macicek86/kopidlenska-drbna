// Redakce: povaha kozy Drběny. Jedno místo pro hlas, kterým píše zprávy města i fotbal.
import { DEFAULT_FOOTBALL, DEFAULT_PERSONA, FOOTBALL_MAX, PERSONA_MAX, ownFootball, ownPersona } from "../drbena.js";
import { ASSIST_BOUNDS } from "../assist/store.js";
import { TRY_DEMO, TRY_KINDS, TRY_TEXT_MAX } from "../drbena-try.js";
import { NOTICE_KINDS } from "../notices.js";
import { esc } from "../view.js";
import { refLink } from "./imports.js";
import { adminShell } from "./shell.js";
import { badge, callout, check, field, input, pageHead } from "./ui.js";

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

// Navazující zprávy: když o věci už zpráva je a zdroj přinese víc, napíše Drběna doplnění „jak už jsem psala…“.
function followupPanel(drbena) {
  return `<form class="panel form" method="post" action="${BASE}/navazujici" data-dirty>
      <header class="panel-head"><h2>Navazující zprávy</h2>${drbena.followupPublish ? badge("Rovnou na web", "info") : badge("Jako návrh")}</header>
      <p class="panel-note">Když o věci už na drbně zpráva je a Munipolis, Deník nebo škola přinesou něco nového (výsledek, jména, jiný termín), napíše Drběna navazující zprávu s odkazem na tu původní. K jedné zprávě nejvýš dvě.</p>
      ${check("followupPublish", "1", drbena.followupPublish, "Navazující zprávy rovnou zveřejňovat", "Jen u importů, které zveřejňují rovnou. Bez zaškrtnutí čeká každá navazující zpráva jako návrh.")}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit</button></div>
    </form>`;
}

// Paměť (src/drbena-memory.js): navázat na související zprávu, trvající odstávku nebo nedávnou akci.
function memoryPanel(drbena) {
  return `<form class="panel form" method="post" action="${BASE}/pamet" data-dirty>
      <header class="panel-head"><h2>Paměť Drběny</h2>${drbena.memory ? badge("Zapnuto", "info") : badge("Vypnuto")}</header>
      <p class="panel-note">Drběna si v článcích z Munipolisu, Deníku, škol a uzavírek pamatuje, co se v Kopidlně děje. Jednou větou naváže na související zprávu („Sotva si Drběna zvykla na bagry na náměstí…“), připomene odstávku, která pořád trvá, nebo vzpomene na akci z posledního týdne („Drběna se sotva vrátila z drakiády…“). Na každou akci jen jednou a o jejím průběhu si nic nevymýšlí.</p>
      ${check("memory", "1", drbena.memory, "Drběna si pamatuje", "Bez zaškrtnutí píše každý článek jen sám o sobě.")}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit</button></div>
    </form>`;
}

function czk(value) {
  return `${value.toLocaleString("cs-CZ", { maximumFractionDigits: value < 10 ? 2 : 0 })} Kč`;
}

function usageRows(month) {
  if (!month.people.length) return `<p class="panel-note">Zatím nikdo.</p>`;
  const rows = month.people
    .map((row) => `<li><b>${esc(row.name)}</b>${row.chief ? " (hlavní redaktor)" : ""}: ${row.uses}×${row.failed ? `, nepovedlo se ${row.failed}×` : ""}, ${czk(row.czk)}</li>`)
    .join("");
  return `<ul class="plain">${rows}</ul>`;
}

// Pomocník při psaní (src/assist/): limity pro přispěvatele a kolik to stálo.
function assistPanel(assist) {
  if (!assist) return "";
  const { settings, thisMonth, lastMonth } = assist;
  const number = (name, value, [min, max]) => `<input class="${input}" type="number" name="${name}" min="${min}" max="${max}" required value="${value}">`;
  return `<form class="panel form" method="post" action="${BASE}/pomocnik" data-dirty>
      <header class="panel-head"><h2>Pomocník při psaní</h2>${badge(`tento měsíc ${czk(thisMonth.czk)}`)}</header>
      <p class="panel-note">U zprávy jde nechat Drběnu přepsat text svým hlasem (podle povahy nahoře) nebo ho jen učesat. Přispěvatel na to potřebuje oprávnění Pomocník při psaní (stránka Lidé). Hlavní redaktor limity nemá.</p>
      <div class="pair">
        ${field("Denně na přispěvatele", number("assistPerDay", settings.perDay, ASSIST_BOUNDS.perDay), "Kolikrát za den smí jeden přispěvatel pomocníka použít.")}
        ${field("Měsíční rozpočet (Kč)", number("assistBudget", settings.budget, ASSIST_BOUNDS.budget), `Za všechny přispěvatele dohromady. Tento měsíc ${czk(thisMonth.contributorsCzk)}. Jedno použití stojí zhruba 30 haléřů až korunu.`)}
      </div>
      <p class="panel-note"><b>Tento měsíc</b></p>
      ${usageRows(thisMonth)}
      ${lastMonth.people.length ? `<p class="panel-note"><b>Minulý měsíc</b> (${czk(lastMonth.czk)})</p>${usageRows(lastMonth)}` : ""}
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit limity</button></div>
    </form>`;
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
      <label class="check"><input type="checkbox" name="memory" value="1" form="${FORM}"${values.memory ? " checked" : ""}> <span>S pamětí</span></label>
      <span class="hint check-hint">Jen u zprávy města. Drběna může navázat na zprávy, odstávky a akce, které na drbně opravdu jsou. Zkouška akci neoznačí, ve skutečném článku na ni Drběna vzpomenout může.</span>
      <label class="check"><input type="checkbox" name="auto" value="1" form="${FORM}"${values.auto ? " checked" : ""}> <span>Jako automatika</span></label>
      <span class="hint check-hint">Jen u zprávy města. Drběna se rozhodne jako při automatickém importu: když o věci na drbně už něco je, nebo ji nezajímá, článek nenapíše. Bez zaškrtnutí ho napsat musí, jako když ho vyberete ručně.</span>
      <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-line" type="submit" form="${FORM}" formaction="${BASE}/zkusit#ukazka" data-busy="Drběna píše…">Napsat ukázku</button></div>
    </section>`;
}

const DECISIONS = { vytvorit: "napsat", preskocit: "přeskočit", duplicita: "duplicita", doplneni: "navazující zpráva" };

function extras(result) {
  const rows = [];
  if (result.reason) rows.push(`<li><b>Rozhodla (${esc(DECISIONS[result.decision] ?? result.decision)}):</b> ${esc(result.reason)}</li>`);
  if (result.read?.length) rows.push(`<li><b>Přečetla si:</b> ${result.read.map((ref) => refLink(ref) || esc(ref)).join(", ")}</li>`);
  if (result.recalled) {
    rows.push(`<li><b>Vzpomněla na akci:</b> ${esc(result.recalled.title)} · ${esc(result.recalled.startsOn)}</li>`);
  }
  if (result.target) rows.push(`<li><b>Navazuje na zprávu:</b> ${esc(result.target.title)}</li>`);
  if (result.decision === "duplicita" && result.duplicateOf) rows.push(`<li><b>Má to za duplicitu s:</b> ${esc(result.duplicateOf)}</li>`);
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
  const drbena = data.drbena ?? { persona: "", football: "", followupPublish: false, memory: true };
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
    ${followupPanel(drbena)}
    ${memoryPanel(drbena)}
    ${assistPanel(data.assist)}
    ${tryPanel(trial?.input)}
    ${trial ? samplePanel(trial, unsaved) : ""}`;
  return adminShell(ctx, data, "drbena", message, body, { title: "Koza Drběna" });
}
