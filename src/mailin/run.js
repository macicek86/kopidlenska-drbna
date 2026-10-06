// E-mail na otevírací dobu (oteviracidoba@kopidlenskadrbna.org): Cloudflare Email Routing ho pošle Workeru
// (handler `email` v src/index.js). Drběna (Haiku) z textu vytáhne změny a zapíšou se stejnou cestou jako
// z odkazu pro správce (`fileHours`): rovnou, když to adresa má zapnuté a e-mail prošel ověřením, jinak ke schválení.
// Odesílateli přijde odpověď, co se zapsalo; e-mail, který o otevírací době není, dostane odpověď, kam psát.
import { auditFinish, auditStart } from "../audit.js";
import { loadDoctors } from "../doctors-db.js";
import { fileHours } from "../hours-requests-db.js";
import { MANAGE_SECTIONS } from "../manage/sections.js";
import { notifyEditors } from "../notify.js";
import { OK } from "../ok-messages.js";
import { loadPlaces } from "../places-db.js";
import { pragueNow } from "../waste.js";
import { loadYards } from "../yards-db.js";
import { askDrbena, changeInput, mailContent } from "./ai.js";
import { describeChange } from "./describe.js";
import { authTrace, authVerdict, automatic, readMail } from "./parse.js";
import { MAILIN_ADDRESS, NOT_HOURS, UNKNOWN_SENDER, pageLinks, replyTo } from "./reply.js";
import { answeredToday, countSenderUse, earlierQuestion, logMail, senderByEmail, senderHasRoom } from "./store.js";

// Větší e-mail (fotky, přílohy) Cloudflare rovnou odmítne, změna hodin je pár řádků.
const MAX_SIZE = 2_000_000;

async function allowedRows(env, sender, today) {
  const want = (section) => new Set(sender.targets.filter((target) => target.section === section).map((target) => target.targetId));
  const [placeIds, doctorIds, yardIds] = [want("oteviraci-doba"), want("lekari"), want("dvory")];
  const [places, doctors, yards] = await Promise.all([
    placeIds.size ? loadPlaces(env, { today }) : [],
    doctorIds.size ? loadDoctors(env, { today }) : [],
    yardIds.size ? loadYards(env, { today }) : [],
  ]);
  return {
    places: places.filter((row) => placeIds.has(row.id)),
    doctors: doctors.filter((row) => doctorIds.has(row.id)),
    yards: yards.filter((row) => yardIds.has(row.id)),
  };
}

function rowName(allowed, change) {
  const list = { "oteviraci-doba": allowed.places, lekari: allowed.doctors, dvory: allowed.yards }[change.section];
  return list.find((row) => row.id === change.targetId)?.name ?? "";
}

// Běžné hodiny lékaře a dvora se přepíšou hned. Novou dobu od pozdějšího dne proto zapíše až redakce.
function laterRegular(change, today) {
  return change.action === "hodiny" && change.span.startsOn > today;
}

function redirectFor(okKey) {
  return new Response(null, { status: 303, headers: { location: `/x?ok=${okKey}` } });
}

async function fileChange(env, change, { who, direct, mail }) {
  const spec = MANAGE_SECTIONS[change.section];
  const input = { ...change.input, [spec.idField]: change.targetId };
  const auditPath = `/redakce/${change.section}${spec.audit[change.action]}`;
  const watch = await auditStart(env, auditPath, input, async () => ({ id: null, name: who })).catch(() => null);
  const result = await fileHours(env, {
    section: change.section,
    actions: spec.actions,
    action: change.action,
    targetId: change.targetId,
    input,
    mode: direct ? "direct" : "request",
    author: who,
    mailReply: { email: mail.from, subject: mail.subject, messageId: mail.messageId, references: mail.references },
  });
  if (result.ok) await auditFinish(env, watch, redirectFor(result.requested ? "zadost" : spec.ok(change.action, result.value)), OK).catch(() => {});
  return result;
}

async function tellEditors(env, mail, why) {
  await notifyEditors(env, "posta", {
    subject: `E-mail na otevírací dobu: ${mail.subject || mail.from}`,
    intro: `Drběna e-mail na ${MAILIN_ADDRESS} nezapsala: ${why}`,
    fields: [
      ["Od", mail.from],
      ["Předmět", mail.subject],
    ],
    body: mail.text,
  }).catch(() => {});
}

