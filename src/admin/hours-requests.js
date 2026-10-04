// Redakce: návrhy změn ke schválení u sběrných dvorů, lékařů a otevírací doby.
// Žadatel je vidí v panelu Moje návrhy, hlavní redaktor v panelu Ke schválení a v okně `?zadost=ID` je schválí
// (formulář je předvyplněný návrhem a jde upravit), nebo zamítne s důvodem.
import { hoursSummary, periodClosed, spanSummary } from "../doctors.js";
import { formatLong } from "../format.js";
import { hoursMode, REQUEST_SECTIONS } from "../hours-requests-db.js";
import { placeSummary } from "../places.js";
import { closureLabel, esc } from "../view.js";
import { badge, callout, cancelLink, field, hidden, input, item, list, modal, modalLink, panel, postButton } from "./ui.js";

const BASES = { dvory: "/redakce/dvory", lekari: "/redakce/lekari", "oteviraci-doba": "/redakce/oteviraci-doba" };
const ROWS = { dvory: "yards", lekari: "doctors", "oteviraci-doba": "places" };
const CHANGES = { dvory: "closures", lekari: "changes", "oteviraci-doba": "changes" };

function changeHours(change) {
  return periodClosed(change) ? "Zavřeno" : spanSummary(change);
}

// Komu nebo čemu návrh patří a co se má stát, jako text.
export function describeRequest(section, request, data) {
  const rows = data[ROWS[section]] ?? [];
  const value = request.value;
  if (request.action === "zrusit") {
    for (const row of rows) {
      const change = row[CHANGES[section]].find((entry) => entry.id === request.targetId);
      if (!change) continue;
      const what = section === "dvory" ? change.reason : [change.kind === "trvala" ? "nová otevírací doba" : "", change.note].filter(Boolean).join(", ");
      return { name: row.name, text: `Zrušit ${section === "dvory" ? "uzavření" : "změnu"} ${closureLabel(change)}${what ? `: ${what}` : ""}` };
    }
    return { name: "Už není", text: "Zrušit změnu, která už není zapsaná" };
  }
  const name = rows.find((row) => row.id === request.targetId)?.name ?? "Už není";
  if (section === "dvory") return { name, text: `Uzavření ${closureLabel(value)}: ${value.reason}` };
  if (request.action === "hodiny") {
    return { name, text: section === "lekari" ? `Ordinační hodiny: ${hoursSummary(value)}` : `Oprava otevírací doby: ${placeSummary(value)}` };
  }
  if (value.kind === "trvala") {
    return { name, text: [`Nová otevírací doba od ${formatLong(value.startsOn)}`, value.note, placeSummary(value)].filter(Boolean).join(" · ") };
  }
  return { name, text: `Dočasná změna ${closureLabel(value)}: ${value.note} · ${changeHours(value)}` };
}

// Kolik návrhů čeká u řádku (dvora, ordinace, místa); zrušení se počítá k řádku, kam změna patří.
export function waitingFor(section, row, requests) {
  const changeIds = new Set(row[CHANGES[section]].map((change) => change.id));
  return requests.filter((request) => request.status === "pending" && (request.action === "zrusit" ? changeIds.has(request.targetId) : request.targetId === row.id)).length;
}

export function waitingBadge(section, row, requests) {
  const count = waitingFor(section, row, requests);
  return count ? badge(count === 1 ? "Návrh čeká" : `Návrhy čekají: ${count}`, "warn") : "";
}

export function requestItems(section, data, chief) {
  const base = BASES[section];
  return (data.hoursRequests?.[section] ?? []).map((request) => {
    const { name, text } = describeRequest(section, request, data);
    if (chief) {
      return item({
        title: name,
        meta: `${esc(text)} · navrhuje ${esc(request.author || "přispěvatel")}`,
        badges: badge(REQUEST_SECTIONS[section].label),
        actions: modalLink(`${base}?zadost=${request.id}`, "Posoudit", "btn-primary"),
      });
    }
    const rejected = request.status === "rejected";
    return item({
      title: name,
      meta: esc(text),
      badges: `${rejected ? badge("Zamítnuto", "bad") : badge("Čeká na schválení", "warn")}${rejected && request.reply ? `<span class="item-sub">${esc(request.reply)}</span>` : ""}`,
      actions: postButton(`${base}/zadost/stahnout`, { zadost: request.id }, rejected ? "Smazat" : "Stáhnout", "btn-ghost btn-danger-text"),
    });
  });
}

export function requestsPanel(section, data) {
  const chief = data.user?.role === "hlavni";
  const rows = requestItems(section, data, chief);
  if (!rows.length) return "";
  return panel({ id: "navrhy", title: chief ? "Ke schválení" : "Moje návrhy", count: rows.length, body: list(rows, ""), tone: chief ? "warn" : "" });
}

// Co na stránce sekce říct a jak popsat tlačítka podle oprávnění.
export function requestMode(section, data) {
  const asking = hoursMode(data.user, section) === "request";
  return { asking, submit: (label) => (asking ? "Poslat ke schválení" : label), note: asking ? " Změny posíláte ke schválení hlavnímu redaktorovi." : "" };
}

// Okno hlavního redaktora. `form(opts)` vykreslí formulář sekce předvyplněný návrhem; zrušení formulář nemá.
export function requestDialog(section, data, id, form) {
  const base = BASES[section];
  const request = data.user?.role === "hlavni" ? (data.hoursRequests?.[section] ?? []).find((entry) => entry.id === id) : null;
  if (!request) return "";
  const { name, text } = describeRequest(section, request, data);
  const approveFields = { action: `${base}/zadost/schvalit`, submit: "Schválit a zapsat", extra: hidden("zadost", request.id), value: request.value };
  const approve =
    request.action === "zrusit"
      ? `<div class="form-foot"><span class="form-foot-gap"></span>${postButton(`${base}/zadost/schvalit`, { zadost: request.id }, "Schválit zrušení", "btn-primary")}</div>`
      : form(request, approveFields);
  const reject = `<form class="form" method="post" action="${base}/zadost/zamitnout">
    ${hidden("zadost", request.id)}
    ${field("Proč ne", `<textarea class="${input}" name="reply" maxlength="400" rows="2" placeholder="Nemusí být. Uvidí to ${esc(request.author || "přispěvatel")}."></textarea>`)}
    <div class="form-foot">${cancelLink(base, "Nechat na později")}<span class="form-foot-gap"></span><button class="btn btn-danger" type="submit">Zamítnout</button></div>
  </form>`;
  return modal({
    id: "okno",
    title: `Návrh: ${name}`,
    size: request.action === "zrusit" ? "" : "wide",
    close: base,
    open: true,
    body: `${callout(`<b>${esc(request.author || "Přispěvatel")}</b> navrhuje: ${esc(text)}.${request.action === "zrusit" ? "" : " Před schválením to můžete upravit."}`, "warn")}
      ${approve}
      <hr class="form-split">
      ${reject}`,
  });
}
