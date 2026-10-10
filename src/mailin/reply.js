// Odpověď odesílateli e-mailu na otevírací dobu. Jde přes Email Service (src/mail.js) z adresy redakce,
// na kterou může odesílatel rovnou odpovědět člověku.
import { SITE_ORIGIN } from "../http.js";
import { MAIL_FROM, sendMail } from "../mail.js";
import { mailButtons, mailParagraphs, mailShell } from "../mail-layout.js";

export const MAILIN_ADDRESS = "oteviracidoba@kopidlenskadrbna.org";

const SIGN = "Koza Drběna\nKopidlenská drbna\nKdyby to spěchalo: +420 722 888 906";

function subjectOf(subject) {
  const base = String(subject ?? "").trim();
  if (!base) return "Otevírací doba";
  return /^re:/i.test(base) ? base : `Re: ${base}`;
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
  const first = String(body[0] ?? "").split("\n")[0];
  const html = mailShell({ preheader: first, body: [mailParagraphs(body.join("\n\n")), mailButtons(buttons), mailParagraphs(SIGN)].join("\n") });
  const letter = { to: mail.from, subject: subjectOf(mail.subject), text, html, headers: threadHeaders(mail) };
  const sent = await sendMail(env, { ...letter, from: { email: MAILIN_ADDRESS, name: MAIL_FROM.name } });
  if (sent.ok) return sent;
  return sendMail(env, { ...letter, headers: undefined, replyTo: MAILIN_ADDRESS });
}

const PAGES = { "oteviraci-doba": "/oteviraci-doba", lekari: "/lekari", dvory: "/sberne-dvory" };

export function pageLinks(sections) {
  return [...new Set(sections)].map((section) => `${SITE_ORIGIN}${PAGES[section]}`).join("\n");
}

export const NOT_HOURS = `Tahle adresa je jen na změny otevírací doby. Zprávy, tipy a dotazy posílejte prosím na ${MAIL_FROM.email}, tam se jim budeme věnovat.`;

export const UNKNOWN_SENDER = `Na adresu ${MAILIN_ADDRESS} můžou psát jen správci míst, které známe, a tahle adresa mezi nimi není. Když chcete u nás měnit otevírací dobu, napište nám na ${MAIL_FROM.email}. Zprávy a tipy taky tam.`;

// Neznámá adresa, která psala o otevírací době: její e-mail čeká na povolení.
export const REQUEST_RECEIVED = `Tahle adresa zatím není v seznamu správců, e-mail zkontrolujeme. Jakmile dokončíme kontrolu, e-mail zpracujeme a pošleme vám potvrzení, co se změnilo. Psát znovu nemusíte.`;

export const REQUEST_REFUSED = `Tuhle adresu jsme zatím nepřidali mezi správce, kteří smějí měnit otevírací dobu e-mailem, a proto jsme e-mail nezapsali. Kdyby šlo o omyl, napište nám na ${MAIL_FROM.email}.`;

// Žádost o nové místo (obchod, služba) od neznámé adresy: odesílatel dostane jen potvrzení, že to zpracujeme.
export const PLACE_RECEIVED = `Děkujeme, e-mail zpracujeme. Jakmile bude místo na webu, dáme vám vědět.`;

export const PLACE_REFUSED = `Tohle místo jsme zatím na web nepřidali. Kdyby šlo o omyl nebo vám chyběly údaje, napište nám na ${MAIL_FROM.email}.`;

export function placeCreated(name) {
  return [
    `Místo ${name} je na webu: ${SITE_ORIGIN}/oteviraci-doba`,
    `Změny otevírací doby (třeba „zítra zavřeno“ nebo „příští týden do 15“) nám od teď můžete psát na tuto adresu.`,
  ];
}
