import { hoursSummary, WEEK_DAYS } from "../yards.js";
import { closureLabel, esc } from "../view.js";
import { adminShell } from "./shell.js";
import { yardHoursFields } from "./hours.js";
import { linksButton, linksDialog } from "./hours-links.js";
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

const BASE = "/redakce/dvory";
const SECTION = "dvory";

function yardForm(editing) {
  const week = editing?.week ?? WEEK_DAYS.map(({ day }) => ({ day, open: false, from: "08:00", to: "16:00" }));
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${editing ? hidden("id", editing.id) : ""}
    <div class="form-cols">
      <div class="form-col-main">
        <div class="pair">
          ${field("Název", `<input class="${input}" name="name" required maxlength="120" value="${esc(editing?.name ?? "")}">`)}
          ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}">`)}
        </div>
        ${field("Co se tam vozí", `<textarea class="${input}" name="accepts" required maxlength="1200" rows="5">${esc(editing?.accepts ?? "")}</textarea>`)}
        <div class="pair">
          ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? 0}">`, "Menší číslo je na stránce výš.")}
          <div class="field"><span>Viditelnost</span>${check("published", "1", editing ? editing.published : true, "Zveřejnit na webu")}</div>
        </div>
      </div>
      <div class="form-col-side form-col-wide">${yardHoursFields(week)}</div>
    </div>
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

