// E-mail na otevírací dobu (oteviracidoba@kopidlenskadrbna.org): Cloudflare Email Routing ho pošle Workeru
// (handler `email` v src/index.js). Drběna (Haiku) z textu vytáhne změny:
// - adresa ze seznamu: změna čeká 10 minut, odesílatel dostane náhled s tlačítky Schválit, Zamítnout a Upravit
//   čas na webu a po vypršení se vyřídí sama (src/mailin/pending.js): ověřený e-mail s „zapisovat rovnou“ se
//   zapíše na web, jinak jde změna ke schválení redakci (`fileHours`),
// - neznámá, ale ověřená adresa se může ozvat: její e-mail čeká na povolení redakcí (src/mailin/register.js),
// - spam se zaznamená a redakce o něm ví, nikdo na něj neodpovídá.
// Odesílateli přijde odpověď, co se zapsalo; e-mail, který o otevírací době není, dostane odpověď, kam psát.
import { SITE_ORIGIN } from "../http.js";
import { notifyEditors } from "../notify.js";
import { enqueue } from "../queue.js";
import { pragueNow } from "../waste.js";
import { askDrbena, mailContent, unknownContent } from "./ai.js";
import { allowedRows, changeReply, hasRows, prepareChanges, tellEditors } from "./apply.js";
import { CONFIRM_MINUTES, createPending } from "./pending.js";
import { authTrace, authVerdict, automatic, readMail } from "./parse.js";
import { markRequest, requestByEmail, requestById, saveRequest } from "./register.js";
import { MAILIN_ADDRESS, NOT_HOURS, REQUEST_RECEIVED, UNKNOWN_SENDER, replyTo } from "./reply.js";
import { answeredToday, countSenderUse, earlierQuestion, logMail, senderByEmail, senderHasRoom, spamReportedToday, unknownRoom } from "./store.js";

// Větší e-mail (fotky, přílohy) Cloudflare rovnou odmítne, změna hodin je pár řádků.
const MAX_SIZE = 2_000_000;

function excerpt(mail) {
  return mail.text.slice(0, 4000);
}

function dayParts() {
  const today = pragueNow().date;
  return { today, weekday: new Date(`${today}T12:00:00Z`).getUTCDay() };
}

// Spam jen zapíše a dá vědět redakci, nejvýš jednou denně za odesílatele.
async function noteSpam(env, mail, entry) {
  const reported = await spamReportedToday(env, mail.from);
  await logMail(env, { ...entry, status: "spam", result: "Drběna ho vyhodnotila jako spam, bez odpovědi." });
  if (reported) return;
  await notifyEditors(env, "spam", {
    subject: `Spam na ${MAILIN_ADDRESS}: ${mail.subject || mail.from}`,
    intro: "Drběna vyhodnotila e-mail jako spam a nikomu neodpověděla. Kdyby to byl omyl, najdete ho v historii e-mailů.",
    fields: [
      ["Od", mail.from],
      ["Předmět", mail.subject],
    ],
    body: mail.text,
  }).catch(() => {});
}

// Adresa, která v seznamu není. Neověřené adrese se neodpovídá (mohla být podvržená a odpověď by šla někomu,
// kdo nic neposlal). U ověřené Drběna rozhodne, jestli je to spam, nebo žádost o povolení.
async function handleUnknown(env, { mail, entry, verified }) {
  const found = verified ? await requestByEmail(env, mail.from) : null;
  const waiting = found && found.status !== "povoleno" ? found : null;
  const skip = !verified || waiting || (await answeredToday(env, mail.from)) || !(await unknownRoom(env));
  if (skip) {
    const result = waiting?.status === "ceka" ? "Adresa čeká na povolení redakcí." : "Adresa není v seznamu.";
    await logMail(env, { ...entry, status: waiting?.status === "ceka" ? "zadost" : "neznamy", result });
    return;
  }
  const { today, weekday } = dayParts();
  const answer = await askDrbena(env, unknownContent({ today, weekday, mail }));
  if (!answer.ok) {
    await logMail(env, { ...entry, status: "chyba", result: answer.error });
    return;
  }
  const verdict = answer.raw?.verdict;
  if (verdict === "spam") {
    await noteSpam(env, mail, entry);
    return;
  }
  if (verdict === "neni_doba") {
    await logMail(env, { ...entry, status: "neznamy", result: "Adresa není v seznamu a e-mail není o otevírací době, odpověděla jsem." });
    await replyTo(env, mail, [UNKNOWN_SENDER]);
    return;
  }
  const saved = await saveRequest(env, { email: mail.from, subject: mail.subject, text: mail.text, messageId: mail.messageId, references: mail.references });
  await logMail(env, { ...entry, status: "zadost", result: "Adresa není v seznamu, e-mail čeká na povolení redakcí. Odesílateli jsem to napsala." });
  await replyTo(env, mail, [REQUEST_RECEIVED]);
  if (!saved.fresh) return;
  await notifyEditors(env, "registrace", {
    subject: `Nová adresa chce psát na otevírací dobu: ${mail.from}`,
    intro: `Z adresy, kterou neznáme, přišel e-mail o otevírací době. Povolíte-li ji a vyberete místa, Drběna e-mail zpracuje.`,
    fields: [
      ["Od", mail.from],
      ["Předmět", mail.subject],
    ],
    body: mail.text,
    path: `/redakce/emaily?povolit=${saved.id}`,
  }).catch(() => {});
}