// Zapíše změny z odpovědi Drběny. Vrací řádky do odpovědi odesílateli a stav do záznamu.
async function applyChanges(env, { raw, allowed, sender, verified, today, who, mail }) {
  const regular = new Map([
    ...allowed.places.map((row) => [`misto:${row.id}`, row.week]),
    ...allowed.doctors.map((row) => [`lekar:${row.id}`, row.week]),
    ...allowed.yards.map((row) => [`dvur:${row.id}`, null]),
  ]);
  const done = [];
  const asked = [];
  const failed = [];
  const sections = [];
  for (const item of (raw ?? []).slice(0, 10)) {
    const change = changeInput(item, regular);
    if (change.error) {
      failed.push(`${String(item?.target ?? "").replace(/^\[|\]$/g, "")}: ${change.error}`);
      continue;
    }
    const direct = verified && sender.direct && !laterRegular(change, today);
    const result = await fileChange(env, change, { who, direct, mail });
    if (!result.ok) {
      failed.push(`${rowName(allowed, change)}: ${result.error}`);
      continue;
    }
    const since = change.action === "hodiny" ? { startsOn: change.span.startsOn } : {};
    const line = `• ${describeChange(change.section, change.action, { ...result.value, ...since }, rowName(allowed, change))}`;
    if (result.requested) asked.push(line);
    else done.push(line);
    sections.push(change.section);
  }
  return { done, asked, failed, sections };
}

function changeReply({ done, asked, failed, sections }, { question, sender, verified }) {
  const parts = [];
  if (done.length) parts.push(`Zapsala jsem na web:\n${done.join("\n")}`);
  if (asked.length) {
    const why = sender.direct && !verified ? " (e-mail se nepodařilo ověřit, proto ho musí potvrdit člověk)" : "";
    parts.push(`Poslala jsem redakci ke schválení${why}, na web to půjde po schválení:\n${asked.join("\n")}`);
  }
  if (failed.length) parts.push(`Tohle jsem nezapsala:\n${failed.map((line) => `• ${line}`).join("\n")}`);
  if (question) parts.push(question);
  if (done.length || asked.length) parts.push(`Kdyby něco nesedělo, napište mi znovu nebo na redakce@kopidlenskadrbna.org.\n${pageLinks(sections)}`);
  return parts;
}

function excerpt(mail) {
  return mail.text.slice(0, 1000);
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
    // Neověřené adrese neodpovídá: mohla být podvržená a odpověď by šla někomu, kdo nic neposlal.
    const reply = verified && !(await answeredToday(env, mail.from));
    await logMail(env, { ...base, status: "neznamy", verified, auth, result: reply ? "Adresa není v seznamu, odpověděla jsem." : "Adresa není v seznamu." });
    if (reply) await replyTo(env, mail, [UNKNOWN_SENDER]);
    return;
  }
  const entry = { ...base, senderId: sender.id, verified, auth };
  if (!senderHasRoom(sender)) {
    await logMail(env, { ...entry, status: "limit", result: "Z téhle adresy dnes přišlo moc e-mailů, nezpracovala jsem ho." });
    return;
  }
  await countSenderUse(env, sender);

  const now = pragueNow();
  const today = now.date;
  const allowed = await allowedRows(env, sender, today);
  if (!allowed.places.length && !allowed.doctors.length && !allowed.yards.length) {
    await logMail(env, { ...entry, status: "chyba", result: "Adresa nemá žádné místo." });
    await replyTo(env, mail, [`Tahle adresa u nás zatím nemůže měnit žádné místo. Napište prosím na redakce@kopidlenskadrbna.org.`]);
    return;
  }
  if (!mail.text && !mail.subject) {
    await logMail(env, { ...entry, status: "neni_doba", result: "Prázdný e-mail." });
    await replyTo(env, mail, [NOT_HOURS]);
    return;
  }

  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
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
  if (verdict === "neni_doba") {
    await logMail(env, { ...entry, status: "neni_doba", result: "Není o otevírací době." });
    await replyTo(env, mail, [NOT_HOURS]);
    return;
  }
  const who = `${sender.label || mail.from} (e-mail)`;
  const outcome = verdict === "zmeny" ? await applyChanges(env, { raw: answer.raw?.changes, allowed, sender, verified, today, who, mail }) : { done: [], asked: [], failed: [], sections: [] };
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
