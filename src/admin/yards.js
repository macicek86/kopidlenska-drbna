import { hoursSummary, WEEK_DAYS } from "../yards.js";
import { closureLabel, esc } from "../view.js";
import { adminShell } from "./shell.js";
import { yardHoursFields } from "./hours.js";
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

// `opts`: kam formulář poslat a čím předvyplnit (návrh ke schválení), jinak běžné uložení.
function closureForm(yard, opts = {}) {
  const value = opts.value ?? {};
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/uzavreni`}">
    ${hidden("yardId", yard.id)}${opts.extra ?? ""}
    ${callout(`Mimořádné uzavření dvora <b>${esc(yard.name)}</b>. Na webu se ukáže i s důvodem.`)}
    <div class="pair">
      ${field("Od", `<input class="control" type="date" name="startsOn" required value="${esc(value.startsOn ?? "")}">`)}
      ${field("Do", `<input class="control" type="date" name="endsOn" value="${esc(value.endsOn && value.endsOn !== value.startsOn ? value.endsOn : "")}">`, "Když jde o jeden den, nechte prázdné.")}
    </div>
    ${field("Důvod", `<textarea class="${input}" name="reason" required maxlength="400" rows="3" placeholder="Třeba inventura nebo porucha vrat.">${esc(value.reason ?? "")}</textarea>`)}
    ${formFoot(opts.submit ?? "Zapsat uzavření", cancelLink(BASE))}
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
  const reviewing = requestDialog(SECTION, data, query.requestId, (request, opts) =>
    closureForm(yards.find((row) => row.id === request.targetId) ?? { id: request.targetId, name: "" }, opts),
  );
  const editing = chief ? (yards.find((row) => row.id === query.editingId) ?? null) : null;
  const removing = chief && !editing ? (yards.find((row) => row.id === query.confirmId) ?? null) : null;
  const closing = yards.find((row) => row.id === query.closureYardId) ?? null;
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
      actions: `${modalLink(`${BASE}?uzavreni=${yard.id}`, "Zapsat uzavření")}
        ${chief ? modalLink(`${BASE}?id=${yard.id}`, "Upravit") : ""}
        ${chief ? modalLink(`${BASE}?smazat=${yard.id}`, "Smazat", "btn-ghost btn-danger-text") : ""}`,
      extra: closureChips(yard),
    }),
  );

  const dialogs = [];
  if (chief) {
    dialogs.push(
      modal({ id: "novy-dvur", title: "Nový sběrný dvůr", size: "wide", close: BASE, open: Boolean(query.fresh) && !editing && !removing && !closing && !cancelling && !reviewing, body: yardForm(null) }),
    );
  }
  if (reviewing) dialogs.push(reviewing);
  else if (editing) dialogs.push(modal({ id: "okno", title: "Upravit sběrný dvůr", size: "wide", close: BASE, open: true, body: yardForm(editing) }));
  else if (closing) dialogs.push(modal({ id: "okno", title: "Mimořádné uzavření", close: BASE, open: true, body: closureForm(closing, { submit: mode.submit("Zapsat uzavření") }) }));
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
    : `Dvory a otevírací dobu nastavuje hlavní redaktor. Vy tu zapíšete mimořádné uzavření a důvod.${mode.note}`;
  const body = `${pageHead("Sběrné dvory", lede, chief ? openButton("novy-dvur", `${BASE}?novy=1`, "Nový dvůr") : "")}
    ${requestsPanel(SECTION, data)}
    ${panel({ id: "dvory", title: "Dvory", count: yards.length, body: list(rows, "Zatím žádný sběrný dvůr.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "dvory", message, body, { title: "Sběrné dvory" });
}
