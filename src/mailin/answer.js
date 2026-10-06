// Změna z e-mailu na otevírací dobu, která čekala na schválení: po schválení nebo zamítnutí to Drběna
// odesílateli napíše ve stejném vlákně jako původní e-mail (src/hours-requests-db.js volá po rozhodnutí).
import { describeChange } from "./describe.js";
import { pageLinks, replyTo } from "./reply.js";

// Co se ukládá k žádosti (sloupec hours_requests.mail_reply).
export function mailReplyText(mailReply) {
  if (!mailReply?.email) return "";
  return JSON.stringify({
    email: String(mailReply.email),
    subject: String(mailReply.subject ?? "").slice(0, 200),
    messageId: String(mailReply.messageId ?? "").slice(0, 300),
    references: String(mailReply.references ?? "").slice(0, 2000),
  });
}

function readMailReply(text) {
  try {
    const value = JSON.parse(String(text ?? ""));
    return value?.email ? value : null;
  } catch {
    return null;
  }
}

// `approved` true: schválená hodnota (mohla být upravená); false: `reason` je důvod zamítnutí.
export async function answerRequester(env, { mailReply, section, action, value, name, approved, reason = "" }) {
  const meta = readMailReply(mailReply);
  if (!meta) return;
  const mail = { from: meta.email, subject: meta.subject, messageId: meta.messageId, references: meta.references };
  const line = `• ${describeChange(section, action, value, name)}`;
  const paragraphs = approved
    ? [`Redakce změnu schválila, už je na webu:\n${line}`, pageLinks([section])]
    : [`Redakce tuhle změnu nezapsala:\n${line}`, reason ? `Důvod: ${reason}` : "", "Kdyby to byl omyl, napište mi znovu nebo na redakce@kopidlenskadrbna.org."];
  await replyTo(env, mail, paragraphs).catch(() => {});
}
