import { byline } from "../db.js";
import { COPY, text as tx } from "../copy.js";
import { formatLong, weekdayName } from "../format.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { callout, field, icon, input, pageHead } from "./ui.js";

function saveBar(label) {
  return `<div class="save-bar"><span class="save-bar-note" data-dirty-note>Máte neuložené změny.</span><button class="btn btn-primary" type="submit">${label}</button></div>`;
}

function textField(label, value, control, long = false, hint = "") {
  return `<div class="text-field${long ? " text-field-long" : ""}" data-search="${esc(`${label} ${value}`.toLowerCase())}">${field(esc(label), control, esc(hint))}</div>`;
}

function contactField(value) {
  const label = "Kontakt na redakci";
  return textField(label, value, `<textarea class="${input}" name="contactNote" rows="3" maxlength="600" required>${esc(value)}</textarea>`, true);
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
      const extra = group.name === "O nás" ? contactField(data.contactNote) : "";
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
  const body = `${pageHead("Popelnice", "Pravidlo svozu, stejné jako na popelnice.kopidlenskadrbna.org.")}
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

export function adminPassword(ctx, data, message) {
  const shown = byline(data.user);
  const body = `${pageHead("Můj účet", `Přihlášen jako <b>${esc(data.user?.login ?? "")}</b>.`)}
    <div class="cards-2">
      <form class="panel form" method="post" action="/redakce/jmeno/ulozit">
        <header class="panel-head"><h2>Jméno a alias</h2></header>
        ${callout(`Na webu se teď ukáže: <b>${esc(shown)}</b>. Alias je dobrovolný. Když ho používáte, na webu se u vašich zpráv ukáže on. Když alias smažete, znovu se ukáže jméno.`)}
        ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" value="${esc(data.user?.name ?? "")}">`)}
        ${field("Alias", `<input class="${input}" name="alias" maxlength="60" value="${esc(data.user?.alias ?? "")}" autocomplete="nickname">`)}
        <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit jméno a alias</button></div>
      </form>
      <form class="panel form" method="post" action="/redakce/heslo/ulozit">
        <header class="panel-head"><h2>Heslo</h2></header>
        ${field("Současné heslo", `<input class="${input}" type="password" name="current" autocomplete="current-password" required>`)}
        ${field("Nové heslo", `<input class="${input}" type="password" name="next" autocomplete="new-password" minlength="8" required>`, "Aspoň 8 znaků.")}
        <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Změnit heslo</button></div>
      </form>
    </div>`;
  return adminShell(ctx, data, "heslo", message, body, { title: "Můj účet" });
}
