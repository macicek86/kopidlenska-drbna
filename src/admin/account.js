// Můj účet: jméno pod článkem, alias, e-mail pro přihlášení a přihlášená zařízení.
import { byline } from "../db.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, field, input, item, list, pageHead, panel, postButton } from "./ui.js";

const BASE = "/redakce/ucet";

function emailPart(user) {
  const email = user?.email ?? "";
  if (user?.role !== "hlavni") {
    return callout(`Přihlašujete se e-mailem <b>${esc(email)}</b>. Změní ho hlavní redaktor.`);
  }
  return field(
    "E-mail",
    `<input class="${input}" type="email" name="email" maxlength="120" value="${esc(email)}" required autocapitalize="none" autocomplete="email">`,
    "Na něj chodí kód pro přihlášení. Po změně se přihlásíte už jen novým.",
  );
}

export function stamp(ms) {
  return new Date(ms).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function devicesPanel(sessions, currentId) {
  const rows = sessions.map((session) => {
    const here = session.id === currentId;
    return item({
      title: session.device,
      meta: `přihlášeno ${esc(stamp(session.createdAt))} · naposledy ${esc(stamp(session.lastSeen))}`,
      badges: here ? badge("Tohle zařízení", "brand") : "",
      actions: here ? "" : postButton(`${BASE}/odhlasit-zarizeni`, { zarizeni: session.id }, "Odhlásit", "btn-ghost"),
    });
  });
  const others = sessions.some((session) => session.id !== currentId);
  return panel({
    id: "zarizeni",
    title: "Přihlášená zařízení",
    count: sessions.length,
    tools: others ? postButton(`${BASE}/odhlasit-ostatni`, {}, "Odhlásit všechna ostatní", "btn-ghost") : "",
    body: list(rows, "Žádné přihlášení."),
  });
}

export function adminAccount(ctx, data, message) {
  const shown = byline(data.user);
  const body = `${pageHead("Můj účet", `Přihlášen jako <b>${esc(data.user?.email ?? "")}</b>.`)}
    <div class="cards-2">
      <form class="panel form" method="post" action="${BASE}/ulozit">
        <header class="panel-head"><h2>Jméno a alias</h2></header>
        ${callout(`Na webu se teď ukáže: <b>${esc(shown)}</b>. Alias je dobrovolný. Když ho používáte, na webu se u vašich zpráv ukáže on. Když alias smažete, znovu se ukáže jméno.`)}
        ${field("Jméno pod článkem", `<input class="${input}" name="name" required maxlength="60" value="${esc(data.user?.name ?? "")}">`)}
        ${field("Alias", `<input class="${input}" name="alias" maxlength="60" value="${esc(data.user?.alias ?? "")}" autocomplete="nickname">`)}
        ${emailPart(data.user)}
        <div class="form-foot"><span class="form-foot-gap"></span><button class="btn btn-primary" type="submit">Uložit</button></div>
      </form>
      ${devicesPanel(data.sessions ?? [], data.sessionId)}
    </div>`;
  return adminShell(ctx, data, "ucet", message, body, { title: "Můj účet" });
}
