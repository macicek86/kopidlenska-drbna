// Změny z e-mailu na otevírací dobu: příprava (kontrola a náhled bez zápisu) a zápis stejnou cestou jako z odkazu
// pro správce (`fileHours`). Používá ho přijetí e-mailu (run.js) i potvrzení po čekání (pending.js).
import { auditFinish, auditStart } from "../audit.js";
import { loadDoctors } from "../doctors-db.js";
import { fileHours } from "../hours-requests-db.js";
import { MANAGE_SECTIONS } from "../manage/sections.js";
import { notifyEditors } from "../notify.js";
import { OK } from "../ok-messages.js";
import { loadPlaces } from "../places-db.js";
import { loadYards } from "../yards-db.js";
import { changeInput } from "./ai.js";
import { describeChange } from "./describe.js";
import { MAILIN_ADDRESS, pageLinks } from "./reply.js";

// Kolik změn z jednoho e-mailu se zpracuje.
const MAX_CHANGES = 10;

export async function allowedRows(env, sender, today) {
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

export function hasRows(allowed) {
  return Boolean(allowed.places.length || allowed.doctors.length || allowed.yards.length);
}

function rowName(allowed, change) {
  const list = { "oteviraci-doba": allowed.places, lekari: allowed.doctors, dvory: allowed.yards }[change.section];
  return list?.find((row) => row.id === change.targetId)?.name ?? "";
}

// Běžné hodiny lékaře a dvora se přepíšou hned. Novou dobu od pozdějšího dne proto zapíše až redakce.
export function laterRegular(change, today) {
  return change.action === "hodiny" && change.span.startsOn > today;
}

function redirectFor(okKey) {
  return new Response(null, { status: 303, headers: { location: `/x?ok=${okKey}` } });
}

// `mail`: { from, subject, messageId, references, text }, komu po schválení redakcí odepsat a co napsal.
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
    mailReply: { email: mail.from, subject: mail.subject, messageId: mail.messageId, references: mail.references, text: mail.text },
  });
  if (result.ok) await auditFinish(env, watch, redirectFor(result.requested ? "zadost" : spec.ok(change.action, result.value)), OK).catch(() => {});
  return result;
}

export async function tellEditors(env, mail, why) {
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

function regularWeeks(allowed) {
  return new Map([
    ...allowed.places.map((row) => [`misto:${row.id}`, row.week]),
    ...allowed.doctors.map((row) => [`lekar:${row.id}`, row.week]),
    ...allowed.yards.map((row) => [`dvur:${row.id}`, null]),
  ]);
}

function failure(item, message) {
  return `${String(item?.target ?? "").replace(/^\[|\]$/g, "")}: ${message}`;
}

// Z odpovědi Drběny udělá změny připravené k zápisu a náhled pro odesílatele, nic nezapisuje.
// Položka je tvar `changeInput` s jménem řádku a větou do e-mailu (`line`, `later`: potvrdí ji až redakce).
export async function prepareChanges(env, { raw, allowed, today }) {
  const regular = regularWeeks(allowed);
  const items = [];
  const failed = [];
  for (const entry of (raw ?? []).slice(0, MAX_CHANGES)) {
    const change = changeInput(entry, regular);
    if (change.error) {
      failed.push(failure(entry, change.error));
      continue;
    }
    const spec = MANAGE_SECTIONS[change.section];
    const value = spec.actions[change.action].read({ ...change.input, [spec.idField]: change.targetId });
    if (value.error) {
      failed.push(`${rowName(allowed, change)}: ${value.error}`);
      continue;
    }
    const name = rowName(allowed, change);
    const since = change.action === "hodiny" ? { startsOn: change.span.startsOn } : {};
    const later = laterRegular(change, today);
    const line = `• ${describeChange(change.section, change.action, { ...value, ...since }, name)}${later ? " (novou běžnou dobu od pozdějšího dne potvrdíme)" : ""}`;
    items.push({ section: change.section, action: change.action, targetId: change.targetId, kind: change.kind, span: change.span, input: change.input, name, line, later });
  }
  return { items, failed };
}

// Zapíše připravené změny. Rovnou jen když je odesílatel ověřený a adresa to má povolené, jinak jdou ke schválení.
// Vrací řádky do odpovědi odesílateli a stav do záznamu.
export async function writeItems(env, { items, sender, verified, today, who, mail }) {
  const done = [];
  const asked = [];
  const failed = [];
  const sections = [];
  for (const item of items) {
    const direct = verified && sender.direct && !laterRegular(item, today);
    const result = await fileChange(env, item, { who, direct, mail });
    if (!result.ok) {
      failed.push(`${item.name}: ${result.error}`);
      continue;
    }
    const since = item.action === "hodiny" ? { startsOn: item.span.startsOn } : {};
    const line = `• ${describeChange(item.section, item.action, { ...result.value, ...since }, item.name)}`;
    if (result.requested) asked.push(line);
    else done.push(line);
    sections.push(item.section);
  }
  return { done, asked, failed, sections };
}

export function changeReply({ done, asked, failed, sections }, { question, sender, verified }) {
  const parts = [];
  if (done.length) parts.push(`Zapsali jsme na web:\n${done.join("\n")}`);
  if (asked.length) {
    const why = sender.direct && !verified ? " (e-mail se nepodařilo ověřit, proto ho musíme potvrdit)" : "";
    parts.push(`Změna čeká na naši kontrolu${why}, na web půjde po potvrzení:\n${asked.join("\n")}`);
  }
  if (failed.length) parts.push(`Tohle jsme nezapsali:\n${failed.map((line) => `• ${line}`).join("\n")}`);
  if (question) parts.push(question);
  if (done.length || asked.length) parts.push(`Kdyby něco nesedělo, napište nám znovu na tuto adresu nebo na redakce@kopidlenskadrbna.org.\n${pageLinks(sections)}`);
  return parts;
}