function confirmationButtons(token, toWeb) {
  const base = `${SITE_ORIGIN}/zmena/${token}`;
  return [
    { label: toWeb ? "Schválit hned" : "Poslat redakci hned", url: `${base}?akce=schvalit`, tone: "primary" },
    { label: "Zamítnout", url: `${base}?akce=zamitnout`, tone: "danger" },
    { label: "Upravit čas na webu", url: `${base}?akce=upravit`, tone: "line" },
  ];
}

// Změny jsou připravené: odesílatel dostane náhled s tlačítky, zápis proběhne sám po `CONFIRM_MINUTES`.
async function holdForConfirmation(env, { mail, sender, entry, prepared, question, who, verified }) {
  const toWeb = verified && sender.direct;
  const lines = prepared.items.map((item) => item.line);
  const logId = await logMail(env, { ...entry, status: "ceka", result: [...lines, ...prepared.failed.map((line) => `nezapsáno: ${line}`), question].filter(Boolean).join("\n") });
  const pending = await createPending(env, { sender, mail, items: prepared.items, who, logId, verified, toWeb });
  await enqueue(env, { type: "mailin.apply", id: pending.id }, CONFIRM_MINUTES * 60);
  const unverified = sender.direct && !verified ? " (e-mail se nepodařilo ověřit, proto ho musí potvrdit člověk)" : "";
  const next = toWeb
    ? `Když nic neuděláte, zapíšu to na web za ${CONFIRM_MINUTES} minut. Můžete to schválit hned, zamítnout, nebo čas upravit přímo na webu.`
    : `Když nic neuděláte, za ${CONFIRM_MINUTES} minut to pošlu redakci ke schválení${unverified} a na web to půjde, až ji redakce schválí. Můžete to poslat hned, zamítnout, nebo čas upravit přímo na webu.`;
  const paragraphs = [
    `Rozumím tomu takhle:\n${lines.join("\n")}`,
    prepared.failed.length ? `Tohle jsem nepochopila, nezapíšu to:\n${prepared.failed.map((line) => `• ${line}`).join("\n")}` : "",
    question,
    next,
  ];
  await replyTo(env, mail, paragraphs, confirmationButtons(pending.token, toWeb));
}

