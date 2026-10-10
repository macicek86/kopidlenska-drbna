// Změna z e-mailu, která čeká na potvrzení odesílatelem. Drběna e-mail přečte, odesílateli pošle náhled
// s tlačítky Schválit, Zamítnout a Upravit čas na webu a po `CONFIRM_MINUTES` se změna vyřídí sama, když
// nezareaguje: ověřený odesílatel s „zapisovat rovnou“ ji tím zapíše na web, ostatní ji tím pošlou ke schválení redakci. Zapíše ji fronta (src/queue.js) a cron každých 15 minut jako záloha: zápis je idempotentní,
// kdo první přepne stav na `zapisuje`, ten zapíše.
import { createMailLink, newToken } from "../hours-links-db.js";
import { pragueNow } from "../waste.js";
import { writeItems, changeReply, tellEditors } from "./apply.js";
import { replyTo } from "./reply.js";
import { senderById, setLogStatus } from "./store.js";

export const CONFIRM_MINUTES = 10;
// Jak dlouho se dá stránka s potvrzením otevřít.
const KEEP_DAYS = 14;

function parseItems(text) {
  try {
    const value = JSON.parse(String(text ?? "[]"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function mapPending(row) {
  return {
    id: Number(row.id),
    token: String(row.token),
    senderId: Number(row.sender_id),
    email: String(row.email),
    subject: String(row.subject ?? ""),
    messageId: String(row.message_id ?? ""),
    references: String(row.refs ?? ""),
    items: parseItems(row.items),
    text: String(row.text ?? ""),
    who: String(row.who ?? ""),
    status: String(row.status),
    result: String(row.result ?? ""),
    logId: row.log_id == null ? null : Number(row.log_id),
    verified: Number(row.verified ?? 1) === 1,
    toWeb: Number(row.to_web ?? 1) === 1,
    dueAt: String(row.due_at),
    createdAt: String(row.created_at ?? ""),
  };
}

function mailOf(pending) {
  return { from: pending.email, subject: pending.subject, messageId: pending.messageId, references: pending.references, text: pending.text };
}

// `toWeb`: ověřený odesílatel s „zapisovat rovnou“, po čekání jde změna na web. Jinak jde ke schválení redakci.
export async function createPending(env, { sender, mail, items, who, logId, verified, toWeb }) {
  await env.DB.prepare(`delete from mail_pending where created_at < datetime('now', '-${KEEP_DAYS} days')`).run();
  const token = newToken();
  const saved = await env.DB.prepare(
    `insert into mail_pending (token, sender_id, email, subject, message_id, refs, items, text, who, log_id, verified, to_web, due_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+${CONFIRM_MINUTES} minutes'))`,
  )
    .bind(token, sender.id, mail.from, String(mail.subject ?? "").slice(0, 200), String(mail.messageId ?? "").slice(0, 300), String(mail.references ?? "").slice(0, 2000), JSON.stringify(items), String(mail.text ?? "").slice(0, 4000), who, logId ?? null, verified ? 1 : 0, toWeb ? 1 : 0)
    .run();
  return { id: Number(saved.meta?.last_row_id ?? 0), token };
}

export async function pendingByToken(env, token) {
  if (!/^[a-f0-9]{32}$/.test(String(token ?? ""))) return null;
  const row = await env.DB.prepare("select * from mail_pending where token = ?").bind(token).first();
  return row ? mapPending(row) : null;
}

async function pendingById(env, id) {
  const row = await env.DB.prepare("select * from mail_pending where id = ?").bind(id ?? 0).first();
  return row ? mapPending(row) : null;
}

// Kdo první přepne `ceka` na jiný stav, ten změnu vyřizuje; druhý nic nedělá.
async function claim(env, id, status) {
  const result = await env.DB.prepare("update mail_pending set status = ?, decided_at = datetime('now') where id = ? and status = 'ceka'").bind(status, id ?? 0).run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function finish(env, pending, status, result) {
  await env.DB.prepare("update mail_pending set status = ?, result = ? where id = ?").bind(status, result.slice(0, 1000), pending.id).run();
  await setLogStatus(env, pending.logId, { zapsano: "zapsano", ke_schvaleni: "ke_schvaleni", zamitnuto: "zamitnuto", chyba: "chyba", upraveno: "upraveno" }[status] ?? status, result);
}

// Zapíše změny a odesílateli odepíše, co se stalo. Volá ho klik na Schválit, fronta i cron.
export async function applyPending(env, id) {
  const found = await pendingById(env, id);
  if (!found || !(await claim(env, found.id, "zapisuje"))) return { ok: false };
  const mail = mailOf(found);
  try {
    const sender = await senderById(env, found.senderId);
    if (!sender) {
      await finish(env, found, "chyba", "Adresa už není v seznamu.");
      return { ok: false };
    }
    const outcome = await writeItems(env, { items: found.items, sender, verified: found.verified, today: pragueNow().date, who: found.who, mail });
    const wrote = outcome.done.length + outcome.asked.length;
    const text = [...outcome.done, ...outcome.asked, ...outcome.failed.map((line) => `nezapsáno: ${line}`)].join("\n");
    await finish(env, found, wrote ? (outcome.done.length ? "zapsano" : "ke_schvaleni") : "chyba", text);
    await replyTo(env, mail, changeReply(outcome, { question: "", sender, verified: found.verified })).catch(() => {});
    return { ok: true, outcome };
  } catch (error) {
    const why = error instanceof Error ? error.message : "Neznámá chyba.";
    await finish(env, found, "chyba", why);
    await tellEditors(env, mail, why);
    await replyTo(env, mail, ["Změnu se mi nepodařilo zapsat. Předala jsem ji redakci, zapíše ji člověk."]).catch(() => {});
    return { ok: false };
  }
}

// Odesílatel změnu zamítl: nic se nezapíše.
export async function rejectPending(env, token) {
  const found = await pendingByToken(env, token);
  if (!found || !(await claim(env, found.id, "zamitnuto"))) return false;
  await finish(env, found, "zamitnuto", "Odesílatel změnu zamítl.");
  await replyTo(env, mailOf(found), ["Dobře, nic jsem nezapsala. Kdyby šlo o omyl, napište mi znovu."]).catch(() => {});
  return true;
}

// Odesílatel chce čas upravit na webu: pro vybraný řádek vznikne jednorázový odkaz, jeho změny z čekající
// žádosti se vyřadí (zbylé řádky se zapíšou dál podle plánu). Vrací token odkazu.
export async function editPending(env, token, { section, targetId }) {
  const found = await pendingByToken(env, token);
  if (!found || found.status !== "ceka") return null;
  const sender = await senderById(env, found.senderId);
  if (!sender) return null;
  if (!found.items.some((item) => item.section === section && item.targetId === targetId)) return null;
  const linkToken = await createMailLink(env, { section, targetId, label: `e-mail: ${sender.label || sender.email}`, direct: sender.direct });
  if (!linkToken) return null;
  const rest = found.items.filter((item) => !(item.section === section && item.targetId === targetId));
  if (rest.length) {
    await env.DB.prepare("update mail_pending set items = ? where id = ? and status = 'ceka'").bind(JSON.stringify(rest), found.id).run();
  } else if (await claim(env, found.id, "upraveno")) {
    await finish(env, found, "upraveno", "Odesílatel upravuje čas přímo na webu.");
  }
  return linkToken;
}

// Co mělo být zapsané samo a nezapsalo se (fronta nedoručila, Worker se restartoval): cron to dožene.
export async function applyDue(env) {
  const rows = await env.DB.prepare("select id from mail_pending where status = 'ceka' and due_at <= datetime('now') order by id limit 20").all();
  let applied = 0;
  for (const row of rows.results ?? []) {
    const result = await applyPending(env, Number(row.id));
    if (result.ok) applied += 1;
  }
  return applied;
}

// Pro stránku Stav: kolik změn už mělo být zapsáno a pořád čeká (fronta ani cron je nedoručily).
export async function overduePending(env) {
  try {
    const row = await env.DB.prepare("select count(*) as n from mail_pending where status = 'ceka' and due_at <= datetime('now', '-20 minutes')").first();
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
