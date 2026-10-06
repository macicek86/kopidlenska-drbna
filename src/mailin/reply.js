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

// Vlákno: odpověď navazuje na e-mail odesílatele, ať ji jeho pošta ukáže pod ním.
function threadHeaders(mail) {
  const id = String(mail.messageId ?? "").trim();
  if (!/^<[^<>\s]+>$/.test(id)) return undefined;
  const references = [...String(mail.references ?? "").split(/\s+/).filter((ref) => /^<[^<>]+>$/.test(ref)).slice(-10), id].join(" ");
  return { "In-Reply-To": id, References: references };
}

// Odpovídá z adresy na otevírací dobu, ať odpověď na otázku Drběny přijde zase sem. Když ji Email Service
// odmítne (adresa není povolená k odesílání), jde odpověď z adresy redakce s „Odpovědět“ na otevírací dobu, bez hlaviček vlákna.
export async function replyTo(env, mail, paragraphs) {
  const text = [...paragraphs.filter(Boolean), SIGN].join("\n\n");
  const letter = { to: mail.from, subject: subjectOf(mail.subject), text, html: mailHtml(text), headers: threadHeaders(mail) };
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
