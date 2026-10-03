// Uzavírky z Dopravního info (NDIC) v redakci: stav příjmu, okruh kolem Kopidlna, Drběna a ruční skrytí či ukázání.
import { lockHeld } from "../background.js";
import { formatShort } from "../format.js";
import { closureNotice, closureWatched, MAX_RADIUS_KM, pragueStamp } from "../ndic/closures.js";
import { NDIC_PUSH_PATH } from "../ndic/push.js";
import { MAX_ARTICLE_DAYS, MAX_ATTEMPTS } from "../ndic/store.js";
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
      ${ndic.drbena && ndic.drbenaNote ? `<p class="status-sub">Drběna: ${esc(ndic.drbenaNote)}</p>` : ""}
    </section>`;
}

function settingsForm(ndic) {
  return `<form class="form" method="post" action="${BASE}/ndic/nastaveni">
    ${check("enabled", "1", ndic.enabled, "Ukazovat uzavírky z Dopravního info na webu")}
    ${field("Okruh kolem Kopidlna (km)", `<input class="${input} control-short" type="number" name="radiusKm" min="1" max="${MAX_RADIUS_KM}" required value="${esc(ndic.radiusKm)}">`, "Na webu jsou jen uzavírky, které mají nejbližší místo do téhle vzdálenosti.")}
    ${check("drbena", "1", ndic.drbena, "Koza Drběna uzavírky přepisuje a píše k nim články", "Každou novou uzavírku v okruhu napíše lidsky. Když už stejná na drbně je (třeba od města), schová ji jako duplicitu.")}
    ${field("Článek k uzavírce od (dní)", `<input class="${input} control-short" type="number" name="articleDays" min="0" max="${MAX_ARTICLE_DAYS}" required value="${esc(ndic.articleDays)}">`, "K uzavírce, která zasahuje aspoň do tolika dní (počítá se první i poslední den, do odvolání je vždy dlouhá), napíše Drběna i článek do praktické rubriky. Jinak jen oznámení.")}
    ${check("autoPublish", "1", ndic.autoPublish, "Články rovnou na web", "Jinak čekají jako návrh ve Zprávách.")}
    ${formFoot("Uložit")}
  </form>`;
}

const DUPLICATE_OF = {
  odstavka: "stejné oznámení už je",
  zprava: "stejná zpráva už je",
  navrh: "stejný návrh zprávy už čeká",
  ndic: "stejná uzavírka z NDIC už je",
  akce: "stejná akce už je",
  munipolis: "stejné už přišlo z Munipolisu",
  denik: "stejné už přišlo z Deníku",
  skola: "stejné už přišlo z webu školy",
};

function duplicateLabel(ref) {
  const [kind, id] = String(ref).split(":");
  return DUPLICATE_OF[kind] ? `${DUPLICATE_OF[kind]} (č. ${id})` : "duplicita";
}

function drbenaBadges(row, ndic) {
  const out = [];
  if (row.status === "hotovo") out.push(badge("Přepsala Drběna", "ok"));
  else if (row.status === "duplicita") out.push(badge(`Neukazuje se: ${duplicateLabel(row.duplicateOf)}`, "warn"));
  else if (row.status === "chyba") out.push(badge(row.attempts >= MAX_ATTEMPTS ? "Drběna to vzdala" : "Drběna to zkusí znovu", "warn"));
  else if (ndic.drbena && closureWatched(row, ndic.radiusKm)) out.push(badge("Čeká na Drběnu"));
  if (row.articleId) out.push(`<a class="badge badge-ok" href="/redakce/zpravy?id=${row.articleId}">Zpráva</a>`);
  if (row.proposalId) out.push(`<a class="badge" href="/redakce/zpravy?navrh=${row.proposalId}">Návrh zprávy</a>`);
  if ((row.status === "chyba" || row.status === "duplicita") && row.reason) out.push(`<span class="muted"> ${esc(row.reason)}</span>`);
  return out.join(" ");
}

function closureItem(row, ndic) {
  const shown = presentNotice(closureNotice(row, ndic));
  const distance = row.distanceKm == null ? "bez polohy" : `${String(row.distanceKm).replace(".", ",")} km`;
  const comment = row.comments.join(" ");
  const original = comment.length > 160 ? `${comment.slice(0, 160)}…` : comment;
  let state = "";
  if (row.manual === "skryt") state = badge("Skrytá", "off");
  else if (!ndic.enabled) state = badge("Web vypnutý", "off");
  else if (shown.published) state = badge(row.manual === "ukazat" ? "Na webu (ručně)" : "Na webu", "ok");
  else if (row.status === "duplicita") state = "";
  else state = badge(row.distanceKm == null ? "Bez polohy" : "Mimo okruh", "off");
  const action = (manual, label, kind = "btn-line") => postButton(`${BASE}/ndic/rucne`, { closureId: row.id, manual }, label, kind);
  let actions = "";
  if (row.manual) actions = action("", "Vrátit automaticky", "btn-ghost");
  else if (shown.published) actions = action("skryt", "Skrýt", "btn-ghost btn-danger-text");
  else actions = action("ukazat", "Ukázat i tak");
  if (ndic.drbena && row.status !== "nove") actions += postButton(`${BASE}/ndic/znovu`, { closureId: row.id }, "Zpracovat znovu", "btn-ghost");
  const rewritten = Boolean(row.humanTitle);
  const meta = [
    esc(shown.when),
    esc(distance),
    rewritten ? esc(row.humanPlaces.join(", ")) : "",
    rewritten && row.humanNote ? esc(row.humanNote) : "",
  ].filter(Boolean);
  return item({
    title: rewritten ? row.humanTitle : row.title,
    meta: meta.join(" · "),
    badges: `${state}${drbenaBadges(row, ndic)}`,
    actions,
    extra: rewritten && original ? `<p class="muted">Původně z NDIC: ${esc(row.title)}. ${esc(original)}</p>` : original ? `<p class="muted">${esc(original)}</p>` : "",
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
      text: "Schová všechny přijaté uzavírky z Dopravního info. Hodí se před resetem odběru v portálu NDIC: ten pak pošle všechny platné uzavírky znovu a ty se vrátí i s tím, co k nim napsala Drběna. Které nepřijdou, se za týden smažou.",
      submit: "Opravdu smazat",
      close: BASE,
    }),
  });
}

export function ndicSection(ctx, ndic) {
  const closures = ndic.closures ?? [];
  const tools = closures.length ? openButton("ndic-smazat", `${BASE}?ndic-smazat=1`, "Smazat vše", "btn-ghost btn-sm") : "";
  const waiting = ndic.drbena ? closures.filter((row) => closureWatched(row, ndic.radiusKm) && (row.status === "nove" || (row.status === "chyba" && row.attempts < MAX_ATTEMPTS))).length : 0;
  // Dokud Drběna píše, stránka se sama obnovuje (public/admin.js, data-refresh).
  const busy = waiting && lockHeld(ndic.runningAt)
    ? `<div class="callout callout-info" data-refresh="8">Drběna právě píše uzavírky (čeká ${waiting}). Stránka se sama obnoví.</div>`
    : "";
  return `<h2 class="adm-subhead">Uzavírky z Dopravního info</h2>
    ${busy}
    ${statusPanel(ctx, ndic)}
    ${panel({ id: "ndic-nastaveni", title: "Nastavení", body: settingsForm(ndic) })}
    ${panel({ id: "ndic", title: "Přijaté uzavírky", count: closures.length, tools, body: list(closures.map((row) => closureItem(row, ndic)), "Žádná uzavírka v okolí.") })}`;
}
