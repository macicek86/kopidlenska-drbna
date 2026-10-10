// Žádost o nové místo z e-mailu (src/mailin/run.js `requestNewPlace`): hlavní redaktor v redakci zkontroluje údaje
// ve formuláři místa a potvrdí. Vznikne místo na webu, přiřadí se odesílateli (nová adresa dostane „ke schválení“)
// a odesílatel dostane zprávu, že místo je na webu.
import { requireChief } from "../db-core.js";
import { savePlace } from "../places-db.js";
import { markRequest, requestById } from "./register.js";
import { placeCreated, replyTo } from "./reply.js";
import { saveSender, senderByEmail } from "./store.js";

// `fields`: pole formuláře místa (name, label, place, phone, week…) a `requestId`.
export async function createPlaceFromRequest(env, request, fields) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return { ok: false, error: gate.error };
  const found = await requestById(env, fields.requestId);
  if (!found || found.status !== "ceka" || found.kind !== "misto") return { ok: false, error: "Tahle žádost už nečeká." };
  const saved = await savePlace(env, request, { ...fields, id: undefined });
  if (!saved.ok) return saved;
  const target = `oteviraci-doba:${saved.id}`;
  const existing = await senderByEmail(env, found.email);
  const targets = [...(existing?.targets ?? []).map((row) => `${row.section}:${row.targetId}`), target];
  // Nová adresa jde „ke schválení“: její změny nejdřív zkontrolujeme, rovnou je může zapnout redakce později.
  const sender = await saveSender(env, request, {
    id: existing?.id,
    email: found.email,
    label: existing?.label || String(fields.name ?? "").slice(0, 80),
    direct: existing ? existing.direct : false,
    targets,
  });
  if (!sender.ok) return sender;
  await markRequest(env, found.id, "povoleno");
  const mail = { from: found.email, subject: found.subject, messageId: found.messageId, references: found.references };
  await replyTo(env, mail, placeCreated(String(fields.name ?? "").trim())).catch(() => {});
  return { ok: true, id: saved.id };
}
