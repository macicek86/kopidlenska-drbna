// Žádosti neznámých (ověřených) adres o povolení psát na otevírací dobu. První e-mail čeká v `mail_requests`,
// hlavní redaktor adresu povolí (vznikne řádek v `mail_senders` a e-mail se zpracuje) nebo zamítne.
import { clip, requireChief } from "../db-core.js";
import { PLACE_REFUSED, replyTo, REQUEST_REFUSED } from "./reply.js";

const KEEP_DAYS = 30;

function mapRequest(row) {
  return {
    id: Number(row.id),
    email: String(row.email),
    subject: String(row.subject ?? ""),
    text: String(row.text ?? ""),
    messageId: String(row.message_id ?? ""),
    references: String(row.refs ?? ""),
    status: String(row.status),
    kind: row.kind === "misto" ? "misto" : "adresa",
    draft: parseDraft(row.draft),
    createdAt: String(row.created_at ?? ""),
  };
}

function parseDraft(text) {
  try {
    const value = JSON.parse(String(text ?? ""));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// Uloží e-mail; od téhle adresy už čekající žádost je, přepíše se novějším e-mailem. Vrací { id, fresh, ignored }.
export async function saveRequest(env, { email, subject, text, messageId, references, kind = "adresa", draft = null }) {
  await env.DB.prepare(`delete from mail_requests where created_at < datetime('now', '-${KEEP_DAYS} days')`).run();
  const address = clip(email, 160);
  const values = [clip(subject, 200), clip(text, 4000), clip(messageId, 300), clip(references, 2000), kind === "misto" ? "misto" : "adresa", draft ? JSON.stringify(draft) : ""];
  const found = await env.DB.prepare("select id, status from mail_requests where email = ?").bind(address).first();
  if (found) {
    // Zamítnutá adresa se 30 dní neozývá znovu (pak záznam zmizí a smí to zkusit).
    if (found.status === "zamitnuto") return { id: Number(found.id), fresh: false, ignored: true };
    // Povolená adresa, kterou redakce později smazala, žádá znovu.
    const again = found.status === "povoleno";
    await env.DB.prepare("update mail_requests set subject = ?, text = ?, message_id = ?, refs = ?, kind = ?, draft = ?, status = 'ceka' where id = ?")
      .bind(...values, found.id)
      .run();
    return { id: Number(found.id), fresh: again };
  }
  const saved = await env.DB.prepare("insert into mail_requests (email, subject, text, message_id, refs, kind, draft) values (?, ?, ?, ?, ?, ?, ?)")
    .bind(address, ...values)
    .run();
  return { id: Number(saved.meta?.last_row_id ?? 0), fresh: true };
}

export async function requestById(env, id) {
  const row = await env.DB.prepare("select * from mail_requests where id = ?").bind(id ?? 0).first();
  return row ? mapRequest(row) : null;
}

export async function requestByEmail(env, email) {
  const row = await env.DB.prepare("select * from mail_requests where email = ?").bind(clip(email, 160)).first();
  return row ? mapRequest(row) : null;
}

export async function waitingRequests(env) {
  const rows = await env.DB.prepare("select * from mail_requests where status = 'ceka' order by id").all();
  return (rows.results ?? []).map(mapRequest);
}

export async function markRequest(env, id, status) {
  await env.DB.prepare("update mail_requests set status = ? where id = ?").bind(status, id ?? 0).run();
}

// Hlavní redaktor adresu nepovolí: odesílatel dostane krátkou odpověď.
export async function refuseRequest(env, request, id) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const found = await requestById(env, id);
  if (!found || found.status !== "ceka") return { ok: false, error: "Tahle žádost už nečeká." };
  await markRequest(env, found.id, "zamitnuto");
  const mail = { from: found.email, subject: found.subject, messageId: found.messageId, references: found.references };
  await replyTo(env, mail, [found.kind === "misto" ? PLACE_REFUSED : REQUEST_REFUSED]).catch(() => {});
  return { ok: true };
}
