import { blankWeek, HOME_LEAD_DAYS, hoursSummary, periodClosed, spanSummary } from "../doctors.js";
import { closureLabel, esc } from "../view.js";
import { adminShell } from "./shell.js";
import { doctorHoursFields } from "./hours.js";
import { linksButton, linksDialog } from "./hours-links.js";
import { shareButton, shareDialog } from "./hours-share.js";
import { requestDialog, requestMode, requestsPanel, waitingBadge } from "./hours-requests.js";
import {
  badge,
  callout,
  cancelLink,
  check,
  confirmForm,
  field,
  formFoot,
  hidden,
  input,
  item,
  list,
  modal,
  modalLink,
  openButton,
  pageHead,
  panel,
} from "./ui.js";

const BASE = "/redakce/lekari";
const SECTION = "lekari";

function doctorForm(editing) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${editing ? hidden("id", editing.id) : ""}
    ${callout("Jméno se na webu vypisuje přesně tak, jak ho zadáte. Věty jsou postavené tak, aby se neskloňovalo.")}
    <div class="pair">
      ${field("Jméno", `<input class="${input}" name="name" required maxlength="120" value="${esc(editing?.name ?? "")}" placeholder="MUDr. Jana Nováková">`)}
      ${field("Obor", `<input class="${input}" name="specialty" required maxlength="120" value="${esc(editing?.specialty ?? "")}" placeholder="Praktický lékař">`)}
    </div>
    <div class="pair">
      ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}">`)}
      ${field("Telefon", `<input class="${input}" name="phone" maxlength="40" value="${esc(editing?.phone ?? "")}" inputmode="tel">`)}
    </div>
    ${doctorHoursFields(editing?.week ?? blankWeek())}
    <div class="pair">
      ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? 0}">`, `Menší číslo je na stránce výš. Na titulce se ordinace ukáže jen při dočasné změně, ${HOME_LEAD_DAYS} dní předem.`)}
      <div class="field"><span>Viditelnost</span>${check("published", "1", editing ? editing.published : true, "Zveřejnit na webu")}</div>
    </div>
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