// Běžná otevírací doba. `opts`: kam formulář poslat a čím předvyplnit, `cancel`: kam vede Zrušit.
export function hoursForm(yard, opts = {}) {
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/hodiny`}">
    ${hidden("yardId", yard.id)}${opts.extra ?? ""}
    ${yardHoursFields(opts.value?.week ?? yard.week)}
    ${formFoot(opts.submit ?? "Uložit dobu", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// Místo a co se tam vozí. Název mění jen hlavní redaktor v úpravě dvora.
export function detailsForm(yard, opts = {}) {
  const value = opts.value ?? yard;
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/udaje`}">
    ${hidden("yardId", yard.id)}${opts.extra ?? ""}
    ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(value.place ?? "")}">`)}
    ${field("Co se tam vozí", `<textarea class="${input}" name="accepts" required maxlength="1200" rows="5">${esc(value.accepts ?? "")}</textarea>`)}
    ${formFoot(opts.submit ?? "Uložit", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// `opts`: kam formulář poslat a čím předvyplnit (návrh ke schválení), jinak běžné uložení.
export function closureForm(yard, opts = {}) {
  const value = opts.value ?? {};
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/uzavreni`}">
    ${hidden("yardId", yard.id)}${opts.extra ?? ""}
    ${callout(`Mimořádné uzavření dvora <b>${esc(yard.name)}</b>. Na webu se ukáže i s důvodem.`)}
    <div class="pair">
      ${field("Od", `<input class="control" type="date" name="startsOn" required value="${esc(value.startsOn ?? "")}">`)}
      ${field("Do", `<input class="control" type="date" name="endsOn" value="${esc(value.endsOn && value.endsOn !== value.startsOn ? value.endsOn : "")}">`, "Když jde o jeden den, nechte prázdné.")}
    </div>
    ${field("Důvod", `<textarea class="${input}" name="reason" required maxlength="400" rows="3" placeholder="Třeba inventura nebo porucha vrat.">${esc(value.reason ?? "")}</textarea>`)}
    ${formFoot(opts.submit ?? "Zapsat uzavření", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

function closureChips(yard) {
  if (!yard.closures.length) return "";
  return `<ul class="chips-list">${yard.closures
    .map(
      (closure) => `<li class="chip-row">
        <span class="chip-when">${esc(closureLabel(closure))}</span>
        <span class="chip-what">${esc(closure.reason)}</span>
        ${modalLink(`${BASE}?zrusit=${closure.id}`, "Zrušit", "btn-ghost btn-danger-text")}
      </li>`,
    )
    .join("")}</ul>`;
}

export function adminYards(ctx, data, message, query = {}) {
  const chief = data.user?.role === "hlavni";
  const yards = data.yards ?? [];
  const requests = data.hoursRequests?.[SECTION] ?? [];
  const mode = requestMode(SECTION, data);
  const reviewing = requestDialog(SECTION, data, query.requestId, (request, opts) => {
    const yard = yards.find((row) => row.id === request.targetId) ?? { id: request.targetId, name: "", week: [] };
    if (request.action === "hodiny") return hoursForm(yard, opts);
    if (request.action === "udaje") return detailsForm(yard, opts);
    return closureForm(yard, opts);
  });
  const editing = chief ? (yards.find((row) => row.id === query.editingId) ?? null) : null;
  const removing = chief && !editing ? (yards.find((row) => row.id === query.confirmId) ?? null) : null;
  const closing = yards.find((row) => row.id === query.closureYardId) ?? null;
  const hours = chief ? null : (yards.find((row) => row.id === query.hoursId) ?? null);
  const detailing = chief ? null : (yards.find((row) => row.id === query.detailsId) ?? null);
  let cancelling = null;
  for (const yard of yards) {
    const found = yard.closures.find((closure) => closure.id === query.cancelId);
    if (found) cancelling = { yard, closure: found };
  }

  const rows = yards.map((yard) =>
    item({
      title: yard.name,
      meta: `${esc(yard.place)} · ${esc(hoursSummary(yard))}`,
      badges: `${yard.published ? "" : badge("Skrytý", "off")}${yard.closures.length ? badge(`Uzavření: ${yard.closures.length}`, "warn") : ""}${waitingBadge(SECTION, yard, requests)}`,
      actions: `${linksButton(data, SECTION, BASE, yard)}
        ${modalLink(`${BASE}?uzavreni=${yard.id}`, "Zapsat uzavření")}
        ${chief ? modalLink(`${BASE}?id=${yard.id}`, "Upravit") : `${modalLink(`${BASE}?hodiny=${yard.id}`, "Otevírací doba")}${modalLink(`${BASE}?udaje=${yard.id}`, "Údaje")}`}
        ${chief ? modalLink(`${BASE}?smazat=${yard.id}`, "Smazat", "btn-ghost btn-danger-text") : ""}`,
      extra: closureChips(yard),
    }),
  );

  const dialogs = [];
  if (chief) {
    dialogs.push(
      modal({ id: "novy-dvur", title: "Nový sběrný dvůr", size: "wide", close: BASE, open: Boolean(query.fresh) && !editing && !removing && !closing && !hours && !detailing && !cancelling && !reviewing, body: yardForm(null) }),
    );
  }
  const sharing = linksDialog(ctx, data, { section: SECTION, base: BASE, row: yards.find((row) => row.id === query.linksId), what: "otevírací dobu a uzavření" });
  if (reviewing) dialogs.push(reviewing);
  else if (sharing) dialogs.push(sharing);
  else if (editing) dialogs.push(modal({ id: "okno", title: "Upravit sběrný dvůr", size: "wide", close: BASE, open: true, body: yardForm(editing) }));
  else if (closing) dialogs.push(modal({ id: "okno", title: "Mimořádné uzavření", close: BASE, open: true, body: closureForm(closing, { submit: mode.submit("Zapsat uzavření") }) }));
  else if (hours) dialogs.push(modal({ id: "okno", title: `Otevírací doba: ${hours.name}`, size: "wide", close: BASE, open: true, body: hoursForm(hours, { submit: mode.submit("Uložit dobu") }) }));
  else if (detailing) dialogs.push(modal({ id: "okno", title: `Údaje: ${detailing.name}`, close: BASE, open: true, body: detailsForm(detailing, { submit: mode.submit("Uložit") }) }));
  else if (cancelling) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Zrušit uzavření",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/uzavreni/smazat`,
          id: cancelling.closure.id,
          text: `Zrušit uzavření <b>${esc(cancelling.yard.name)}</b>, ${esc(closureLabel(cancelling.closure))}?${mode.asking ? " Zruší se, až to schválí hlavní redaktor." : " Na webu dvůr zase ukáže běžnou otevírací dobu."}`,
          submit: mode.asking ? "Navrhnout zrušení" : "Opravdu zrušit",
          close: BASE,
        }),
      }),
    );
  } else if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat sběrný dvůr",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Dvůr <b>${esc(removing.name)}</b> zmizí z webu i se zapsanými uzavřeními.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }

  const lede = chief
    ? "Místo, co se tam vozí a kdy má otevřeno. Mimořádné uzavření zapíše i člověk s oprávněním Sběrný dvůr."
    : `Dvory zakládá hlavní redaktor. Vy tu zapíšete mimořádné uzavření, otevírací dobu a co se tam vozí.${mode.note}`;
  const body = `${pageHead("Sběrné dvory", lede, chief ? openButton("novy-dvur", `${BASE}?novy=1`, "Nový dvůr") : "")}
    ${requestsPanel(SECTION, data)}
    ${panel({ id: "dvory", title: "Dvory", count: yards.length, body: list(rows, "Zatím žádný sběrný dvůr.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "dvory", message, body, { title: "Sběrné dvory" });
}
