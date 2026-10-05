// Redakce: odkazy pro správce u míst, ordinací a sběrných dvorů (src/hours-links-db.js). Jen hlavní redaktor.
// Okno `?odkazy=ID` ukáže odkazy řádku s adresou ke zkopírování, jde v něm založit nový, upravit a zrušit.
import { formatLong } from "../format.js";
import { linkPath } from "../hours-links-db.js";
import { esc } from "../view.js";
import { badge, callout, check, field, formFoot, hidden, input, modal, modalLink, postButton } from "./ui.js";

function linksOf(data, section, row) {
  return (data.hoursLinks?.[section] ?? []).filter((link) => link.targetId === row.id);
}

export function linksButton(data, section, base, row) {
  if (data.user?.role !== "hlavni") return "";
  const count = linksOf(data, section, row).length;
  return modalLink(`${base}?odkazy=${row.id}`, count ? `Odkaz pro správce (${count})` : "Odkaz pro správce", "btn-ghost");
}

function used(link) {
  if (!link.lastUsedAt) return "zatím nepoužitý";
  return `naposledy ${formatLong(link.lastUsedAt.slice(0, 10))}`;
}

function linkRow(link, { base, origin, row }) {
  const url = `${origin}${linkPath(link.token)}`;
  const fieldId = `odkaz-${link.id}`;
  return `<li class="link-row">
    <p class="link-head"><b>${esc(link.label || "Bez popisu")}</b> ${link.direct ? badge("Zapisuje rovnou", "warn") : badge("Ke schválení")} <span class="item-sub">${esc(used(link))}</span></p>
    <div class="link-copy">
      <input class="${input}" id="${fieldId}" value="${esc(url)}" readonly aria-label="Adresa odkazu">
      <button class="btn btn-line btn-sm" type="button" data-copy-field="${fieldId}">Kopírovat</button>
    </div>
    <form class="form link-edit" method="post" action="${base}/odkaz/ulozit">
      ${hidden("odkaz", link.id)}${hidden("cil", row.id)}
      <div class="pair">
        ${field("Pro koho", `<input class="${input}" name="label" maxlength="80" value="${esc(link.label)}">`)}
        <div class="field"><span>Změny</span>${check("direct", "1", link.direct, "Zapisovat rovnou bez schválení")}</div>
      </div>
      <button class="btn btn-line btn-sm" type="submit">Uložit</button>
    </form>
    <div class="link-tools">${postButton(`${base}/odkaz/smazat`, { odkaz: link.id, cil: row.id }, "Zrušit odkaz", "btn-ghost btn-danger-text")}</div>
  </li>`;
}

export function linksDialog(ctx, data, { section, base, row, what }) {
  if (data.user?.role !== "hlavni" || !row) return "";
  const links = linksOf(data, section, row);
  const origin = ctx.mainOrigin ?? "";
  const list = links.length ? `<ul class="link-list">${links.map((link) => linkRow(link, { base, origin, row })).join("")}</ul>` : "";
  const fresh = `<form class="form" method="post" action="${base}/odkaz/novy">
    ${hidden("cil", row.id)}
    <h3 class="form-title">${links.length ? "Další odkaz" : "Nový odkaz"}</h3>
    <div class="pair">
      ${field("Pro koho", `<input class="${input}" name="label" maxlength="80" placeholder="Třeba: paní Nováková, recepce">`, "Uvidíte to u změn, které z odkazu přijdou.")}
      <div class="field"><span>Změny</span>${check("direct", "1", false, "Zapisovat rovnou bez schválení", "Bez fajfky půjde každá změna nejdřív k vám.")}</div>
    </div>
    ${formFoot("Vytvořit odkaz")}
  </form>`;
  return modal({
    id: "okno",
    title: `Odkaz pro správce: ${row.name}`,
    size: "wide",
    close: base,
    open: true,
    body: `${callout(`Kdo má odkaz, zapíše ${esc(what)} bez přihlašování: dočasnou změnu nebo zavření, novou dobu, adresu a telefon. Odkaz funguje jen pro <b>${esc(row.name)}</b>. Když se dostane k někomu cizímu, zrušte ho a pošlete nový.`)}
      ${list}
      ${fresh}`,
  });
}
