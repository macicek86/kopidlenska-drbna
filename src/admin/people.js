import { byline, PERMISSIONS } from "../db.js";
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

// S Cloudflare Access se přihlašuje e-mailem, heslo se nezadává. Bez něj je e-mail nepovinný,
// ať se dá vyplnit dopředu, než se Access zapne.
function emailField(access, value = "") {
  return field(
    "E-mail",
    `<input class="${input}" type="email" name="email" maxlength="120" value="${esc(value)}"${access ? " required" : ""} autocapitalize="none" autocomplete="off">`,
    access ? "S tímhle e-mailem se přihlásí. Musí být i v pravidle Cloudflare Access." : "Pro přihlášení přes Cloudflare Access. Zatím nepovinný.",
  );
}

function newForm(access) {
  const loginField = field(
    "Přihlašovací jméno",
    `<input class="${input}" name="login" required minlength="3" maxlength="32" autocapitalize="none" autocomplete="off">`,
    "Malá písmena a číslice, bez mezer. Třeba jana.",
  );
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${callout("Přispěvatel píše své zprávy a může navrhnout úpravu jiných. Na web se dostanou, až je schválíte. Reklamu může navrhnout každý přihlášený.")}
    <div class="pair">
      ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" autocomplete="off">`)}
      ${field("Alias", `<input class="${input}" name="alias" maxlength="60" autocomplete="off">`, "Nepovinný. Na webu se ukáže místo jména.")}
    </div>
    ${
      access
        ? emailField(access)
        : `<div class="pair">${loginField}${field("Heslo", `<input class="${input}" type="password" name="password" required minlength="8" autocomplete="new-password">`, "Aspoň 8 znaků.")}</div>
    ${emailField(access)}`
    }
    ${permissionBoxes([])}
    ${formFoot("Přidat přispěvatele", cancelLink(BASE))}
  </form>`;
}

function accessForm(person, access) {
  return `<form class="form" method="post" action="${BASE}/udaje">
    ${hidden("id", person.id)}
    ${emailField(access, person.email)}
    ${field("Alias", `<input class="${input}" name="alias" maxlength="60" value="${esc(person.alias)}" autocomplete="off">`, "Když je vyplněný, na webu se ukáže místo jména pod článkem. Prázdné pole znamená, že zůstane jméno.")}
    ${permissionBoxes(person.permissions)}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function passwordForm(person) {
  return `<form class="form" method="post" action="${BASE}/heslo">
    ${hidden("id", person.id)}
    ${callout(`Nové heslo pro <b>${esc(person.name)}</b> (${esc(person.login)}). Řekněte mu ho osobně.`)}
    ${field("Nové heslo", `<input class="${input}" type="password" name="next" minlength="8" required autocomplete="new-password">`, "Aspoň 8 znaků.")}
    ${formFoot("Nastavit heslo", cancelLink(BASE))}
  </form>`;
}

function disableForm(person) {
  return `<form class="form confirm" method="post" action="${BASE}/stav">
    ${hidden("id", person.id)}
    <input type="hidden" name="active" value="0">
    <p class="confirm-text"><b>${esc(person.name)}</b> se nepřihlásí, dokud účet zase nezapnete. Jeho zprávy na webu zůstanou.</p>
    <div class="form-foot">${cancelLink(BASE, "Nechat")}<span class="form-foot-gap"></span><button class="btn btn-danger" type="submit">Opravdu vypnout</button></div>
  </form>`;
}

export function adminPeople(ctx, data, message, query = {}) {
  const people = data.users ?? [];
  const access = Boolean(data.access);
  const find = (id) => people.find((row) => row.id === id && row.role !== "hlavni") ?? null;
  const disabling = find(query.disableId);
  const editing = find(query.accessId);
  const resetting = access ? null : find(query.passwordId);
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
         ${access ? "" : modalLink(`${BASE}?heslo=${person.id}`, "Heslo", "btn-ghost")}
         ${
           person.active
             ? modalLink(`${BASE}?vypnout=${person.id}`, "Vypnout", "btn-ghost btn-danger-text")
             : postButton(`${BASE}/stav`, { id: person.id, active: "1" }, "Zapnout", "btn-ghost")
         }`;
    return item({
      title: person.name,
      meta: `${esc(access ? person.email || "bez e-mailu" : [person.login, person.email].filter(Boolean).join(" · "))} · na webu: ${esc(byline(person))}`,
      badges,
      actions,
      tone: person.active ? "" : "off",
    });
  });
  const dialogs = [
    modal({ id: "novy-clovek", title: "Nový přispěvatel", close: BASE, open: Boolean(query.fresh) && !disabling && !editing && !resetting, body: newForm(access) }),
  ];
  if (editing) dialogs.push(modal({ id: "okno", title: `Upravit: ${editing.name}`, close: BASE, open: true, body: accessForm(editing, access) }));
  else if (resetting) dialogs.push(modal({ id: "okno", title: "Nové heslo", close: BASE, open: true, body: passwordForm(resetting) }));
  else if (disabling) dialogs.push(modal({ id: "okno", title: "Vypnout účet", close: BASE, open: true, body: disableForm(disabling) }));

  const body = `${pageHead("Lidé", "Kdo smí do redakce. Hlavní redaktor je jeden, přispěvatelů může být víc.", openButton("novy-clovek", `${BASE}?novy=1`, "Nový přispěvatel"))}
    ${panel({ id: "lide", title: "Účty", count: people.length, body: list(rows, "Zatím tu nikdo není.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "lide", message, body, { title: "Lidé" });
}
