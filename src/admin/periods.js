// Formulář „Zavřeno nebo jiná doba“ s více obdobími pro místa, lékaře i sběrné dvory (zpracování: src/periods.js).
// Každé období: od–do, co platí (zavřeno celý den, jen do, až od, nebo rozepsané po dnech) a důvod.
// Bez JS jsou vidět dvě období a všechna pole; s JS (public/periods.js) se období přidávají a odebírají.
import { blankWeek } from "../doctors.js";
import { esc } from "../view.js";
import { WEEK_DAYS } from "../yards.js";
import { doctorHoursFields, yardHoursFields } from "./hours.js";
import { callout, cancelLink, field, formFoot, hidden, input } from "./ui.js";

const MODE_LABELS = {
  zavreno: "Zavřeno celý den",
  jendo: "Otevřeno jen do …",
  azod: "Otevřeno až od …",
  jina: "Jiná doba, rozepsat po dnech",
};

function blankYardWeek() {
  return WEEK_DAYS.map(({ day }) => ({ day, open: false, from: "08:00", to: "16:00" }));
}

function hasOpen(week) {
  return (week ?? []).some((slot) => slot.open || slot.morning?.open || slot.afternoon?.open);
}

// Hodnota období do tvaru bloku: bere uloženou změnu (`week`, `note`/`reason`), vstup z e-mailu (`doctorWeek`,
// `changeNote`) i už hotový blok (`mode`, `time`).
export function periodView(value = {}) {
  const week = value.week ?? value.doctorWeek ?? null;
  const mode = value.mode ?? (hasOpen(week) ? "jina" : "zavreno");
  return {
    startsOn: String(value.startsOn ?? ""),
    endsOn: value.endsOn && value.endsOn !== value.startsOn ? String(value.endsOn) : "",
    mode,
    time: String(value.time ?? ""),
    note: String(value.note ?? value.changeNote ?? value.reason ?? ""),
    week,
  };
}

function modeRadio(index, mode, current) {
  return `<label class="check period-mode"><input type="radio" name="p${index}-mode" value="${mode}"${mode === current ? " checked" : ""} data-period-mode> <span>${MODE_LABELS[mode]}</span></label>`;
}

// Jedno období. `n` je pořadí (1…), `flavour`: "week2" místa a lékaři, "week1" dvory, `review`: okno
// hlavního redaktora (jen zavřeno a rozepsané po dnech, bez „jen do“ a „až od“, které potřebují běžnou dobu).
function periodBlock(n, view, { flavour, review }) {
  const ns = `p${n}-`;
  const week = view.week ?? (flavour === "week1" ? blankYardWeek() : blankWeek());
  const grid = flavour === "week1" ? yardHoursFields(week, ns, "Otevřeno v tom období") : doctorHoursFields(week, "Otevřeno v tom období", ns);
  const modes = review ? ["zavreno", "jina"] : ["zavreno", "jendo", "azod", "jina"];
  return `<fieldset class="period" data-period>
    <legend class="period-title"><span data-period-title>Období ${n}</span></legend>
    <div class="pair">
      ${field("Od", `<input class="control" type="date" name="${ns}from" value="${esc(view.startsOn)}" data-period-from>`)}
      ${field("Do", `<input class="control" type="date" name="${ns}to" value="${esc(view.endsOn)}">`, "Jeden den: nechte prázdné.")}
    </div>
    <div class="field period-modes"><span>Co v tom období platí</span>
      ${modes.map((mode) => modeRadio(n, mode, view.mode)).join("")}
    </div>
    ${review ? "" : `<div class="period-time"><label class="field"><span>V kolik hodin</span><input class="control control-time" type="time" name="${ns}time" value="${esc(view.time)}"></label></div>`}
    <details class="period-week"${view.mode === "jina" ? " open" : ""}>
      <summary>Časy po dnech</summary>
      ${grid}
    </details>
    ${field("Důvod", `<input class="${input}" type="text" name="${ns}note" maxlength="400" value="${esc(view.note)}" placeholder="Nemusí být. Třeba školení, dovolená.">`)}
    <div class="period-tools"><button class="btn btn-ghost btn-sm btn-danger-text" type="button" data-period-remove hidden>Odebrat období</button></div>
  </fieldset>`;
}

// `subject` je jméno místa, lékaře nebo dvora; `opts` jako u ostatních formulářů sekcí (action, extra, value,
// values, submit, cancel) a navíc `review` a `hidden` (skrytá pole s id řádku).
export function periodsForm(subject, { flavour, lead, idName, id, opts = {} }) {
  const given = opts.values?.length ? opts.values : opts.value ? [opts.value] : [];
  const views = given.map(periodView);
  while (!opts.review && views.length < 2) views.push(periodView());
  const blocks = views.map((view, at) => periodBlock(at + 1, view, { flavour, review: Boolean(opts.review) })).join("");
  const template = opts.review ? "" : `<template data-period-template>${periodBlock("__N__", periodView(), { flavour, review: false })}</template>`;
  return `<form class="form" method="post" action="${opts.action}" data-periods>
    ${hidden(idName, id)}${opts.extra ?? ""}
    ${callout(lead(subject))}
    <div data-period-list>${blocks}</div>
    ${template}
    ${opts.review ? "" : `<div class="period-add"><button class="btn btn-ghost" type="button" data-period-add hidden>+ Přidat další období</button></div>`}
    ${formFoot(opts.submit ?? "Zapsat změnu", cancelLink(opts.cancel ?? "/redakce"))}
  </form>`;
}
