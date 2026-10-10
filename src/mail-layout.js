// Společná obálka e-mailů drbny (odpovědi na otevírací dobu, upozornění redakci, kód k přihlášení).
// Pošta nenačítá `<style>` ani třídy, proto jsou styly přímo v prvcích a rozvržení z tabulek. Hlavička je
// obrázek s logem; bez obrázků (pošta je ve výchozím stavu blokuje) zůstane pruh v barvě drbny a v něm
// stylovaný popisek s názvem. Textová verze se posílá vedle HTML a je pořád hlavní.
import { esc } from "./html.js";
import { SITE_ORIGIN } from "./http.js";

const INK = "#4a241b";
const PAPER = "#fffaf5";
const PAPER_DEEP = "#f3e7da";
const BRAND = "#c7434d";
const MUTED = "#8a6f66";
const FONT = "Arial,Helvetica,sans-serif";

// Logo má vždy absolutní adresu na webu drbny (pošta nezná, odkud e-mail přišel).
export const MAIL_LOGO = `${SITE_ORIGIN}/mail-logo.png`;

// Odstavce z textu: prázdný řádek odděluje odstavec, nový řádek je zalomení.
export function mailParagraphs(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .filter((block) => block.trim())
    .map((block) => `<p style="margin:0 0 14px">${esc(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// Tlačítka: `tone` je primary, danger nebo line. Odkazy se styly přímo v prvku.
const BUTTON_STYLES = {
  primary: `background:${BRAND};color:#ffffff;border:2px solid ${BRAND}`,
  danger: `background:#ffffff;color:#a3261f;border:2px solid #a3261f`,
  line: `background:#ffffff;color:${INK};border:2px solid ${INK}`,
};

export function mailButtons(buttons) {
  if (!buttons?.length) return "";
  const links = buttons
    .map(
      (button) =>
        `<a href="${esc(button.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;font-weight:700;text-decoration:none;${BUTTON_STYLES[button.tone] ?? BUTTON_STYLES.line}">${esc(button.label)}</a>`,
    )
    .join("");
  return `<p style="margin:6px 0 14px">${links}</p>`;
}

// `preheader` je věta, kterou pošta ukáže v seznamu e-mailů vedle předmětu (v e-mailu je schovaná).
export function mailShell({ body, preheader = "", footer = "" }) {
  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER_DEEP}">${esc(preheader)}</div>`
    : "";
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Kopidlenská drbna</title></head>
<body style="margin:0;padding:0;background:${PAPER_DEEP}">${hidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER_DEEP}" style="background:${PAPER_DEEP}"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="width:100%;max-width:560px;background:${PAPER};border:1px solid #e6d3bf;border-radius:12px">
<tr><td align="center" style="padding:16px 16px 12px;border-bottom:4px solid ${BRAND};border-radius:12px 12px 0 0">
<a href="${SITE_ORIGIN}" style="text-decoration:none;color:${BRAND}"><img src="${MAIL_LOGO}" width="280" alt="Kopidlenská drbna" style="display:block;margin:0 auto;border:0;width:100%;max-width:280px;height:auto;font:bold 26px Georgia,'Times New Roman',serif;color:${BRAND};text-align:center"></a>
</td></tr>
<tr><td style="padding:22px 24px 8px;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK}">
${body}
</td></tr>
<tr><td style="padding:8px 24px 20px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">
${footer || `<a href="${SITE_ORIGIN}" style="color:${MUTED}">www.kopidlenskadrbna.org</a>`}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
