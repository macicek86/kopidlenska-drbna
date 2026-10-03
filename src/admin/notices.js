// Odstávky vody a uzavírky v redakci: seznam, formulář a potvrzení smazání.
import { NOTICE_KINDS, presentNotice } from "../notices.js";
import { esc } from "../view.js";
import { badge, callout, cancelLink, check, confirmForm, field, formFoot, hidden, input, item, list, modal, modalLink, panel } from "./ui.js";

const BASE = "/redakce/odstavky";

export function noticeWaiting(notice) {
  return !notice.published && Boolean(notice.sourceUrl);
}

function kindOptions(current) {
  return Object.entries(NOTICE_KINDS)
    .map(([value, kind]) => `<option value="${value}"${value === current ? " selected" : ""}>${esc(kind.label)}</option>`)
    .join("");
}

export function noticeForm(editing, freshKind = "voda") {
  const kind = editing?.kind ?? freshKind;
  return `<form class="form" method="post" action="${BASE}/oznameni">
    ${editing ? hidden("id", editing.id) : ""}
    ${editing && noticeWaiting(editing) ? callout("Tohle připravila Koza Drběna ze zprávy města. Zkontrolujte datum, čas a ulice, a pak zaškrtněte Zveřejnit.", "warn") : ""}
    <div class="pair">
      ${field("Druh", `<select class="${input}" name="kind">${kindOptions(kind)}</select>`)}
      ${field("Nadpis", `<input class="${input}" name="title" maxlength="120" value="${esc(editing?.title ?? "")}" placeholder="${esc(NOTICE_KINDS[kind].fallbackTitle)}">`)}
    </div>
    <div class="pair">
      ${field("Od", `<input class="${input}" type="date" name="startsOn" required value="${esc(editing?.startsOn ?? "")}">`)}
      ${field("Čas od", `<input class="${input}" type="time" name="startsTime" value="${esc(editing?.startsTime ?? "")}">`, "Nepovinný.")}
    </div>
    <div class="pair">
      ${field("Do", `<input class="${input}" type="date" name="endsOn" value="${esc(editing?.endsOn ?? "")}">`, "Když jde o jeden den, nechte prázdné.")}
      ${field("Čas do", `<input class="${input}" type="time" name="endsTime" value="${esc(editing?.endsTime ?? "")}">`, "Nepovinný.")}
    </div>
    ${field("Ulice a místa", `<textarea class="${input}" name="places" required rows="5" placeholder="Hilmarova&#10;Husova&#10;Polovina náměstí u COOP">${esc((editing?.places ?? []).join("\n"))}</textarea>`, "Každé na vlastní řádek.")}
    ${field("Poznámka", `<textarea class="${input}" name="note" maxlength="600" rows="2" placeholder="Třeba: cisterna s vodou projíždí ulicemi.">${esc(editing?.note ?? "")}</textarea>`)}
    ${field("Odkaz na oznámení", `<input class="${input}" type="url" name="sourceUrl" maxlength="300" value="${esc(editing?.sourceUrl ?? "")}" placeholder="https://kopidlno.munipolis.cz/…">`, "Nepovinný. Na webu se ukáže pod kartou.")}
    ${check("published", "1", editing ? editing.published : true, "Zveřejnit na webu")}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function noticeItem(notice) {
  const shown = presentNotice(notice);
  const places = notice.places.slice(0, 3).join(", ") + (notice.places.length > 3 ? " a další" : "");
  let state = "";
  if (noticeWaiting(notice)) state = badge("Čeká na schválení", "warn");
  else if (!notice.published) state = badge("Skrytá", "off");
  else if (shown.phase === "past") state = badge("Proběhlo", "off");
  else if (shown.phase === "now") state = badge(shown.state, "warn");
  return item({
    title: notice.title,
    meta: `${esc(shown.when)}${places ? ` · ${esc(places)}` : ""}`,
    badges: state,
    actions: `${modalLink(`${BASE}?oznameni=${notice.id}`, noticeWaiting(notice) ? "Zkontrolovat" : "Upravit")}${modalLink(`${BASE}?zrusit=${notice.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
  });
}

function sorted(notices) {
  const today = new Date();
  const live = notices.filter((notice) => presentNotice(notice, today).phase !== "past");
  const past = notices.filter((notice) => presentNotice(notice, today).phase === "past").reverse().slice(0, 10);
  return [...live, ...past];
}

export function noticePanels(notices) {
  const water = sorted(notices.filter((notice) => notice.kind === "voda"));
  const closures = sorted(notices.filter((notice) => notice.kind === "uzavirka"));
  return `${panel({ id: "voda", title: "Odstávky vody", count: water.length, body: list(water.map(noticeItem), "Žádná odstávka vody.") })}
    ${panel({ id: "uzavirky", title: "Uzavírky silnic", count: closures.length, body: list(closures.map(noticeItem), "Žádná uzavírka.") })}`;
}

export function noticeDialogs(notices, query) {
  const editing = notices.find((notice) => notice.id === query.noticeId) ?? null;
  const removing = editing ? null : (notices.find((notice) => notice.id === query.cancelId) ?? null);
  const dialogs = [
    modal({
      id: "nove-oznameni",
      title: "Nová odstávka vody",
      size: "wide",
      close: BASE,
      open: Boolean(query.noticeFresh) && !editing && !removing,
      body: noticeForm(null),
    }),
    modal({
      id: "nova-uzavirka",
      title: "Nová uzavírka",
      size: "wide",
      close: BASE,
      open: Boolean(query.closureFresh) && !editing && !removing,
      body: noticeForm(null, "uzavirka"),
    }),
  ];
  if (editing) {
    dialogs.push(modal({ id: "okno", title: noticeWaiting(editing) ? "Zkontrolovat oznámení" : "Upravit oznámení", size: "wide", close: BASE, open: true, body: noticeForm(editing) }));
  }
  if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat oznámení",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/oznameni/smazat`,
          id: removing.id,
          text: `Oznámení <b>${esc(removing.title)}</b> zmizí z webu i z redakce.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  return { html: dialogs.join(""), busy: Boolean(editing || removing) };
}
