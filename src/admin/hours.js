import { blankWeek } from "../doctors.js";
import { dayLabel, esc } from "../view.js";

function timePair(prefix, day, part, label) {
  return `<input class="control control-time" type="time" name="${prefix}from-${day}" value="${esc(part.from)}" aria-label="${esc(label)} od">
    <span class="wg-dash">–</span>
    <input class="control control-time" type="time" name="${prefix}to-${day}" value="${esc(part.to)}" aria-label="${esc(label)} do">`;
}

// Otevírací doba sběrného dvora: jeden úsek za den.
export function yardHoursFields(week) {
  const rows = week
    .map((slot) => {
      const name = dayLabel(slot.day);
      return `<div class="wg-row${slot.open ? "" : " is-off"}" data-slot>
        <label class="wg-day"><input type="checkbox" name="open-${slot.day}" value="1"${slot.open ? " checked" : ""} data-slot-toggle> <span>${esc(name)}</span></label>
        <div class="wg-slot">${timePair("", slot.day, slot, name)}</div>
      </div>`;
    })
    .join("");
  return `<fieldset class="field week-grid" data-week>
    <legend>Otevřeno ve dnech</legend>
    ${rows}
    <div class="wg-tools"><button class="btn btn-sm btn-ghost" type="button" data-copy-week>Pondělí zkopírovat do všech zaškrtnutých dnů</button></div>
    <span class="hint">Den bez fajfky je zavřený.</span>
  </fieldset>`;
}

function doctorSlot(prefix, day, part, label, placeholder) {
  return `<div class="wg-slot${part.open ? "" : " is-off"}" data-slot>
    <label class="wg-half"><input type="checkbox" name="${prefix}-open-${day}" value="1"${part.open ? " checked" : ""} data-slot-toggle aria-label="${esc(label)}"> <span>${esc(label.split(" ").pop())}</span></label>
    ${timePair(`${prefix}-`, day, part, label)}
    <input class="control wg-note" type="text" name="${prefix}-note-${day}" maxlength="160" value="${esc(part.note)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}, poznámka">
  </div>`;
}

// Ordinační hodiny: dopoledne a odpoledne zvlášť, ať mezi nimi může být polední pauza.
export function doctorHoursFields(week, legend = "Ordinační hodiny") {
  const days = week?.length ? week : blankWeek();
  const rows = days
    .map((slot) => {
      const name = dayLabel(slot.day);
      return `<div class="wg-row wg-row-2">
        <span class="wg-day"><span>${esc(name)}</span></span>
        ${doctorSlot("am", slot.day, slot.morning, `${name} dopoledne`, "Poznámka, třeba jen objednaní")}
        ${doctorSlot("pm", slot.day, slot.afternoon, `${name} odpoledne`, "Poznámka, třeba jen akutní")}
      </div>`;
    })
    .join("");
  return `<fieldset class="field week-grid week-grid-2" data-week>
    <legend>${esc(legend)}</legend>
    ${rows}
    <div class="wg-tools"><button class="btn btn-sm btn-ghost" type="button" data-copy-week>Pondělí zkopírovat do všech zaškrtnutých dnů</button></div>
    <span class="hint">Dopoledne a odpoledne se zaškrtávají zvlášť. Půlka bez fajfky v ten den není.</span>
  </fieldset>`;
}
