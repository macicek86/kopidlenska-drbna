// Výluky vlaků z Českých drah v redakci: stav načítání, nastavení a ruční skrytí výluky z webu.
import { formatShort } from "../format.js";
import { pragueStamp } from "../ndic/closures.js";
import { presentNotice } from "../notices.js";
import { TRACK } from "../vlaky/cd.js";
import { MAX_DAYS_AHEAD, trainNotice } from "../vlaky/store.js";
import { esc } from "../view.js";
import { badge, callout, check, field, formFoot, icon, input, item, list, panel, postButton } from "./ui.js";

const BASE = "/redakce/odstavky";

function lastLine(trains) {
  if (!trains.lastAt) return "U Českých drah se drbna zatím neptala.";
  const stamp = pragueStamp(`${trains.lastAt.replace(" ", "T")}Z`);
  return `Naposledy zkontrolováno ${formatShort(stamp.date)} v ${stamp.time}: výluk a mimořádností ${trains.lastCount}.`;
}

function statusPanel(trains) {
  return `<section class="panel status-panel">
      <div class="status-line">
        <span class="status-ico">${icon("clock")}</span>
        <div>
          <p class="status-main">${esc(lastLine(trains))}</p>
          <p class="status-sub">Trať ${esc(TRACK.code)} ${esc(TRACK.name)}, ${esc(trains.daysAhead)} dní dopředu. Kontroluje se každé 4 hodiny.</p>
        </div>
        <form method="post" action="${BASE}/vlaky/nacist"><button class="btn btn-line" type="submit" data-busy="Načítám…"${trains.enabled ? "" : " disabled"}>Zkontrolovat teď</button></form>
      </div>
      ${trains.lastError ? callout(esc(trains.lastError), "warn") : ""}
    </section>`;
}

function settingsForm(trains) {
  return `<form class="form" method="post" action="${BASE}/vlaky/nastaveni">
    ${check("enabled", "1", trains.enabled, "Hlídat výluky vlaků a ukazovat je na webu")}
    ${field("Kolik dní dopředu", `<input class="${input} control-short" type="number" name="daysAhead" min="1" max="${MAX_DAYS_AHEAD}" required value="${esc(trains.daysAhead)}">`, "Na každý den se drbna ptá zvlášť, takže víc dní znamená víc dotazů na web Českých drah.")}
    ${formFoot("Uložit")}
  </form>`;
}

function trainItem(row, trains) {
  const shown = presentNotice(trainNotice(row, trains));
  const state = row.manual === "skryt" ? badge("Skrytá", "off") : trains.enabled ? badge("Na webu", "ok") : badge("Web vypnutý", "off");
  const actions =
    row.manual === "skryt"
      ? postButton(`${BASE}/vlaky/rucne`, { trainId: row.id, manual: "" }, "Ukázat", "btn-ghost")
      : postButton(`${BASE}/vlaky/rucne`, { trainId: row.id, manual: "skryt" }, "Skrýt", "btn-ghost btn-danger-text");
  const links = [
    row.link ? `<a href="${esc(row.link)}" target="_blank" rel="noopener noreferrer">Detail na cd.cz</a>` : "",
    row.pdfUrl ? `<a href="${esc(row.pdfUrl)}" target="_blank" rel="noopener noreferrer">Výlukový jízdní řád</a>` : "",
  ].filter(Boolean);
  return item({
    title: `${shown.title}: ${row.sections.join(", ")}`,
    meta: [esc(shown.when), esc(row.measures.join(", "))].filter(Boolean).join(" · "),
    badges: state,
    actions,
    extra: `${shown.note ? `<p class="muted">${esc(shown.note)}</p>` : ""}${links.length ? `<p>${links.join(" · ")}</p>` : ""}`,
  });
}

export function trainSection(trains) {
  const rows = trains.rows ?? [];
  return `<h2 class="adm-subhead">Výluky vlaků</h2>
    ${statusPanel(trains)}
    ${panel({ id: "vlaky-nastaveni", title: "Nastavení", body: settingsForm(trains) })}
    ${panel({ id: "vlaky", title: "Výluky a mimořádnosti", count: rows.length, body: list(rows.map((row) => trainItem(row, trains)), "Na trati teď žádná výluka není.") })}`;
}
