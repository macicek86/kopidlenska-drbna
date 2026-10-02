// Redakce: Otevírací doba. Místa zakládá hlavní redaktor, hodiny a změny mění i člověk s oprávněním Otevírací doba.
import { blankWeek, periodClosed, spanSummary } from "../doctors.js";
import { formatLong } from "../format.js";
import { HOME_LEAD_DAYS, NEW_HOURS_DAYS, placeSummary } from "../places.js";
import { closureLabel, esc } from "../view.js";
import { pragueNow } from "../waste.js";
import { adminShell } from "./shell.js";
import { doctorHoursFields } from "./hours.js";
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

const BASE = "/redakce/oteviraci-doba";

function placeForm(editing) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${editing ? hidden("id", editing.id) : ""}
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
    <div class="pair">
      ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" required value="${editing?.sortOrder ?? 0}">`, "Menší číslo je na stránce výš.")}
      <div class="field"><span>Viditelnost</span>${check("published", "1", editing ? editing.published : true, "Zveřejnit na webu")}</div>
    </div>
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function hoursForm(place) {
  return `<form class="form" method="post" action="${BASE}/hodiny">
    ${hidden("placeId", place.id)}
    ${callout("Oprava běžné otevírací doby, třeba překlep. Titulka o ní nic neřekne. Když se doba opravdu mění, použijte Nová otevírací doba.")}
    ${doctorHoursFields(place.week, "Otevírací doba")}
    ${formFoot("Uložit dobu", cancelLink(BASE))}
  </form>`;
}

function changeForm(place) {
  return `<form class="form" method="post" action="${BASE}/zmena">
    ${hidden("placeId", place.id)}
    ${hidden("kind", "docasna")}
    ${callout(`Dočasná změna nebo zavření: <b>${esc(place.name)}</b>. Na titulce se ukáže ${HOME_LEAD_DAYS} dní předem a po dobu, kdy platí.`)}
    <div class="pair">
      ${field("Od", `<input class="control" type="date" name="startsOn" required>`)}
      ${field("Do", `<input class="control" type="date" name="endsOn">`, "Když jde o jeden den, nechte prázdné.")}
    </div>
    ${field("Poznámka", `<textarea class="${input}" name="changeNote" required maxlength="400" rows="2" placeholder="Třeba: školení k volbám. Nebo: dovolená."></textarea>`)}
    ${doctorHoursFields(blankWeek(), "Otevřeno v tom období")}
    <span class="hint">Bez zaškrtnutého času má místo v tom období zavřeno.</span>
    ${formFoot("Zapsat změnu", cancelLink(BASE))}
  </form>`;
}

function newHoursForm(place) {
  return `<form class="form" method="post" action="${BASE}/zmena">
    ${hidden("placeId", place.id)}
    ${hidden("kind", "trvala")}
    ${callout(`Nová otevírací doba pro <b>${esc(place.name)}</b>, která platí natrvalo. V den, kdy začne, nahradí běžnou dobu. Titulka na ni upozorní ${NEW_HOURS_DAYS} dní předem a ${NEW_HOURS_DAYS} dní potom.`)}
    ${field("Platí od", `<input class="control" type="date" name="startsOn" required value="${esc(pragueNow().date)}">`)}
    ${field("Poznámka", `<textarea class="${input}" name="changeNote" maxlength="400" rows="2" placeholder="Nemusí být. Třeba: v pátek nově i odpoledne."></textarea>`)}
    ${doctorHoursFields(place.week, "Nová otevírací doba")}
    ${formFoot("Zapsat novou dobu", cancelLink(BASE))}
  </form>`;
}

function changeText(change) {
  if (change.kind === "trvala") return `${change.applied ? "Platí" : "Začne"} od ${formatLong(change.startsOn)}`;
  return closureLabel(change);
}

function changeChips(place) {
  if (!place.changes.length) return "";
  return `<ul class="chips-list">${place.changes
    .map((change) => {
      const hours = change.kind === "trvala" ? placeSummary(change) : periodClosed(change) ? "Zavřeno" : spanSummary(change);
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
  const editing = chief ? (places.find((row) => row.id === query.editingId) ?? null) : null;
  const removing = chief && !editing ? (places.find((row) => row.id === query.confirmId) ?? null) : null;
  const hours = places.find((row) => row.id === query.hoursId) ?? null;
  const changing = places.find((row) => row.id === query.changeId) ?? null;
  const renewing = places.find((row) => row.id === query.newHoursId) ?? null;
  let cancelling = null;
  for (const place of places) {
    const found = place.changes.find((change) => change.id === query.cancelId);
    if (found) cancelling = { place, change: found };
  }

  const rows = places.map((place) =>
    item({
      title: place.name,
      meta: [place.label, place.place, place.phone].filter(Boolean).map(esc).join(" · "),
      badges: `${place.published ? "" : badge("Skryté", "off")}${place.changes.length ? badge(`Změny: ${place.changes.length}`, "warn") : ""}<span class="item-sub">${esc(placeSummary(place))}</span>`,
      actions: `${chief ? modalLink(`${BASE}?id=${place.id}`, "Upravit") : modalLink(`${BASE}?hodiny=${place.id}`, "Opravit dobu")}
        ${modalLink(`${BASE}?zmena=${place.id}`, "Dočasná změna")}
        ${modalLink(`${BASE}?nova-doba=${place.id}`, "Nová doba")}
        ${chief ? modalLink(`${BASE}?smazat=${place.id}`, "Smazat", "btn-ghost btn-danger-text") : ""}`,
      extra: changeChips(place),
      search: `${place.name} ${place.label}`,
    }),
  );

  const dialogs = [];
  const anyOpen = editing || removing || hours || changing || renewing || cancelling;
  if (chief) {
    dialogs.push(
      modal({ id: "nove-misto", title: "Nové místo", size: "wide", close: BASE, open: Boolean(query.fresh) && !anyOpen, body: placeForm(null) }),
    );
  }
  if (editing) dialogs.push(modal({ id: "okno", title: "Upravit místo", size: "wide", close: BASE, open: true, body: placeForm(editing) }));
  else if (hours) dialogs.push(modal({ id: "okno", title: `Otevírací doba: ${hours.name}`, size: "wide", close: BASE, open: true, body: hoursForm(hours) }));
  else if (changing) dialogs.push(modal({ id: "okno", title: "Dočasná změna", size: "wide", close: BASE, open: true, body: changeForm(changing) }));
  else if (renewing) dialogs.push(modal({ id: "okno", title: "Nová otevírací doba", size: "wide", close: BASE, open: true, body: newHoursForm(renewing) }));
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
          text: `Zrušit změnu <b>${esc(cancelling.place.name)}</b>, ${esc(changeText(cancelling.change))}?`,
          submit: "Opravdu zrušit",
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
    ? "Úřad, knihovna, KVC a další místa. Zavření a dočasné změny ze zpráv města zapisuje i Koza Drběna."
    : "Místa zakládá hlavní redaktor. Vy tu měníte otevírací dobu, dočasné změny a novou dobu.";
  const body = `${pageHead("Otevírací doba", lede, chief ? openButton("nove-misto", `${BASE}?novy=1`, "Nové místo") : "")}
    ${panel({ id: "mista", title: "Místa", count: places.length, filter: places.length > 4 ? "Hledat místo…" : "", body: list(rows, "Zatím žádné místo.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "oteviraci-doba", message, body, { title: "Otevírací doba" });
}
