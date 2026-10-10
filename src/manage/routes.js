// Odkaz pro správce: `GET /sprava/<token>` stránka, `POST /sprava/<token>/<akce>` zápis změny.
// Změna jde stejnou cestou jako z redakce (`fileHours`), rovnou nebo ke schválení podle odkazu.
// Do historie změn se zapíše pod jménem, které správce napsal, přes formulář redakce se stejnými poli (src/audit-routes.js).
import { auditFinish, auditStart } from "../audit.js";
import { fileHours, linkAuthor } from "../hours-requests-db.js";
import { linkByToken, linkPath, linkRequests, useLink, withdrawLinkRequest } from "../hours-links-db.js";
import { html, redirect, secure, withError } from "../http.js";
import { messageFrom, OK } from "../ok-messages.js";
import { deadLinkPage, doneLinkPage, managePage } from "./page.js";
import { pendingByToken } from "../mailin/pending.js";
import { periodInputs } from "../post-periods.js";
import { MANAGE_SECTIONS, formKey } from "./sections.js";

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
  const mail = query.window ? await fromMail(env, url.searchParams.get("z"), found.link, MANAGE_SECTIONS[found.link.section], found.row, query.window) : null;
  return html(managePage({ ...found, requests, query, mail, message: manageMessage(url), author: rememberedAuthor(request) }));
}

// Změna z e-mailu, kterou odesílatel šel upravit (`?z=` je token čekající změny): hodnoty pro předvyplnění okna.
async function fromMail(env, token, link, spec, row, window) {
  const pending = token ? await pendingByToken(env, token) : null;
  const items = (pending?.items ?? []).filter((entry) => entry.section === link.section && entry.targetId === link.targetId && entry.edited);
  const first = items[0];
  if (!first || formKey(spec, first.action, first) !== window) return null;
  // Všechny změny z e-mailu pro tenhle řádek jsou období v jednom formuláři.
  const values = [];
  for (const item of items) {
    const value = spec.actions[item.action]?.read({ ...item.input, [spec.idField]: row.id });
    if (!value || value.error) continue;
    // „Jen do“ a „až od“ si formulář pamatuje (`shift`), ať se neukáže jako celý rozepsaný týden.
    values.push({ ...value, ...(item.shift ? { mode: item.shift.mode, time: item.shift.time } : {}) });
  }
  if (!values.length) return null;
  const line = items.map((item) => String(item.line ?? "").replace(/^•\s*/, "")).join("; ");
  return { value: values[0], values, line };
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

  const targetId = action === "zrusit" ? fields.id : row.id;
  const input = { ...fields, [spec.idField]: row.id };
  // Dočasné změny jdou z formuláře s více obdobími: každé období je jedna změna.
  let inputs = [input];
  if (action === "zmena" && fields.kind !== "trvala") {
    const prepared = periodInputs({
      section: link.section,
      actions: spec.actions,
      idField: spec.idField,
      targetId: row.id,
      periods: fields.periods,
      regular: link.section === "dvory" && row.legacy ? null : row.week ?? null,
      shape: link.section === "dvory" ? "week1" : "week2",
    });
    if (prepared.error) return redirect(withError(back, prepared.error), authorCookie(request, author));
    inputs = prepared.inputs;
  }
  const auditPath = `/redakce/${link.section}${spec.audit[action]}`;
  const who = linkAuthor(author, link.label);
  const watch = await auditStart(env, auditPath, input, async () => ({ id: null, name: who })).catch(() => null);
  let result = { ok: true };
  for (const one of inputs) {
    result = await fileHours(env, {
      section: link.section,
      actions: spec.actions,
      action,
      targetId,
      input: one,
      mode: link.direct ? "direct" : "request",
      author,
      linkId: link.id,
      linkLabel: link.label,
    });
    if (!result.ok) break;
  }
  const cookie = authorCookie(request, author);
  if (!result.ok) return redirect(withError(back, result.error), cookie);
  await useLink(env, link);
  const done = html(doneLinkPage(Boolean(result.requested)), 200, cookie);
  await auditFinish(env, watch, redirect(`${base}?ok=${result.requested ? "zadost" : spec.ok(action, result.value)}`), OK).catch(() => {});
  return done;
}
