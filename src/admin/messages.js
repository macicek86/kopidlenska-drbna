// Redakce: vzkazy, které Drběna v chatu předala redakci. Nové nahoře, vyřízené se po 90 dnech samy smažou.
import { MESSAGE_KINDS } from "../messages-db.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, confirmForm, item, list, modal, modalLink, pageHead, panel, postButton } from "./ui.js";

const BASE = "/redakce/vzkazy";

function stamp(iso) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function contactHtml(contact) {
  const value = contact.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `<a href="mailto:${esc(value)}">${esc(value)}</a>`;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.length >= 9) return `<a href="tel:${esc(digits)}">${esc(value)}</a>`;
  return esc(value);
}

function messageItem(row) {
  const meta = [
    esc(stamp(row.createdAt)),
    row.page ? `ze stránky <a href="${esc(row.page)}" target="_blank" rel="noopener">${esc(row.page)}</a>` : "",
    row.contact ? `kontakt ${contactHtml(row.contact)}` : "bez kontaktu",
  ]
    .filter(Boolean)
    .join(" · ");
  const actions = [
    row.done
      ? postButton(`${BASE}/vratit`, { id: row.id }, "Vrátit mezi nové")
      : postButton(`${BASE}/vyrizeno`, { id: row.id }, "Vyřízeno", "btn-primary"),
    modalLink(`${BASE}?smazat=${row.id}`, "Smazat", "btn-ghost"),
  ].join("");
  return item({
    title: row.summary,
    meta,
    badges: `${badge(MESSAGE_KINDS[row.kind], row.done ? "" : "info")}${row.done ? badge("Vyřízeno", "ok") : ""}`,
    actions,
    extra: row.text ? `<p class="message-text">${esc(row.text).replace(/\n/g, "<br>")}</p>` : "",
    search: `${row.summary} ${row.text} ${row.contact}`,
  });
}

export function adminMessages(ctx, data, message, query = {}) {
  const rows = data.messages ?? [];
  const fresh = rows.filter((row) => !row.done);
  const done = rows.filter((row) => row.done);
  const removing = rows.find((row) => row.id === query.remove);
  const dialogs = removing
    ? modal({
        id: "smazat-vzkaz",
        title: "Smazat vzkaz?",
        close: BASE,
        open: true,
        body: confirmForm({
          action: `${BASE}/smazat`,
          id: removing.id,
          text: `Vzkaz „${esc(removing.summary)}“ se smaže natrvalo.`,
          submit: "Smazat vzkaz",
          close: BASE,
        }),
      })
    : "";
  const body = `${pageHead(
    "Vzkazy",
    "Co Drběna v chatu předala redakci: chybějící místa, opravy, tipy na články a další přání návštěvníků. Kontakt je jen tam, kde ho návštěvník sám nechal.",
  )}
    ${data.chatOff ? callout("Chat s Drběnou je teď vypnutý, takže nové vzkazy nepřibývají.", "warn") : ""}
    ${panel({
      title: "Nové",
      id: "nove",
      count: fresh.length,
      tone: fresh.length ? "warn" : "",
      filter: fresh.length > 6 ? "Hledat ve vzkazech…" : "",
      body: list(fresh.map(messageItem), "Žádný nový vzkaz."),
    })}
    ${panel({
      title: "Vyřízené",
      id: "vyrizene",
      count: done.length,
      filter: done.length > 6 ? "Hledat ve vyřízených…" : "",
      body: `${list(done.map(messageItem), "Zatím nic vyřízeného.")}<p class="hint">Vyřízené vzkazy se po 90 dnech samy smažou.</p>`,
    })}
    ${dialogs}`;
  return adminShell(ctx, data, "vzkazy", message, body, { title: "Vzkazy" });
}
