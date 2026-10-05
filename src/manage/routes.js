// Odkaz pro správce: `GET /sprava/<token>` stránka, `POST /sprava/<token>/<akce>` zápis změny.
// Změna jde stejnou cestou jako z redakce (`fileHours`), rovnou nebo ke schválení podle odkazu.
// Do historie změn se zapíše pod jménem, které správce napsal, přes formulář redakce se stejnými poli (src/audit-routes.js).
import { auditFinish, auditStart } from "../audit.js";
import { fileHours, linkAuthor } from "../hours-requests-db.js";
import { countUse, linkByToken, linkHasRoom, linkPath, linkRequests, withdrawLinkRequest } from "../hours-links-db.js";
import { html, redirect, secure, withError } from "../http.js";
import { messageFrom, OK } from "../ok-messages.js";
import { deadLinkPage, managePage } from "./page.js";
import { MANAGE_SECTIONS } from "./sections.js";

const PREFIX = "/sprava/";
// Jméno toho, kdo zapisuje, si prohlížeč pamatuje, ať ho nepíše pokaždé.
const AUTHOR_COOKIE = "drbna_sprava";
// Hlášky, které v redakci mluví o hlavním redaktorovi, správce dostane po svém.
const MANAGE_OK = {
  zadost: "Odesláno. Na web to půjde, až to redakce zkontroluje.",
  "zadost-stazena": "Vzato zpět.",
};

function manageMessage(url) {
  const ok = url.searchParams.get("ok");
  return !url.searchParams.has("chyba") && MANAGE_OK[ok] ? { text: MANAGE_OK[ok], kind: "ok" } : messageFrom(url);
}

function parsePath(path) {
  if (!path.startsWith(PREFIX)) return null;
  const [token, action = ""] = path.slice(PREFIX.length).split("/");
  return { token, action };
}

function rememberedAuthor(request) {
  const match = /(?:^|;\s*)drbna_sprava=([^;]*)/.exec(request.headers.get("cookie") ?? "");
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).slice(0, 80);
  } catch {
    return "";
  }
}

function authorCookie(request, name) {
  return `${AUTHOR_COOKIE}=${encodeURIComponent(name)}; Path=/sprava; Max-Age=31536000; SameSite=Lax; HttpOnly${secure(request) ? "; Secure" : ""}`;
}

function positive(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

async function loadLink(env, token) {
  const link = await linkByToken(env, token);
  if (!link) return null;
  const row = await MANAGE_SECTIONS[link.section].load(env, link.targetId);
  return row ? { link, row } : null;
}

export async function manageGet(path, request, env, url) {
  const parsed = parsePath(path);
  if (!parsed) return null;
  const found = parsed.action ? null : await loadLink(env, parsed.token);
  if (!found) return html(deadLinkPage(), 404);
  const query = { window: url.searchParams.get("okno") ?? "", cancelId: positive(url.searchParams.get("zrusit")) };
  const requests = await linkRequests(env, found.link);
  return html(managePage({ ...found, requests, query, message: manageMessage(url), author: rememberedAuthor(request) }));
}

// Které okno vrátit s chybou: u otevírací doby posílají „Zavřeno…“ i „Nová doba“ stejnou akci, liší je `kind`.
function formKey(spec, action, fields) {
  const forms = spec.forms.filter((form) => form.action === action);
  if (forms.length > 1) return fields.kind === "trvala" ? "nova-doba" : forms[0].key;
  return forms[0]?.key ?? "";
}

// Patří změna (zrušení) k místu odkazu?
async function ownsChange(env, spec, row, changeId) {
  const hit = await env.DB.prepare(`select id from ${spec.changeTable} where id = ? and ${spec.changeParent} = ?`).bind(changeId ?? 0, row.id).first();
  return Boolean(hit);
}

export async function managePost(path, request, env, fields) {
  const parsed = parsePath(path);
  if (!parsed) return null;
  const found = await loadLink(env, parsed.token);
  if (!found) return html(deadLinkPage(), 404);
  const { link, row } = found;
  const spec = MANAGE_SECTIONS[link.section];
  const base = linkPath(link.token);

  if (parsed.action === "stahnout") {
    await withdrawLinkRequest(env, link, fields.requestId);
    return redirect(`${base}?ok=zadost-stazena`);
  }
  const action = parsed.action;
  if (!spec.audit[action]) return redirect(base);
  const author = String(fields.author ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const back = action === "zrusit" ? `${base}?zrusit=${fields.id ?? ""}` : `${base}?okno=${formKey(spec, action, fields)}`;
  if (author.length < 2) return redirect(withError(back, "Napište, kdo změnu zapisuje."));
  if (action === "zrusit" && !(await ownsChange(env, spec, row, fields.id))) return redirect(withError(base, "Tahle změna už tu není."));
  if (!linkHasRoom(link)) return redirect(withError(base, "Z tohohle odkazu dnes přišlo moc změn. Zkuste to zítra, nebo napište redakci."));

  const targetId = action === "zrusit" ? fields.id : row.id;
  const input = { ...fields, [spec.idField]: row.id };
  const auditPath = `/redakce/${link.section}${spec.audit[action]}`;
  const who = linkAuthor(author, link.label);
  const watch = await auditStart(env, auditPath, input, async () => ({ id: null, name: who })).catch(() => null);
  const result = await fileHours(env, {
    section: link.section,
    actions: spec.actions,
    action,
    targetId,
    input,
    mode: link.direct ? "direct" : "request",
    author,
    linkId: link.id,
    linkLabel: link.label,
  });
  const cookie = authorCookie(request, author);
  if (!result.ok) return redirect(withError(back, result.error), cookie);
  await countUse(env, link);
  const response = redirect(`${base}?ok=${result.requested ? "zadost" : spec.ok(action, result.value)}`, cookie);
  await auditFinish(env, watch, response, OK).catch(() => {});
  return response;
}