// Obor, místo a telefon. Jméno mění jen hlavní redaktor v úpravě ordinace.
export function detailsForm(doctor, opts = {}) {
  const value = opts.value ?? doctor;
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/udaje`}">
    ${hidden("doctorId", doctor.id)}${opts.extra ?? ""}
    ${field("Obor", `<input class="${input}" name="specialty" required maxlength="120" value="${esc(value.specialty ?? "")}" placeholder="Praktický lékař">`)}
    <div class="pair">
      ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(value.place ?? "")}">`)}
      ${field("Telefon", `<input class="${input}" name="phone" maxlength="40" value="${esc(value.phone ?? "")}" inputmode="tel">`)}
    </div>
    ${formFoot(opts.submit ?? "Uložit", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// `opts`: kam formulář poslat a čím předvyplnit (návrh ke schválení), jinak běžné uložení. `cancel`: kam vede Zrušit.
export function hoursForm(doctor, opts = {}) {
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/hodiny`}">
    ${hidden("doctorId", doctor.id)}${opts.extra ?? ""}
    ${doctorHoursFields(opts.value?.week ?? doctor.week)}
    ${formFoot(opts.submit ?? "Uložit hodiny", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

export function changeForm(doctor, opts = {}) {
  const value = opts.value ?? {};
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/zmena`}">
    ${hidden("doctorId", doctor.id)}${opts.extra ?? ""}
    ${callout(`Dočasná změna pro <b>${esc(doctor.name)}</b>. Na titulce se ukáže ${HOME_LEAD_DAYS} dní předem a po dobu, kdy platí. Na stránce Lékaři je vidět hned.`)}
    <div class="pair">
      ${field("Od", `<input class="control" type="date" name="startsOn" required value="${esc(value.startsOn ?? "")}">`)}
      ${field("Do", `<input class="control" type="date" name="endsOn" value="${esc(value.endsOn && value.endsOn !== value.startsOn ? value.endsOn : "")}">`, "Když jde o jeden den, nechte prázdné.")}
    </div>
    ${field("Poznámka", `<textarea class="${input}" name="changeNote" required maxlength="400" rows="2" placeholder="Třeba: sestra přítomna, zastupuje MUDr. Novák. Nebo: akutní případy ošetří ordinace v Jičíně.">${esc(value.note ?? "")}</textarea>`)}
    ${doctorHoursFields(value.week ?? blankWeek(), "Hodiny v tom období")}
    <span class="hint">Bez zaškrtnutého času je ordinace v tom období zavřená a na webu zůstane poznámka.</span>
    ${formFoot(opts.submit ?? "Zapsat změnu", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// Formulář návrhu v okně schválení.
function requestForm(doctors) {
  return (request, opts) => {
    const doctor = doctors.find((row) => row.id === request.targetId) ?? { id: request.targetId, name: "", week: [] };
    if (request.action === "udaje") return detailsForm(doctor, opts);
    return request.action === "hodiny" ? hoursForm(doctor, opts) : changeForm(doctor, opts);
  };
}

function changeChips(doctor) {
  if (!doctor.changes.length) return "";
  return `<ul class="chips-list">${doctor.changes
    .map(
      (change) => `<li class="chip-row">
        <span class="chip-when">${esc(closureLabel(change))}</span>
        <span class="chip-what">${esc(change.note)} · ${esc(periodClosed(change) ? "Zavřeno" : spanSummary(change))}</span>
        ${modalLink(`${BASE}?zrusit=${change.id}`, "Zrušit", "btn-ghost btn-danger-text")}
      </li>`,
    )
    .join("")}</ul>`;
}

export function adminDoctors(ctx, data, message, query = {}) {
  const chief = data.user?.role === "hlavni";
  const doctors = data.doctors ?? [];
  const requests = data.hoursRequests?.[SECTION] ?? [];
  const mode = requestMode(SECTION, data);
  const reviewing = requestDialog(SECTION, data, query.requestId, requestForm(doctors));
  const editing = chief ? (doctors.find((row) => row.id === query.editingId) ?? null) : null;
  const removing = chief && !editing ? (doctors.find((row) => row.id === query.confirmId) ?? null) : null;
  const hours = doctors.find((row) => row.id === query.hoursId) ?? null;
  const changing = doctors.find((row) => row.id === query.changeId) ?? null;
  const detailing = doctors.find((row) => row.id === query.detailsId) ?? null;
  let cancelling = null;
  for (const doctor of doctors) {
    const found = doctor.changes.find((change) => change.id === query.cancelId);
    if (found) cancelling = { doctor, change: found };
  }

  const rows = doctors.map((doctor) =>
    item({
      title: doctor.name,
      meta: [doctor.specialty, doctor.place, doctor.phone].filter(Boolean).map(esc).join(" · "),
      badges: `${doctor.published ? "" : badge("Skrytá", "off")}${doctor.changes.length ? badge(`Změny: ${doctor.changes.length}`, "warn") : ""}${waitingBadge(SECTION, doctor, requests)}<span class="item-sub">${esc(hoursSummary(doctor))}</span>`,
      actions: `${shareButton(BASE, doctor)}
        ${linksButton(data, SECTION, BASE, doctor)}
        ${chief ? modalLink(`${BASE}?id=${doctor.id}`, "Upravit") : modalLink(`${BASE}?hodiny=${doctor.id}`, "Hodiny")}
        ${modalLink(`${BASE}?zmena=${doctor.id}`, "Dočasná změna")}
        ${chief ? "" : modalLink(`${BASE}?udaje=${doctor.id}`, "Údaje")}
        ${chief ? modalLink(`${BASE}?smazat=${doctor.id}`, "Smazat", "btn-ghost btn-danger-text") : ""}`,
      extra: changeChips(doctor),
    }),
  );

  const dialogs = [];
  if (chief) {
    dialogs.push(
      modal({
        id: "nova-ordinace",
        title: "Nová ordinace",
        size: "wide",
        close: BASE,
        open: Boolean(query.fresh) && !editing && !removing && !hours && !changing && !detailing && !cancelling && !reviewing,
        body: doctorForm(null),
      }),
    );
  }
  const sharing = linksDialog(ctx, data, { section: SECTION, base: BASE, row: doctors.find((row) => row.id === query.linksId), what: "ordinační hodiny" });
  const preview = shareDialog(ctx, { kind: "lekar", base: BASE, row: doctors.find((row) => row.id === query.shareId) });
  if (reviewing) dialogs.push(reviewing);
  else if (sharing) dialogs.push(sharing);
  else if (preview) dialogs.push(preview);
  else if (editing) dialogs.push(modal({ id: "okno", title: "Upravit ordinaci", size: "wide", close: BASE, open: true, body: doctorForm(editing) }));
  else if (hours) dialogs.push(modal({ id: "okno", title: `Hodiny: ${hours.name}`, size: "wide", close: BASE, open: true, body: hoursForm(hours, { submit: mode.submit("Uložit hodiny") }) }));
  else if (changing) dialogs.push(modal({ id: "okno", title: "Dočasná změna", size: "wide", close: BASE, open: true, body: changeForm(changing, { submit: mode.submit("Zapsat změnu") }) }));
  else if (detailing) dialogs.push(modal({ id: "okno", title: `Údaje: ${detailing.name}`, close: BASE, open: true, body: detailsForm(detailing, { submit: mode.submit("Uložit") }) }));
  else if (cancelling) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Zrušit změnu",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/zmena/smazat`,
          id: cancelling.change.id,
          text: `Zrušit dočasnou změnu <b>${esc(cancelling.doctor.name)}</b>, ${esc(closureLabel(cancelling.change))}?${mode.asking ? " Zruší se, až to schválí hlavní redaktor." : ""}`,
          submit: mode.asking ? "Navrhnout zrušení" : "Opravdu zrušit",
          close: BASE,
        }),
      }),
    );
  } else if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat ordinaci",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Ordinace <b>${esc(removing.name)}</b> zmizí z webu i s dočasnými změnami.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  const lede = chief
    ? "Ordinace, běžné hodiny a dočasné změny. Hodiny a změny může měnit i člověk s oprávněním Lékaři."
    : `Jméno, obor a místo nastavuje hlavní redaktor. Vy tu měníte běžné hodiny a dočasné změny.${mode.note}`;
  const body = `${pageHead("Lékaři", lede, chief ? openButton("nova-ordinace", `${BASE}?novy=1`, "Nová ordinace") : "")}
    ${requestsPanel(SECTION, data)}
    ${panel({ id: "ordinace", title: "Ordinace", count: doctors.length, filter: doctors.length > 4 ? "Hledat ordinaci…" : "", body: list(rows, "Zatím žádná ordinace.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "lekari", message, body, { title: "Lékaři" });
}
