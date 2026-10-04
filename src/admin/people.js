import { byline, PERMISSIONS } from "../db.js";
import { IDLE_CHOICES, MAX_DAY_CHOICES } from "../login-db.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import {
  badge,
  callout,
  cancelLink,
  check,
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
  postButton,
} from "./ui.js";

const BASE = "/redakce/lide";

function permissionBoxes(selected) {
  const have = new Set(selected ?? []);
  return `<fieldset class="field checks"><legend>Oprávnění navíc</legend>${PERMISSIONS.map((row) =>
    check("permission", row.code, have.has(row.code), esc(row.label), esc(row.detail)),
  ).join("")}</fieldset>`;
}

// Přihlašuje se kódem, který přijde na tenhle e-mail.
function emailField(value = "") {
  return field(
    "E-mail",
    `<input class="${input}" type="email" name="email" maxlength="120" value="${esc(value)}" required autocapitalize="none" autocomplete="off">`,
    "Na něj mu přijde kód pro přihlášení do redakce.",
  );
}

function newForm() {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${callout("Přispěvatel píše své zprávy a může navrhnout úpravu jiných. Na web se dostanou, až je schválíte. Reklamu může navrhnout každý přihlášený.")}
    <div class="pair">
      ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" autocomplete="off">`)}
      ${field("Alias", `<input class="${input}" name="alias" maxlength="60" autocomplete="off">`, "Nepovinný. Na webu se ukáže místo jména.")}
    </div>
    ${emailField()}
    ${permissionBoxes([])}
    ${formFoot("Přidat přispěvatele", cancelLink(BASE))}
  </form>`;
}

function accessForm(person) {
  return `<form class="form" method="post" action="${BASE}/udaje">
    ${hidden("id", person.id)}
    ${emailField(person.email)}
    ${field("Alias", `<input class="${input}" name="alias" maxlength="60" value="${esc(person.alias)}" autocomplete="off">`, "Když je vyplněný, na webu se ukáže místo jména pod článkem. Prázdné pole znamená, že zůstane jméno.")}
    ${permissionBoxes(person.permissions)}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function disableForm(person) {
  return `<form class="form confirm" method="post" action="${BASE}/stav">
    ${hidden("id", person.id)}
    <input type="hidden" name="active" value="0">
    <p class="confirm-text"><b>${esc(person.name)}</b> se odhlásí ze všech zařízení a nepřihlásí se, dokud účet zase nezapnete. Jeho zprávy na webu zůstanou.</p>
    <div class="form-foot">${cancelLink(BASE, "Nechat")}<span class="form-foot-gap"></span><button class="btn btn-danger" type="submit">Opravdu vypnout</button></div>
  </form>`;
}

function minutesLabel(minutes) {
  if (!minutes) return "Neodhlašovat";
  if (minutes < 60) return `Po ${minutes} minutách`;
  const hours = minutes / 60;
  return hours === 1 ? "Po hodině" : hours === 24 ? "Po dni" : `Po ${hours} hodinách`;
}

function daysLabel(days) {
  return days === 1 ? "1 den" : days < 5 ? `${days} dny` : `${days} dní`;
}

// Jak dlouho platí přihlášení: odhlášení po nečinnosti a nejdelší doba, pak je potřeba nový kód.
function loginSettingsPanel(settings) {
  if (!settings) return "";
  const idle = IDLE_CHOICES.map((value) => `<option value="${value}"${value === settings.idleMinutes ? " selected" : ""}>${minutesLabel(value)}</option>`).join("");
  const days = MAX_DAY_CHOICES.map((value) => `<option value="${value}"${value === settings.maxDays ? " selected" : ""}>${daysLabel(value)}</option>`).join("");
  return `<form class="panel form" method="post" action="${BASE}/prihlaseni">
    <header class="panel-head"><h2>Přihlášení</h2></header>
    ${callout("Do redakce se přihlašuje kódem z e-mailu. Kdo nic nedělá, toho redakce po nastavené době odhlásí, třeba když zapomene odejít od cizího počítače. Nejpozději po nejdelší době chce nový kód každý.")}
    <div class="pair">
      ${field("Odhlásit po nečinnosti", `<select class="${input}" name="idle_minutes">${idle}</select>`)}
      ${field("Nejdelší přihlášení", `<select class="${input}" name="max_days">${days}</select>`)}
    </div>
    ${formFoot("Uložit")}
  </form>`;
}

export function adminPeople(ctx, data, message, query = {}) {
  const people = data.users ?? [];
  const find = (id) => people.find((row) => row.id === id && row.role !== "hlavni") ?? null;
  const disabling = find(query.disableId);
  const editing = find(query.accessId);
  const rows = people.map((person) => {
    const extras = PERMISSIONS.filter((row) => person.permissions?.includes(row.code));
    const chief = person.role === "hlavni";
    const badges = [
      chief ? badge("Hlavní redaktor", "brand") : badge("Přispěvatel"),
      ...extras.map((row) => badge(row.label, "info")),
      person.active ? "" : badge("Vypnutý", "off"),
    ].join("");
    const actions = chief
      ? ""
      : `${modalLink(`${BASE}?upravit=${person.id}`, "Upravit")}
         ${
           person.active
             ? modalLink(`${BASE}?vypnout=${person.id}`, "Vypnout", "btn-ghost btn-danger-text")
             : postButton(`${BASE}/stav`, { id: person.id, active: "1" }, "Zapnout", "btn-ghost")
         }`;
    return item({
      title: person.name,
      meta: `${esc(person.email || "bez e-mailu, nepřihlásí se")} · na webu: ${esc(byline(person))}`,
      badges,
      actions,
      tone: person.active ? "" : "off",
    });
  });
  const dialogs = [
    modal({ id: "novy-clovek", title: "Nový přispěvatel", close: BASE, open: Boolean(query.fresh) && !disabling && !editing, body: newForm() }),
  ];
  if (editing) dialogs.push(modal({ id: "okno", title: `Upravit: ${editing.name}`, close: BASE, open: true, body: accessForm(editing) }));
  else if (disabling) dialogs.push(modal({ id: "okno", title: "Vypnout účet", close: BASE, open: true, body: disableForm(disabling) }));

  const body = `${pageHead("Lidé", "Kdo smí do redakce. Hlavní redaktor je jeden, přispěvatelů může být víc.", openButton("novy-clovek", `${BASE}?novy=1`, "Nový přispěvatel"))}
    ${panel({ id: "lide", title: "Účty", count: people.length, body: list(rows, "Zatím tu nikdo není.") })}
    ${loginSettingsPanel(data.loginSettings)}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "lide", message, body, { title: "Lidé" });
}
