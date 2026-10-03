// Uzavírky z Dopravního info (NDIC) v redakci: stav příjmu, okruh kolem Kopidlna a ruční skrytí či ukázání.
import { formatShort } from "../format.js";
import { closureNotice, MAX_RADIUS_KM, pragueStamp } from "../ndic/closures.js";
import { NDIC_PUSH_PATH } from "../ndic/push.js";
import { presentNotice } from "../notices.js";
import { esc } from "../view.js";
import { badge, callout, check, confirmForm, field, formFoot, icon, input, item, list, modal, openButton, panel, postButton } from "./ui.js";

const BASE = "/redakce/odstavky";

function lastLine(ndic) {
  if (!ndic.lastAt) return "Od NDIC zatím nic nepřišlo.";
  const stamp = pragueStamp(`${ndic.lastAt.replace(" ", "T")}Z`);
  return `Poslední zpráva od NDIC ${formatShort(stamp.date)} v ${stamp.time}: situací ${ndic.lastSituations}, z okolí ${ndic.lastKept}.`;
}

function statusPanel(ctx, ndic) {
  const address = `${ctx.origin}${NDIC_PUSH_PATH}`;
  const setup = ndic.ready
    ? `<p class="status-sub">Adresa pro odběr v portálu NDIC: <code>${esc(address)}</code></p>`
    : "";
  return `<section class="panel status-panel">
      <div class="status-line">
        <span class="status-ico">${icon("clock")}</span>
        <div>
          <p class="status-main">${esc(lastLine(ndic))}</p>
          ${setup}
        </div>
      </div>
      ${ndic.ready ? "" : callout("Příjem je vypnutý. Zapnou ho tajemství <code>NDIC_PUSH_USER</code> a <code>NDIC_PUSH_PASSWORD</code> (stejné jméno a heslo se zadá u odběru v portálu NDIC).", "warn")}
      ${ndic.lastError ? callout(esc(ndic.lastError), "warn") : ""}
    </section>`;
}

function settingsForm(ndic) {
  return `<form class="form" method="post" action="${BASE}/ndic/nastaveni">
    ${check("enabled", "1", ndic.enabled, "Ukazovat uzavírky z Dopravního info na webu")}
    ${field("Okruh kolem Kopidlna (km)", `<input class="${input} control-short" type="number" name="radiusKm" min="1" max="${MAX_RADIUS_KM}" required value="${esc(ndic.radiusKm)}">`, "Na webu jsou jen uzavírky, které mají nejbližší místo do téhle vzdálenosti.")}
    ${formFoot("Uložit")}
  </form>`;
}

function closureItem(row, ndic) {
  const shown = presentNotice(closureNotice(row, ndic));
  const distance = row.distanceKm == null ? "bez polohy" : `${String(row.distanceKm).replace(".", ",")} km`;
  const comment = row.comments.join(" ");
  let state = "";
  if (row.manual === "skryt") state = badge("Skrytá", "off");
  else if (!ndic.enabled) state = badge("Web vypnutý", "off");
  else if (shown.published) state = badge(row.manual === "ukazat" ? "Na webu (ručně)" : "Na webu", "ok");
  else state = badge(row.distanceKm == null ? "Bez polohy" : "Mimo okruh", "off");
  const action = (manual, label, kind = "btn-line") => postButton(`${BASE}/ndic/rucne`, { closureId: row.id, manual }, label, kind);
  let actions = "";
  if (row.manual) actions = action("", "Vrátit automaticky", "btn-ghost");
  else if (shown.published) actions = action("skryt", "Skrýt", "btn-ghost btn-danger-text");
  else actions = action("ukazat", "Ukázat i tak");
  return item({
    title: row.title,
    meta: `${esc(shown.when)} · ${esc(distance)}${comment ? ` · ${esc(comment.length > 160 ? `${comment.slice(0, 160)}…` : comment)}` : ""}`,
    badges: state,
    actions,
  });
}

export function ndicDialogs(query) {
  return modal({
    id: "ndic-smazat",
    title: "Smazat uzavírky z NDIC",
    close: BASE,
    open: Boolean(query.ndicClear),
    body: confirmForm({
      action: `${BASE}/ndic/smazat`,
      id: 0,
      text: "Smaže všechny přijaté uzavírky z Dopravního info. Hodí se před resetem odběru v portálu NDIC: ten pak pošle všechny platné uzavírky znovu. Ručně skryté a ukázané se zapomenou.",
      submit: "Opravdu smazat",
      close: BASE,
    }),
  });
}

export function ndicSection(ctx, ndic) {
  const closures = ndic.closures ?? [];
  const tools = closures.length ? openButton("ndic-smazat", `${BASE}?ndic-smazat=1`, "Smazat vše", "btn-ghost btn-sm") : "";
  return `<h2 class="adm-subhead">Uzavírky z Dopravního info</h2>
    ${statusPanel(ctx, ndic)}
    ${panel({ id: "ndic-nastaveni", title: "Nastavení", body: settingsForm(ndic) })}
    ${panel({ id: "ndic", title: "Přijaté uzavírky", count: closures.length, tools, body: list(closures.map((row) => closureItem(row, ndic)), "Žádná uzavírka v okolí.") })}`;
}
