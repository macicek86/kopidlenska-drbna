// Historie změn: zápis kolem formulářů redakce. Před obsluhou formuláře se vyfotí dotčené záznamy
// (src/audit-routes.js říká které), po ní znovu, a do audit_log jde kdo, co (hláška `?ok=`) a změněná pole.
// Přihlášení a odhlášení se zapisují zvlášť, Drběna jen „založila zprávu / návrh“ (src/bot-article.js).
import { recordAudit } from "./audit-db.js";
import { auditRoute } from "./audit-routes.js";

// Sloupce, které se do historie nikdy nepíšou: tajné, nebo je dopočítá stroj.
const OMIT = new Set(["id", "password_hash", "session_token", "token_hash", "keywords", "running_at", "checked_at"]);
const TITLE_COLUMNS = ["title", "name", "summary", "caption", "reason", "note", "login", "code"];

function same(a, b) {
  return String(a ?? "") === String(b ?? "");
}

function present(value) {
  return value != null && String(value) !== "";
}

// Rozdíl dvou snímků (řádek nebo { klíč: hodnota }). Vrací null, když se nic nezměnilo.
export function diffRows(before, after) {
  const kind = before && after ? "upraveno" : after ? "nové" : before ? "smazáno" : "";
  if (!kind) return null;
  const fields = {};
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (OMIT.has(key)) continue;
    const old = before?.[key] ?? null;
    const next = after?.[key] ?? null;
    if (kind === "upraveno" ? same(old, next) : !present(old) && !present(next)) continue;
    fields[key] = [old, next];
  }
  if (kind === "upraveno" && !Object.keys(fields).length) return null;
  return { kind, fields };
}

export function rowTitle(row) {
  for (const column of TITLE_COLUMNS) {
    if (present(row?.[column])) return String(row[column]).slice(0, 200);
  }
  return "";
}

// Klíč hlášky z adresy po uložení; chyba znamená, že se nic neuložilo.
export function outcome(response) {
  const location = response?.headers?.get("location") ?? "";
  if (response && response.status >= 400) return { failed: true, okKey: "" };
  const query = new URL(location || "/", "https://x").searchParams;
  return { failed: query.has("chyba"), okKey: query.get("ok") ?? "" };
}

async function snapshot(env, target, ctx) {
  if (target.read) return { value: await target.read(ctx) };
  const id = Number(await target.id(ctx)) || 0;
  if (id) return { id, value: await env.DB.prepare(`select * from ${target.table} where id = ?`).bind(id).first() };
  if (target.existing) return null;
  const top = await env.DB.prepare(`select max(id) as n from ${target.table}`).first();
  return { fresh: true, top: Number(top?.n ?? 0), value: null };
}

// Nový záznam: první s vyšším id, nejlépe od toho, kdo formulář poslal (souběžně může psát Drběna).
async function freshRow(env, target, top, user) {
  const rows = (await env.DB.prepare(`select * from ${target.table} where id > ? order by id limit 5`).bind(top).all()).results ?? [];
  const mine = (row) => [row.author_id, row.created_by].some((value) => value != null && Number(value) === user?.id);
  return rows.find(mine) ?? rows[0] ?? null;
}

async function afterValue(env, target, shot, ctx) {
  if (target.read) return target.read(ctx);
  if (shot.fresh) return freshRow(env, target, shot.top, ctx.user);
  return env.DB.prepare(`select * from ${target.table} where id = ?`).bind(shot.id).first();
}

// Před obsluhou formuláře. `who` vrátí přihlášeného (ptá se jen u adres, které se zapisují).
// Vrací null, když se adresa nezapisuje nebo nikdo není přihlášený.
export async function auditStart(env, path, fields, who) {
  const route = auditRoute(path);
  if (!route) return null;
  const user = await who();
  if (!user) return null;
  const ctx = { env, fields, user };
  const shots = [];
  for (const target of route.targets ?? []) {
    try {
      shots.push([target, await snapshot(env, target, ctx)]);
    } catch {
      // Tabulka, která na starší databázi ještě není: tenhle snímek se vynechá, formulář jede dál.
    }
  }
  return { route, ctx, shots };
}

// Po obsluze formuláře: když se něco změnilo (nebo jde o akci bez snímků), zapíše záznam.
export async function auditFinish(env, watch, response, messages = {}) {
  if (!watch) return;
  const { failed, okKey } = outcome(response);
  if (failed) return;
  const changes = [];
  for (const [target, shot] of watch.shots) {
    if (!shot) continue;
    const after = await afterValue(env, target, shot, watch.ctx);
    const diff = diffRows(shot.value, after);
    if (!diff) continue;
    const row = after ?? shot.value;
    changes.push({
      label: target.label ?? target.table ?? "",
      id: target.read ? null : Number(row?.id ?? shot.id ?? 0) || null,
      title: target.read ? "" : rowTitle(row),
      ...diff,
    });
  }
  const { route } = watch;
  if (!changes.length && !(route.always && okKey)) return;
  await recordAudit(env, {
    user: watch.ctx.user,
    section: route.section,
    action: messages[okKey] ?? route.action ?? "Změna je uložená.",
    title: changes.find((change) => change.title)?.title ?? "",
    changes,
  });
}

// Přihlášení kódem nebo odkazem z e-mailu (src/login.js). Nepovedené pokusy jdou pod e-mailem, který kdo zadal.
export async function auditLogin(env, { user, how, email, error }) {
  if (user) {
    await recordAudit(env, { user, section: "prihlaseni", action: `Přihlášení ${how}` });
  } else {
    await recordAudit(env, { userName: email, section: "prihlaseni", action: `Nepovedené přihlášení: ${error}` });
  }
}

export async function auditLogout(env, user) {
  if (user) await recordAudit(env, { user, section: "prihlaseni", action: "Odhlášení" });
}

// Článek od Drběny z importu: jen že vznikl, bez hodnot.
export async function auditBot(env, bot, { title, published }) {
  await recordAudit(env, {
    user: bot,
    section: "zpravy",
    action: published ? "Drběna zveřejnila zprávu." : "Drběna napsala návrh zprávy.",
    title,
  });
}
