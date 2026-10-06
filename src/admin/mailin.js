// Redakce: E-mail na otevírací dobu (src/mailin/). Adresy, které smějí psát, s místy, lékaři a dvory,
// které můžou měnit, a záznam posledních přijatých e-mailů. Jen hlavní redaktor.
import { MAILIN_ADDRESS } from "../mailin/reply.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, confirmForm, field, formFoot, hidden, input, item, list, modal, modalLink, openButton, pageHead, panel } from "./ui.js";

const BASE = "/redakce/emaily";

const STATUS = {
  zapsano: ["Zapsáno", "ok"],
  ke_schvaleni: ["Ke schválení", "info"],
  nejasne: ["Nerozuměla", "warn"],
  neni_doba: ["Není o době", ""],
  neznamy: ["Neznámá adresa", ""],
  limit: ["Moc e-mailů", "warn"],
  automaticky: ["Automatická zpráva", ""],
  chyba: ["Chyba", "warn"],
};

function stamp(value) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(`${value.replace(" ", "T")}Z`));
}

function rowGroups(data) {
  return [
    ["oteviraci-doba", "Otevírací doba", data.places ?? []],
    ["lekari", "Lékaři", data.doctors ?? []],
    ["dvory", "Sběrné dvory", data.yards ?? []],
  ];
}

function targetNames(data, sender) {
  const names = [];
  for (const [section, , rows] of rowGroups(data)) {
    for (const target of sender.targets.filter((row) => row.section === section)) {
      const row = rows.find((candidate) => candidate.id === target.targetId);
      if (row) names.push(row.name);
    }
  }
  return names;
}

function senderForm(data, editing) {
  const on = new Set((editing?.targets ?? []).map((target) => `${target.section}:${target.targetId}`));
  const groups = rowGroups(data)
    .filter(([, , rows]) => rows.length)
    .map(
      ([section, title, rows]) => `<fieldset class="checks"><legend>${esc(title)}</legend>${rows
        .map((row) => check("radek", `${section}:${row.id}`, on.has(`${section}:${row.id}`), esc(row.name)))
        .join("")}</fieldset>`,
    )
    .join("");
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${editing ? hidden("id", editing.id) : ""}
    <div class="pair">
      ${field("E-mail", `<input class="${input}" type="email" name="email" required maxlength="160" value="${esc(editing?.email ?? "")}" placeholder="knihovna@kopidlno.cz">`, "Přesně ta adresa, ze které budou psát.")}
      ${field("Kdo to je", `<input class="${input}" name="label" maxlength="80" value="${esc(editing?.label ?? "")}" placeholder="Třeba: knihovna, paní Nováková">`, "Uvidíte to u změn v historii a u žádostí.")}
    </div>
    <div class="field"><span>Změny</span>${check("direct", "1", editing ? editing.direct : true, "Zapisovat rovnou bez schválení", "Bez fajfky půjde každá změna nejdřív k vám. Rovnou se zapíše jen e-mail, který prošel ověřením odesílatele.")}</div>
    ${groups || callout("Zatím tu nejsou žádná místa, lékaři ani sběrné dvory.")}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function senderItem(data, sender) {
  const names = targetNames(data, sender);
  return item({
    title: sender.label || sender.email,
    meta: [sender.label ? esc(sender.email) : "", names.length ? esc(names.join(", ")) : "žádné místo"].filter(Boolean).join(" · "),
    badges: sender.direct ? badge("Zapisuje rovnou", "warn") : badge("Ke schválení"),
    actions: `${modalLink(`${BASE}?id=${sender.id}`, "Upravit")}${modalLink(`${BASE}?smazat=${sender.id}`, "Smazat", "btn-ghost btn-danger-text")}`,
    search: `${sender.email} ${sender.label} ${names.join(" ")}`,
  });
}

function logItem(row) {
  const [label, tone] = STATUS[row.status] ?? [row.status, ""];
  const text = [row.excerpt && `<p class="message-text">${esc(row.excerpt).replace(/\n/g, "<br>")}</p>`, row.result && `<p class="item-sub"><b>Drběna:</b> ${esc(row.result).replace(/\n/g, "<br>")}</p>`, row.auth && `<details class="item-sub"><summary>Ověření odesílatele</summary><p>${esc(row.auth).replace(/\n/g, "<br>")}</p></details>`]
    .filter(Boolean)
    .join("");
  return item({
    title: row.subject || "(bez předmětu)",
    meta: [esc(stamp(row.createdAt)), esc(row.email), row.verified ? "odesílatel ověřený" : "odesílatel neověřený"].join(" · "),
    badges: badge(label, tone),
    extra: text,
    search: `${row.subject} ${row.email} ${row.excerpt}`,
  });
}

export function adminMailin(ctx, data, message, query = {}) {
  const senders = data.mailin?.senders ?? [];
  const log = data.mailin?.log ?? [];
  const editing = senders.find((row) => row.id === query.editingId) ?? null;
  const removing = editing ? null : (senders.find((row) => row.id === query.confirmId) ?? null);
  const dialogs = [modal({ id: "nova-adresa", title: "Nová adresa", size: "wide", close: BASE, open: Boolean(query.fresh) && !editing && !removing, body: senderForm(data, null) })];
  if (editing) dialogs.push(modal({ id: "okno", title: `Upravit: ${editing.label || editing.email}`, size: "wide", close: BASE, open: true, body: senderForm(data, editing) }));
  if (removing) {
    dialogs.push(
      modal({
        id: "okno",
        title: "Smazat adresu",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Smazat <b>${esc(removing.email)}</b>? E-maily z ní se už nezapíšou, Drběna odepíše, že adresu nezná.`,
          submit: "Opravdu smazat",
          close: BASE,
        }),
      }),
    );
  }
  const lede = `Správci míst můžou poslat změnu otevírací doby e-mailem na <b>${esc(MAILIN_ADDRESS)}</b>, třeba „15. 8. KVC zavřeno“. Drběna ji přečte, zapíše a odepíše, co zapsala. Píšou jen adresy ze seznamu a jen u míst, která jim zaškrtnete.`;
  const body = `${pageHead("E-mail na otevírací dobu", lede, openButton("nova-adresa", `${BASE}?novy=1`, "Nová adresa"))}
    ${panel({ id: "adresy", title: "Kdo smí psát", count: senders.length, filter: senders.length > 6 ? "Hledat adresu" : "", body: list(senders.map((row) => senderItem(data, row)), "Zatím žádná adresa. E-mailům z neznámých adres Drběna jen odepíše, kam psát.") })}
    ${panel({ id: "posta", title: "Poslední e-maily", count: log.length, body: list(log.map(logItem), "Zatím nepřišel žádný e-mail.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "emaily", message, body, { title: "E-mail na otevírací dobu" });
}
