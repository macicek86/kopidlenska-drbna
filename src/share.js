// Sdílení zprávy a karty otevírací doby: ikonka (u zprávy vedle data, u místa, lékaře a dvora vedle názvu),
// ťuknutím se rozbalí vlastní nabídka (ne systémová nabídka telefonu).
// Jen obyčejné odkazy, žádný skript Facebooku, takže čtenáře nikdo nesleduje. Náhled dají značky og:* zprávy.
// Bez JS funguje <details> sám, chybí jen „Kopírovat odkaz“ (public/share.js ho ukáže a zavírá nabídku).
// Messenger a WhatsApp jsou jen na mobilu, na počítači je CSS schová (.share-touch). Na mobilu, který umí
// navigator.share, public/share.js místo E-mailu ukáže „Další…“ se systémovou nabídkou (e-mail je v ní taky).
import { shareInfo, sharePath } from "./hours-share.js";
import { esc } from "./html.js";

const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></g></svg>`;

export function shareLinks(url, title) {
  const u = encodeURIComponent(url);
  return [
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["Messenger", `fb-messenger://share/?link=${u}`, "share-touch"],
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`, "share-touch"],
    ["E-mail", `mailto:?subject=${encodeURIComponent(title)}&body=${u}`, "share-mail"],
  ];
}

export function shareMenu(url, title, label = "Sdílet zprávu") {
  const links = shareLinks(url, title)
    .map(([name, href, cls]) => {
      const web = href.startsWith("https:");
      return `<a class="share-item${cls ? ` ${cls}` : ""}" href="${esc(href)}"${web ? ` target="_blank" rel="noopener"` : ""}>${name}</a>`;
    })
    .join("");
  return `<details class="share" data-share>
            <summary class="share-btn" aria-label="${esc(label)}" title="Sdílet">${ICON}</summary>
            <div class="share-drop">
              ${links}
              <button class="share-item" type="button" data-share-more="${esc(url)}" data-share-title="${esc(title)}" hidden>Další…</button>
              <button class="share-item" type="button" data-share-copy="${esc(url)}" hidden>Kopírovat odkaz</button>
            </div>
          </details>`;
}

// Karta místa, lékaře či dvora: stejný odkaz jako tlačítko Sdílet v redakci (src/hours-share.js), s otiskem textu.
export function rowShare(kind, row, today, origin) {
  return shareMenu(`${origin}${sharePath(kind, row, today)}`, shareInfo(kind, row, today).title, `Sdílet: ${row.name}`);
}
