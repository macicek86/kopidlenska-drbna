import { COPY, text as tx, WELCOME_VERSION } from "../copy.js";
import { formatLong, weekdayName } from "../format.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { callout, check, field, icon, input, pageHead } from "./ui.js";

function saveBar(label) {
  return `<div class="save-bar"><span class="save-bar-note" data-dirty-note>Máte neuložené změny.</span><button class="btn btn-primary" type="submit">${label}</button></div>`;
}

function textField(label, value, control, long = false, hint = "") {
  return `<div class="text-field${long ? " text-field-long" : ""}" data-search="${esc(`${label} ${value}`.toLowerCase())}">${field(esc(label), control, esc(hint))}</div>`;
}

function welcomeAgainField(copy) {
  const version = Number(copy?.[WELCOME_VERSION]);
  const day = version > 1 ? formatLong(new Date(version).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" })) : "";
  const last = day ? ` Naposledy znovu ukázáno: ${day.charAt(0).toLowerCase()}${day.slice(1)}.` : "";
  const hint = `Po uložení se okno ukáže při příští návštěvě i těm, kdo ho už zavřeli. Hodí se, když v něm oznamujete novinku. Kvůli opravě překlepu nezaškrtávejte.${last}`;
  return `<div class="text-field text-field-long" data-search="ukázat okno znovu všem">${check("welcome_again", "1", false, "Ukázat okno znovu všem", esc(hint))}</div>`;
}

export function adminTexts(ctx, data, message) {
  const groups = [];
  for (const row of COPY) {
    const group = groups.find((candidate) => candidate.name === row.group);
    if (group) group.items.push(row);
    else groups.push({ name: row.group, items: [row] });
  }
  const blocks = groups
    .map((group, index) => {
      const fields = group.items
        .map((row) => {
          const value = tx(ctx.copy, row.key);
          const control = row.long
            ? `<textarea class="${input}" name="${row.key}" rows="${row.rows ?? 3}" maxlength="${row.max}" required>${esc(value)}</textarea>`
            : `<input class="${input}" name="${row.key}" maxlength="${row.max}" required value="${esc(value)}">`;
          return textField(row.label, value, control, row.long, row.hint);
        })
        .join("");
      const extra = group.name === "Uvítací okno" ? welcomeAgainField(ctx.copy) : "";
      return `<details class="text-group"${index === 0 ? " open" : ""}>
        <summary><span>${esc(group.name)}</span><small>${group.items.length + (extra ? 1 : 0)}</small></summary>
        <div class="text-group-body">${extra}${fields}</div>
      </details>`;
    })
    .join("");
  const body = `${pageHead("Texty webu", "Nápisy, titulky a odstavce na veřejných stránkách. Ve větách odpočtu nechte {n} tam, kde má být počet dní.")}
    <form class="texts-form" method="post" action="/redakce/texty/ulozit" data-dirty>
      <div class="texts-tools">
        <label class="filter">${icon("search")}<input type="search" placeholder="Hledat text…" data-text-filter aria-label="Hledat text"></label>
        <button class="btn btn-sm btn-ghost" type="button" data-expand>Rozbalit vše</button>
      </div>
      ${callout("Zprávy a pozvánky mají vlastní sekce. Den svozu, jeho vysvětlení a poznámka ke svátkům jsou v Popelnicích.")}
      <div class="text-groups">${blocks}</div>
      ${saveBar("Uložit texty")}
    </form>`;
  return adminShell(ctx, data, "texty", message, body, { title: "Texty webu" });
}

export function adminSite(ctx, data, message) {
  const waste = data.waste;
  const days = [1, 2, 3, 4, 5, 6, 0]
    .map((day) => `<option value="${day}"${waste.weekday === day ? " selected" : ""}>${weekdayName(day)}</option>`)
    .join("");
  const body = `${pageHead("Popelnice", "Pravidlo svozu pro stránku Popelnice a titulku.")}
    <form class="settings-form" method="post" action="/redakce/svoz/ulozit" data-dirty>
      <section class="panel">
        <header class="panel-head"><h2>Svoz</h2><p class="panel-note">Příští svoz: <b>${esc(formatLong(waste.nextDate))}</b></p></header>
        <div class="form">
          <div class="triple">
            ${field("Den svozu", `<select class="${input}" name="weekday">${days}</select>`)}
            ${field(
              "Týdny",
              `<select class="${input}" name="weekParity">
                <option value="1"${waste.weekParity === 1 ? " selected" : ""}>Liché kalendářní týdny</option>
                <option value="0"${waste.weekParity === 0 ? " selected" : ""}>Sudé kalendářní týdny</option>
              </select>`,
            )}
            ${field("Opakovat po dnech", `<input class="${input}" type="number" name="stepDays" min="7" max="56" required value="${waste.stepDays}">`)}
          </div>
          ${field("Vysvětlení na stránce svozu", `<textarea class="${input}" name="wasteNote" rows="4" maxlength="800">${esc(waste.note)}</textarea>`)}
          ${field("Poznámka ke svátkům", `<input class="${input}" name="holidayNote" maxlength="160" value="${esc(waste.holidayNote)}">`)}
        </div>
      </section>
      ${saveBar("Uložit")}
    </form>`;
  return adminShell(ctx, data, "svoz", message, body, { title: "Popelnice" });
}
