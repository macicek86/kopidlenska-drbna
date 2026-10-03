import { HOME_LEAD_DAYS } from "../outages.js";
import { esc, outageCard, outageEmpty } from "../view.js";
import { adminShell } from "./shell.js";
import { noticeDialogs, noticePanels } from "./notices.js";
import { callout, cancelLink, check, confirmForm, field, formFoot, icon, input, modal, modalLink, openButton, pageHead, panel } from "./ui.js";

const BASE = "/redakce/odstavky";

function addForm() {
  return `<form class="form" method="post" action="${BASE}/pridat">
    ${callout("Kód obce je šest číslic z registru obcí. Části Kopidlna, tedy Drahoraz, Mlýnec, Pševes a Ledkov, patří pod kód 573060.")}
    <div class="pair">
      ${field("Název", `<input class="${input}" name="name" required maxlength="80" placeholder="Třeba Jičíněves">`)}
      ${field("Kód obce", `<input class="${input}" name="code" required inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="573060" autocomplete="off">`)}
    </div>
    ${field("Pořadí", `<input class="${input} control-short" type="number" name="sortOrder" min="0" max="999" value="100">`, "Menší číslo je na stránce výš.")}
    ${check("enabled", "1", true, "Hledat v téhle obci")}
    ${formFoot("Přidat obec", cancelLink(BASE))}
  </form>`;
}

export function adminOutages(ctx, data, message, query = {}) {
  const areas = data.outageAreas ?? [];
  const board = data.outages ?? { items: [], areas: [], checked: "", note: "" };
  const confirming = areas.find((area) => area.id === query.confirmId) ?? null;
  const rows = areas
    .map(
      (area) => `<tr>
        <td><input type="hidden" name="areaId" value="${area.id}"><input class="${input}" name="areaName" required maxlength="80" value="${esc(area.name)}" aria-label="Název"></td>
        <td><input class="${input} control-code" name="areaCode" required inputmode="numeric" maxlength="6" pattern="[0-9]{6}" value="${esc(area.code)}" autocomplete="off" aria-label="Kód obce"></td>
        <td><input class="${input} control-short" type="number" name="areaSort" min="0" max="999" required value="${esc(area.sortOrder)}" aria-label="Pořadí"></td>
        <td class="cell-center"><label class="switch"><input type="checkbox" name="areaOn" value="${area.id}"${area.enabled ? " checked" : ""}><span class="sr-only">Hledat v obci ${esc(area.name)}</span></label></td>
        <td class="cell-end">${modalLink(`${BASE}?smazat=${area.id}`, "Smazat", "btn-ghost btn-danger-text")}</td>
      </tr>`,
    )
    .join("");
  const table = areas.length
    ? `<form method="post" action="${BASE}/ulozit" data-dirty>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Název</th><th>Kód obce</th><th>Pořadí</th><th class="cell-center">Hledat</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="form-foot"><span class="save-bar-note" data-dirty-note>Máte neuložené změny.</span><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit obce</button></div>
      </form>`
    : `<p class="empty">Zatím se nehlídá žádná obec.</p>`;
  const watched = board.areas.map((area) => area.name).join(", ");
  const preview = board.items.length
    ? `<div class="outage-preview">${board.items.map((row) => outageCard(row, { showArea: board.areas.length > 1, copy: ctx.copy })).join("")}</div>`
    : `<p class="empty">${esc(outageEmpty(board, ctx.copy))}</p>`;

  const notices = noticeDialogs(data.notices ?? [], query);
  const dialogs = [
    modal({ id: "nova-obec", title: "Další obec", close: BASE, open: Boolean(query.fresh) && !confirming && !notices.busy, body: addForm() }),
    notices.html,
  ];
  if (confirming && !notices.busy) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat obec",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: confirming.id,
          text: `Smazat obec ${esc(confirming.name)} (${esc(confirming.code)})? Odstávky se tam přestanou hledat.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }

  const body = `${pageHead(
    "Odstávky a uzavírky",
    `Vodu a uzavírky zapisuje redakce nebo je připraví Koza Drběna ze zpráv města. Elektřinu se drbna párkrát denně ptá veřejného widgetu ČEZ Distribuce. Na titulce se odstávka nebo uzavírka ukáže, když právě probíhá nebo začíná do ${HOME_LEAD_DAYS} dní.`,
    `${openButton("nova-obec", `${BASE}?novy=1`, "Přidat obec", "btn-line")}${openButton("nove-oznameni", `${BASE}?nove-oznameni=1`, "Odstávka vody")}${openButton("nova-uzavirka", `${BASE}?nova-uzavirka=1`, "Uzavírka")}`,
  )}
    ${noticePanels(data.notices ?? [])}
    <h2 class="adm-subhead">Elektřina</h2>
    <section class="panel status-panel">
      <div class="status-line">
        <span class="status-ico">${icon("clock")}</span>
        <div>
          <p class="status-main">${esc(board.checked || "Ještě se nenačítalo.")}</p>
          ${watched ? `<p class="status-sub">Na webu se hledá v: ${esc(watched)}.</p>` : ""}
        </div>
        <form method="post" action="${BASE}/nacist"><button class="btn btn-line" type="submit" data-busy="Načítám…">Načíst teď</button></form>
      </div>
      ${board.note ? callout(esc(board.note), "warn") : ""}
    </section>
    ${panel({ id: "obce", title: "Hlídané obce", count: areas.length, body: table })}
    ${panel({ id: "nahled", title: "Jak to vypadá na webu", count: board.items.length, body: preview })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "odstavky", message, body, { title: "Odstávky a uzavírky" });
}
