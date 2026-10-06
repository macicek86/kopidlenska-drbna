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

export async function replyTo(env, mail, paragraphs) {
  const text = [...paragraphs.filter(Boolean), SIGN].join("\n\n");
  return sendMail(env, { to: mail.from, subject: subjectOf(mail.subject), text, html: mailHtml(text) });
}

const PAGES = { "oteviraci-doba": "/oteviraci-doba", lekari: "/lekari", dvory: "/sberne-dvory" };

export function pageLinks(sections) {
  return [...new Set(sections)].map((section) => `${SITE_ORIGIN}${PAGES[section]}`).join("\n");
}

export const NOT_HOURS = `Tahle adresa je jen na změny otevírací doby (třeba „15. 8. zavřeno“ nebo „od září nově po–pá 8–16“). Zprávy, tipy a dotazy posílejte na ${MAIL_FROM.email}, přečte je člověk z redakce.`;

export const UNKNOWN_SENDER = `Na adresu ${MAILIN_ADDRESS} můžou psát jen správci míst, které redakce zná, a tahle adresa mezi nimi není. Když chcete u nás měnit otevírací dobu, napište na ${MAIL_FROM.email}. Zprávy a tipy taky tam.`;
