// Sdílení zprávy: ikonka vedle data, ťuknutím se rozbalí vlastní nabídka (ne systémová nabídka telefonu).
// Jen obyčejné odkazy, žádný skript Facebooku, takže čtenáře nikdo nesleduje. Náhled dají značky og:* zprávy.
// Bez JS funguje <details> sám, chybí jen „Kopírovat odkaz“ (public/share.js ho ukáže a zavírá nabídku).
// Messenger jde jen z aplikace v telefonu, na počítači ho CSS schová (.share-touch).
import { esc } from "./html.js";

const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></g></svg>`;

export function shareLinks(url, title) {
  const u = encodeURIComponent(url);
  return [
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["Messenger", `fb-messenger://share/?link=${u}`, "share-touch"],
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`],
    ["E-mail", `mailto:?subject=${encodeURIComponent(title)}&body=${u}`],
  ];
}

export function shareMenu(url, title) {
  const links = shareLinks(url, title)
    .map(([label, href, cls]) => {
      const web = href.startsWith("https:");
      return `<a class="share-item${cls ? ` ${cls}` : ""}" href="${esc(href)}"${web ? ` target="_blank" rel="noopener"` : ""}>${label}</a>`;
    })
    .join("");
  return `<details class="share" data-share>
            <summary class="share-btn" aria-label="Sdílet zprávu" title="Sdílet">${ICON}</summary>
            <div class="share-drop">
              ${links}
              <button class="share-item" type="button" data-share-copy="${esc(url)}" hidden>Kopírovat odkaz</button>
            </div>
          </details>`;
}