// E-mail od adresy ze seznamu (nebo po povolení nové adresy z žádosti).
export async function processKnown(env, { mail, sender, entry, verified }) {
  if (!senderHasRoom(sender)) {
    await logMail(env, { ...entry, status: "limit", result: "Z téhle adresy dnes přišlo moc e-mailů, nezpracovala jsem ho." });
    return;
  }
  await countSenderUse(env, sender);

  const { today, weekday } = dayParts();
  const allowed = await allowedRows(env, sender, today);
  if (!hasRows(allowed)) {
    await logMail(env, { ...entry, status: "chyba", result: "Adresa nemá žádné místo." });
    await replyTo(env, mail, [`Tahle adresa u nás zatím nemůže měnit žádné místo. Napište prosím na redakce@kopidlenskadrbna.org.`]);
    return;
  }
  if (!mail.text && !mail.subject) {
    await logMail(env, { ...entry, status: "neni_doba", result: "Prázdný e-mail." });
    await replyTo(env, mail, [NOT_HOURS]);
    return;
  }

  const earlier = await earlierQuestion(env, sender.id);
  const answer = await askDrbena(env, mailContent({ today, weekday, sender, mail, allowed, earlier }));
  if (!answer.ok) {
    await logMail(env, { ...entry, status: "chyba", result: answer.error });
    await tellEditors(env, mail, answer.error);
    await replyTo(env, mail, ["Teď se mi e-mail nepodařilo zpracovat. Předala jsem ho redakci, změnu zapíše člověk."]);
    return;
  }
  const verdict = answer.raw?.verdict;
  const question = String(answer.raw?.question ?? "").trim().slice(0, 600);
  if (verdict === "spam") {
    await noteSpam(env, mail, entry);
    return;
  }
  if (verdict === "neni_doba") {
    await logMail(env, { ...entry, status: "neni_doba", result: "Není o otevírací době." });
    await replyTo(env, mail, [NOT_HOURS]);
    return;
  }
  const who = `${sender.label || mail.from} (e-mail)`;
  let outcome = { done: [], asked: [], failed: [], sections: [] };
  if (verdict === "zmeny") {
    // Každá známá adresa dostane nejdřív náhled s tlačítky, vyřídí se po čekání: na web, nebo ke schválení redakci.
    const prepared = await prepareChanges(env, { raw: answer.raw?.changes, allowed, today });
    if (prepared.items.length) {
      await holdForConfirmation(env, { mail, sender, entry, prepared, question, who, verified });
      return;
    }
    outcome = { ...outcome, failed: prepared.failed };
  }
  const wrote = outcome.done.length + outcome.asked.length;
  if (!wrote) {
    const ask = question || "Nepoznala jsem, co přesně se mění. Napište mi prosím, které místo, který den (nebo od kdy do kdy) a jestli je zavřeno, nebo jaké jsou časy.";
    await logMail(env, { ...entry, status: "nejasne", result: [ask, ...outcome.failed].join(" · ") });
    await tellEditors(env, mail, "nerozuměla mu a zeptala se odesílatele.");
    await replyTo(env, mail, changeReply(outcome, { question: ask, sender, verified }));
    return;
  }
  const status = outcome.done.length ? "zapsano" : "ke_schvaleni";
  await logMail(env, { ...entry, status, result: [...outcome.done, ...outcome.asked, ...outcome.failed.map((line) => `nezapsáno: ${line}`), question].filter(Boolean).join("\n") });
  await replyTo(env, mail, changeReply(outcome, { question, sender, verified }));
}

export async function receiveMail(message, env) {
  if (!String(message.to ?? "").toLowerCase().startsWith("oteviracidoba@")) {
    message.setReject("Neznámá adresa.");
    return;
  }
  if (Number(message.rawSize ?? 0) > MAX_SIZE) {
    message.setReject("E-mail je moc velký. Pošlete změnu otevírací doby jen textem, bez příloh.");
    return;
  }
  const mail = await readMail(message.raw);
  mail.from ||= String(message.from ?? "").toLowerCase();
  const base = { email: mail.from, subject: mail.subject, excerpt: excerpt(mail) };
  if (automatic(mail.headers, mail.from)) {
    await logMail(env, { ...base, status: "automaticky", result: "Automatická zpráva, bez odpovědi." });
    return;
  }
  const check = authVerdict(mail.headers, mail.from);
  const verified = check.verified;
  const auth = verified ? check.auth : authTrace(mail.headers, message.headers);
  const sender = await senderByEmail(env, mail.from);
  if (!sender) {
    await handleUnknown(env, { mail, entry: { ...base, verified, auth }, verified });
    return;
  }
  await processKnown(env, { mail, sender, entry: { ...base, senderId: sender.id, verified, auth }, verified });
}

// Redakce adresu z žádosti povolila: uložený e-mail se zpracuje, jako by přišel teď.
export async function replayRequest(env, id) {
  const found = await requestById(env, id);
  if (!found || found.status !== "ceka") return false;
  const sender = await senderByEmail(env, found.email);
  if (!sender) return false;
  await markRequest(env, found.id, "povoleno");
  const mail = { from: found.email, subject: found.subject, text: found.text, headers: [], messageId: found.messageId, references: found.references };
  const entry = { email: found.email, subject: found.subject, excerpt: excerpt(mail), senderId: sender.id, verified: true, auth: "" };
  await processKnown(env, { mail, sender, entry, verified: true });
  return true;
}
