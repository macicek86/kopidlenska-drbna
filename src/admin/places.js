// Redakce: Otevírací doba. Místa zakládá hlavní redaktor, hodiny a změny mění i člověk s oprávněním Otevírací doba,
// s oprávněním „ke schválení“ je posílá hlavnímu redaktorovi (src/admin/hours-requests.js).
import { blankWeek, periodClosed, spanSummary } from "../doctors.js";
import { formatLong } from "../format.js";
import { compactWeek } from "../hours-compact.js";
import { HOME_LEAD_DAYS, NEW_HOURS_DAYS, PLACE_MISSING } from "../places.js";
import { closureLabel, esc } from "../view.js";
import { pragueNow } from "../waste.js";
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
  icon,
  input,
  item,
  list,
  modal,
  modalLink,
  moreMenu,
  openButton,
  pageHead,
  panel,
} from "./ui.js";

const BASE = "/redakce/oteviraci-doba";
const SECTION = "oteviraci-doba";

// `opts`: kam formulář poslat (`action`), skrytá pole navíc (`extra`), text tlačítka (`submit`) a kam vede Zrušit (`cancel`).
export function placeForm(editing, opts = {}) {
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/ulozit`}">
    ${editing?.id ? hidden("id", editing.id) : ""}${opts.extra ?? ""}
    ${callout("Název se na webu vypisuje přesně tak, jak ho zadáte, a věty jsou postavené tak, aby se neskloňoval. Třeba „Knihovna má 2. 10. zavřeno.“")}
    <div class="pair">
      ${field("Název", `<input class="${input}" name="name" required maxlength="120" value="${esc(editing?.name ?? "")}" placeholder="Knihovna">`)}
      ${field("Popisek", `<input class="${input}" name="label" maxlength="120" value="${esc(editing?.label ?? "")}" placeholder="Městská knihovna">`, "Malý nadpis nad názvem. Nemusí být.")}
    </div>
    <div class="pair">
      ${field("Adresa", `<input class="${input}" name="place" maxlength="160" value="${esc(editing?.place ?? "")}">`)}
      ${field("Telefon", `<input class="${input}" name="phone" maxlength="40" value="${esc(editing?.phone ?? "")}" inputmode="tel">`)}
    </div>
    ${doctorHoursFields(editing?.week ?? blankWeek(), "Otevírací doba")}
    ${offersField(editing?.offers ?? [])}
    <div class="pair">
      ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? 0}">`, "Menší číslo je na stránce výš. Rychleji to jde šipkami u míst.")}
      <div class="field"><span>Viditelnost</span>${check("published", "1", editing ? editing.published : true, "Zveřejnit na webu")}</div>
    </div>
    ${formFoot(opts.submit ?? "Uložit", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

function offersField(offers) {
  return field(
    "Co tu najdete",
    `<textarea class="${input}" name="offers" rows="6" placeholder="Czech POINT&#10;Ověřování podpisů a listin&#10;Vydání občanského průkazu">${esc(offers.join("\n"))}</textarea>`,
    "Jedna věc na řádek. Nemusí být. Na webu je to v okně u místa a ví o tom i Drběna v chatu.",
  );
}

export function offersForm(place, opts = {}) {
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/nabidka`}">
    ${hidden("placeId", place.id)}${opts.extra ?? ""}
    ${offersField(opts.value?.offers ?? place.offers ?? [])}
    ${formFoot(opts.submit ?? "Uložit", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// Popisek, adresa a telefon. Název mění jen hlavní redaktor v úpravě místa.
export function detailsForm(place, opts = {}) {
  const value = opts.value ?? place;
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/udaje`}">
    ${hidden("placeId", place.id)}${opts.extra ?? ""}
    ${field("Popisek", `<input class="${input}" name="label" maxlength="120" value="${esc(value.label ?? "")}" placeholder="Městská knihovna">`, "Malý nadpis nad názvem. Nemusí být.")}
    <div class="pair">
      ${field("Adresa", `<input class="${input}" name="place" maxlength="160" value="${esc(value.place ?? "")}">`)}
      ${field("Telefon", `<input class="${input}" name="phone" maxlength="40" value="${esc(value.phone ?? "")}" inputmode="tel">`)}
    </div>
    ${formFoot(opts.submit ?? "Uložit", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// `opts`: kam formulář poslat a čím předvyplnit (návrh ke schválení), jinak běžné uložení. `cancel`: kam vede Zrušit.
export function hoursForm(place, opts = {}) {
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/hodiny`}">
    ${hidden("placeId", place.id)}${opts.extra ?? ""}
    ${callout("Oprava běžné otevírací doby, třeba překlep. Titulka o ní nic neřekne. Když se doba opravdu mění, použijte Nová otevírací doba.")}
    ${doctorHoursFields(opts.value?.week ?? place.week, "Otevírací doba")}
    ${formFoot(opts.submit ?? "Uložit dobu", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

export function changeForm(place, opts = {}) {
  const value = opts.value ?? {};
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/zmena`}">
    ${hidden("placeId", place.id)}${opts.extra ?? ""}
    ${hidden("kind", "docasna")}
    ${callout(`Dočasná změna nebo zavření: <b>${esc(place.name)}</b>. Na titulce se ukáže ${HOME_LEAD_DAYS} dní předem a po dobu, kdy platí.`)}
    <div class="pair">
      ${field("Od", `<input class="control" type="date" name="startsOn" required value="${esc(value.startsOn ?? "")}">`)}
      ${field("Do", `<input class="control" type="date" name="endsOn" value="${esc(value.endsOn && value.endsOn !== value.startsOn ? value.endsOn : "")}">`, "Když jde o jeden den, nechte prázdné.")}
    </div>
    ${field("Poznámka", `<textarea class="${input}" name="changeNote" required maxlength="400" rows="2" placeholder="Třeba: školení k volbám. Nebo: dovolená.">${esc(value.note ?? "")}</textarea>`)}
    ${doctorHoursFields(value.week ?? blankWeek(), "Otevřeno v tom období")}
    <span class="hint">Bez zaškrtnutého času má místo v tom období zavřeno.</span>
    ${formFoot(opts.submit ?? "Zapsat změnu", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

export function newHoursForm(place, opts = {}) {
  const value = opts.value ?? {};
  return `<form class="form" method="post" action="${opts.action ?? `${BASE}/zmena`}">
    ${hidden("placeId", place.id)}${opts.extra ?? ""}
    ${hidden("kind", "trvala")}
    ${callout(`Nová otevírací doba pro <b>${esc(place.name)}</b>, která platí natrvalo. V den, kdy začne, nahradí běžnou dobu. Titulka na ni upozorní ${NEW_HOURS_DAYS} dní předem a ${NEW_HOURS_DAYS} dní potom.`)}
    ${field("Platí od", `<input class="control" type="date" name="startsOn" required value="${esc(value.startsOn ?? pragueNow().date)}">`)}
    ${field("Poznámka", `<textarea class="${input}" name="changeNote" maxlength="400" rows="2" placeholder="Nemusí být. Třeba: v pátek nově i odpoledne.">${esc(value.note ?? "")}</textarea>`)}
    ${doctorHoursFields(value.week ?? place.week, "Nová otevírací doba")}
    ${formFoot(opts.submit ?? "Zapsat novou dobu", cancelLink(opts.cancel ?? BASE))}
  </form>`;
}

// Šipky pro pořadí na webu (jen hlavní redaktor). Fungují i bez JS, po uložení se stránka vrátí k místu.
function moveButtons(place, index, count) {
  const button = (direction, label, disabled) =>
    `<form class="inline-form" method="post" action="${BASE}/posunout">${hidden("id", place.id)}${hidden("direction", direction)}
      <button class="btn btn-ghost btn-sm btn-move" type="submit" aria-label="${label}" title="${label}"${disabled ? " disabled" : ""}>${icon(direction)}</button>
    </form>`;
  return `${button("up", "Posunout výš", index === 0)}${button("down", "Posunout níž", index === count - 1)}`;
}

// Formulář návrhu v okně schválení.
function requestForm(places) {
  return (request, opts) => {
    const place = places.find((row) => row.id === request.targetId) ?? { id: request.targetId, name: "", week: [] };
    if (request.action === "hodiny") return hoursForm(place, opts);
    if (request.action === "nabidka") return offersForm(place, opts);
    if (request.action === "udaje") return detailsForm(place, opts);
    return request.value.kind === "trvala" ? newHoursForm(place, opts) : changeForm(place, opts);
  };
}

function changeText(change) {
  if (change.kind === "trvala") return `${change.applied ? "Platí" : "Začne"} od ${formatLong(change.startsOn)}`;
  return closureLabel(change);
}

function changeChips(place) {
  if (!place.changes.length) return "";
  return `<ul class="chips-list">${place.changes
    .map((change) => {
      const hours = change.kind === "trvala" ? compactWeek(change.week) || PLACE_MISSING : periodClosed(change) ? "Zavřeno" : spanSummary(change);
      const what = [change.kind === "trvala" ? "Nová otevírací doba" : "", change.note, hours].filter(Boolean).join(" · ");
      const source = change.sourceUrl ? ` · <a href="${esc(change.sourceUrl)}" target="_blank" rel="noopener noreferrer">zdroj</a>` : "";
      return `<li class="chip-row">
        <span class="chip-when">${esc(changeText(change))}</span>
        <span class="chip-what">${esc(what)}${source}</span>
        ${change.kind === "trvala" && change.applied ? "" : modalLink(`${BASE}?zrusit=${change.id}`, "Zrušit", "btn-ghost btn-danger-text")}
      </li>`;
    })
    .join("")}</ul>`;
}

export function adminPlaces(ctx, data, message, query = {}) {
  const chief = data.user?.role === "hlavni";
  const places = data.places ?? [];
  const requests = data.hoursRequests?.[SECTION] ?? [];
  const mode = requestMode(SECTION, data);
  const editing = chief ? (places.find((row) => row.id === query.editingId) ?? null) : null;
  const removing = chief && !editing ? (places.find((row) => row.id === query.confirmId) ?? null) : null;
  const hours = places.find((row) => row.id === query.hoursId) ?? null;
  const changing = places.find((row) => row.id === query.changeId) ?? null;
  const renewing = places.find((row) => row.id === query.newHoursId) ?? null;
  const offering = places.find((row) => row.id === query.offersId) ?? null;
  const detailing = places.find((row) => row.id === query.detailsId) ?? null;
  let cancelling = null;
  for (const place of places) {
    const found = place.changes.find((change) => change.id === query.cancelId);
    if (found) cancelling = { place, change: found };
  }

  const rows = places.map((place, index) =>
    item({
      id: `misto-${place.id}`,
      title: place.name,
      meta: [place.label, place.place, place.phone].filter(Boolean).map(esc).join(" · "),
      badges: `${place.published ? "" : badge("Skryté", "off")}${place.offers?.length ? badge(`Co tu najdete: ${place.offers.length}`) : ""}${place.changes.length ? badge(`Změny: ${place.changes.length}`, "warn") : ""}${waitingBadge(SECTION, place, requests)}<span class="item-sub">${esc(compactWeek(place.week) || PLACE_MISSING)}</span>`,
      tools: chief ? moveButtons(place, index, places.length) : "",
      grid: true,
      actions: `${modalLink(`${BASE}?zmena=${place.id}`, "Dočasná změna")}
        ${modalLink(`${BASE}?nova-doba=${place.id}`, "Nová doba")}
        ${chief ? modalLink(`${BASE}?id=${place.id}`, "Upravit") : modalLink(`${BASE}?hodiny=${place.id}`, "Opravit dobu")}
        ${moreMenu([
          shareButton(BASE, place),
          linksButton(data, SECTION, BASE, place),
          chief ? "" : modalLink(`${BASE}?nabidka=${place.id}`, "Co tu najdete"),
          chief ? "" : modalLink(`${BASE}?udaje=${place.id}`, "Adresa a telefon"),
          chief ? modalLink(`${BASE}?smazat=${place.id}`, "Smazat", "btn-ghost btn-danger-text") : "",
        ])}`,
      extra: changeChips(place),
      search: `${place.name} ${place.label}`,
    }),
  );

  const dialogs = [];
  const reviewing = requestDialog(SECTION, data, query.requestId, requestForm(places));
  const anyOpen = editing || removing || hours || changing || renewing || offering || detailing || cancelling || reviewing;
  if (chief) {
    dialogs.push(
      modal({ id: "nove-misto", title: "Nové místo", size: "wide", close: BASE, open: Boolean(query.fresh) && !anyOpen, body: placeForm(null) }),
    );
  }
  const sharing = linksDialog(ctx, data, { section: SECTION, base: BASE, row: places.find((row) => row.id === query.linksId), what: "otevírací dobu" });
  const preview = shareDialog(ctx, { kind: "misto", base: BASE, row: places.find((row) => row.id === query.shareId) });
  if (reviewing) dialogs.push(reviewing);
  else if (sharing) dialogs.push(sharing);
  else if (preview) dialogs.push(preview);
  else if (editing) dialogs.push(modal({ id: "okno", title: "Upravit místo", size: "wide", close: BASE, open: true, body: placeForm(editing) }));
  else if (hours) dialogs.push(modal({ id: "okno", title: `Otevírací doba: ${hours.name}`, size: "wide", close: BASE, open: true, body: hoursForm(hours, { submit: mode.submit("Uložit dobu") }) }));
  else if (changing) dialogs.push(modal({ id: "okno", title: "Dočasná změna", size: "wide", close: BASE, open: true, body: changeForm(changing, { submit: mode.submit("Zapsat změnu") }) }));
  else if (renewing) dialogs.push(modal({ id: "okno", title: "Nová otevírací doba", size: "wide", close: BASE, open: true, body: newHoursForm(renewing, { submit: mode.submit("Zapsat novou dobu") }) }));
  else if (offering) dialogs.push(modal({ id: "okno", title: `Co tu najdete: ${offering.name}`, close: BASE, open: true, body: offersForm(offering, { submit: mode.submit("Uložit") }) }));
  else if (detailing) dialogs.push(modal({ id: "okno", title: `Adresa a telefon: ${detailing.name}`, close: BASE, open: true, body: detailsForm(detailing, { submit: mode.submit("Uložit") }) }));
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
          text: `Zrušit změnu <b>${esc(cancelling.place.name)}</b>, ${esc(changeText(cancelling.change))}?${mode.asking ? " Zruší se, až to schválí hlavní redaktor." : ""}`,
          submit: mode.asking ? "Navrhnout zrušení" : "Opravdu zrušit",
          close: BASE,
        }),
      }),
    );
  } else if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat místo",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `<b>${esc(removing.name)}</b> zmizí z webu i se změnami.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  const lede = chief
    ? "Úřad, knihovna, KVC a další místa v pořadí, v jakém jsou na webu (šipkami ho změníte). Zavření a dočasné změny ze zpráv města zapisuje i Koza Drběna."
    : `Místa zakládá hlavní redaktor. Vy tu měníte otevírací dobu, dočasné změny a novou dobu.${mode.note}`;
  const body = `${pageHead("Otevírací doba", lede, chief ? openButton("nove-misto", `${BASE}?novy=1`, "Nové místo") : "")}
    ${requestsPanel(SECTION, data)}
    ${panel({ id: "mista", title: "Místa", count: places.length, filter: places.length > 4 ? "Hledat místo…" : "", body: list(rows, "Zatím žádné místo.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "oteviraci-doba", message, body, { title: "Otevírací doba" });
}
