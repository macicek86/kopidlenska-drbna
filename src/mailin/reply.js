// Odpověď odesílateli e-mailu na otevírací dobu. Jde přes Email Service (src/mail.js) z adresy redakce,
// na kterou může odesílatel rovnou odpovědět člověku.
import { esc } from "../html.js";
import { SITE_ORIGIN } from "../http.js";
import { MAIL_FROM, sendMail } from "../mail.js";

export const MAILIN_ADDRESS = "oteviracidoba@kopidlenskadrbna.org";

const SIGN = "Koza Drběna\nKopidlenská drbna";

function subjectOf(subject) {
  const base = String(subject ?? "").trim();
  if (!base) return "Otevírací doba";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

function mailHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// Tlačítka v e-mailu: odkazy se styly přímo v prvku, pošta jiné nenačte. `tone`: primary, danger, line.
const BUTTON_STYLES = {
  primary: "background:#1d6b3a;color:#ffffff;border:2px solid #1d6b3a",
  danger: "background:#ffffff;color:#a3261f;border:2px solid #a3261f",
  line: "background:#ffffff;color:#1d3b2a;border:2px solid #1d3b2a",
};

function buttonsHtml(buttons) {
  const links = buttons
    .map(
      (button) =>
        `<a href="${esc(button.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:8px;font-weight:700;text-decoration:none;${BUTTON_STYLES[button.tone] ?? BUTTON_STYLES.line}">${esc(button.label)}</a>`,
    )
    .join("");
  return `<p>${links}</p>`;
}

// Vlákno: odpověď navazuje na e-mail odesílatele, ať ji jeho pošta ukáže pod ním.
function threadHeaders(mail) {
  const id = String(mail.messageId ?? "").trim();
  if (!/^<[^<>\s]+>$/.test(id)) return undefined;
  const references = [...String(mail.references ?? "").split(/\s+/).filter((ref) => /^<[^<>]+>$/.test(ref)).slice(-10), id].join(" ");
  return { "In-Reply-To": id, References: references };
}

// Odpovídá z adresy na otevírací dobu, ať odpověď na otázku Drběny přijde zase sem. Když ji Email Service
// odmítne (adresa není povolená k odesílání), jde odpověď z adresy redakce s „Odpovědět“ na otevírací dobu, bez hlaviček vlákna.
export async function replyTo(env, mail, paragraphs, buttons = []) {
  const body = paragraphs.filter(Boolean);
  const links = buttons.map((button) => `${button.label}: ${button.url}`).join("\n");
  const text = [...body, links, SIGN].filter(Boolean).join("\n\n");
  const html = [mailHtml(body.join("\n\n")), buttons.length ? buttonsHtml(buttons) : "", mailHtml(SIGN)].join("\n");
  const letter = { to: mail.from, subject: subjectOf(mail.subject), text, html, headers: threadHeaders(mail) };
  const sent = await sendMail(env, { ...letter, from: { email: MAILIN_ADDRESS, name: MAIL_FROM.name } });
  if (sent.ok) return sent;
  return sendMail(env, { ...letter, headers: undefined, replyTo: MAILIN_ADDRESS });
}

const PAGES = { "oteviraci-doba": "/oteviraci-doba", lekari: "/lekari", dvory: "/sberne-dvory" };

export function pageLinks(sections) {
  return [...new Set(sections)].map((section) => `${SITE_ORIGIN}${PAGES[section]}`).join("\n");
}

export const NOT_HOURS = `Tahle adresa je jen na změny otevírací doby (třeba „15. 8. zavřeno“ nebo „od září nově po–pá 8–16“). Zprávy, tipy a dotazy posílejte na ${MAIL_FROM.email}, přečte je člověk z redakce.`;

export const UNKNOWN_SENDER = `Na adresu ${MAILIN_ADDRESS} můžou psát jen správci míst, které redakce zná, a tahle adresa mezi nimi není. Když chcete u nás měnit otevírací dobu, napište na ${MAIL_FROM.email}. Zprávy a tipy taky tam.`;

// Neznámá adresa, která psala o otevírací době: její e-mail čeká na povolení redakcí.
export const REQUEST_RECEIVED = `Tuhle adresu zatím neznám, takže jsem e-mail předala redakci. Jakmile vás povolí, e-mail zpracuji a odepíšu vám, co jsem zapsala. Nemusíte psát znovu. Kdyby to spěchalo, napište na ${MAIL_FROM.email}.`;

export const REQUEST_REFUSED = `Redakce vás zatím mezi správce, kteří smějí měnit otevírací dobu e-mailem, nepřidala, a e-mail proto nezapsala. Kdyby to byl omyl, napište na ${MAIL_FROM.email}.`;
