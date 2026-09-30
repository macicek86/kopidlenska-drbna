import { formatLong } from "../format.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import {
  badge,
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

const BASE = "/redakce/akce";

function eventForm(editing) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${editing ? hidden("id", editing.id) : ""}
    ${field("Název", `<input class="${input} control-lg" name="title" required maxlength="160" value="${esc(editing?.title ?? "")}">`)}
    ${field("Místo", `<input class="${input}" name="place" required maxlength="160" value="${esc(editing?.place ?? "")}" placeholder="Třeba sokolovna">`)}
    <div class="pair">
      ${field("Datum", `<input class="${input}" type="date" name="startsOn" required value="${esc(editing?.startsOn ?? "")}">`)}
      ${field("Čas", `<input class="${input}" type="time" name="startsTime" value="${esc(editing?.startsTime ?? "")}">`, "Nepovinný.")}
    </div>
    ${field("Popis", `<textarea class="${input}" name="description" maxlength="4000" rows="5">${esc(editing?.description ?? "")}</textarea>`)}
    ${check("published", "1", editing ? editing.published : true, "Zveřejnit na webu")}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function dateBox(isoDate) {
  const [year, month, day] = String(isoDate ?? "").split("-");
  if (!day) return "";
  return `<span class="date-box" aria-hidden="true"><b>${Number(day)}</b><small>${Number(month)}/${String(year).slice(2)}</small></span>`;
}

export function adminEvents(ctx, data, message, query = {}) {
  const today = data.waste?.today ?? "";
  const editing = data.events.find((row) => row.id === query.editingId) ?? null;
  const removing = editing ? null : (data.events.find((row) => row.id === query.confirmId) ?? null);
  const toItem = (row) =>
    item({
      title: row.title,
      meta: `${dateBox(row.startsOn)}${esc(formatLong(row.startsOn))}${row.startsTime ? ` v ${esc(row.startsTime)}` : ""} · ${esc(row.place)}`,
      search: `${row.title} ${row.place} ${formatLong(row.startsOn)}`,
      badges: row.published ? "" : badge("Skrytá", "off"),
      actions: `${modalLink(`${BASE}?id=${row.id}`, "Upravit")}${modalLink(`${BASE}?smazat=${row.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
    });
  const upcoming = data.events.filter((row) => !today || row.startsOn >= today);
  const past = data.events.filter((row) => today && row.startsOn < today).reverse();

  const dialogs = [
    modal({ id: "nova-akce", title: "Nová akce", close: BASE, open: Boolean(query.fresh) && !editing && !removing, body: eventForm(null) }),
  ];
  if (editing) dialogs.push(modal({ id: "okno", title: "Upravit akci", close: BASE, open: true, body: eventForm(editing) }));
  if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat akci",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Akce <b>${esc(removing.title)}</b> zmizí z webu.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  const body = `${pageHead("Akce", "Pozvánky v kalendáři na webu. Proběhlé akce se samy přesunou dolů.", openButton("nova-akce", `${BASE}?novy=1`, "Nová akce"))}
    ${panel({ id: "chystane", title: "Chystané", count: upcoming.length, filter: "Hledat v akcích…", body: list(upcoming.map(toItem), "Nic se nechystá. Přidejte první pozvánku.") })}
    ${past.length ? panel({ id: "probehle", title: "Proběhlé", count: past.length, body: list(past.map(toItem), ""), tone: "quiet" }) : ""}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "akce", message, body, { title: "Akce" });
}
