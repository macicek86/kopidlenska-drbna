// Stránka potvrzení změny z e-mailu na otevírací dobu: `GET /zmena/<token>` ukáže, co Drběna z e-mailu
// pochopila, a tlačítka. `POST /zmena/<token>/schvalit|zamitnout|upravit` provede volbu. Odkaz z e-mailu jen
// otevře stránku (GET nic nemění, pošta si odkazy předem načítá), změnu dělá až tlačítko na ní.
import { adminDocument } from "../admin/document.js";
import { html, redirect } from "../http.js";
import { esc } from "../view.js";
import { linkPath } from "../hours-links-db.js";
import { applyPending, editPending, pendingByToken, rejectPending } from "./pending.js";

const PREFIX = "/zmena/";

function parsePath(path) {
  if (!path.startsWith(PREFIX)) return null;
  const [token, action = ""] = path.slice(PREFIX.length).split("/");
  return { token, action };
}

function clock(value) {
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", hour: "numeric", minute: "2-digit" }).format(new Date(`${value.replace(" ", "T")}Z`));
}

function shell(title, inner) {
  return adminDocument({
    title: `${title} | Kopidlenská drbna`,
    bodyClass: "adm adm-login",
    body: `<main class="login-box" id="obsah">
      <a class="login-brand" href="/"><img src="/kozel-maskot.webp" alt=""><span>Kopidlenská <b>drbna</b></span></a>
      <div class="login-card form">${inner}</div>
      <a class="login-back" href="/">← Zpět na web</a>
    </main>`,
  });
}

function deadPage() {
  return shell("Odkaz neplatí", `<h1>Odkaz neplatí</h1><p class="adm-lede">Tahle změna už tu není, nebo je odkaz starý. Napište e-mail znovu.</p>`);
}

function lines(pending) {
  return `<ul class="confirm-list">${pending.items.map((item) => `<li>${esc(String(item.line ?? "").replace(/^•\s*/, ""))}</li>`).join("")}</ul>`;
}

function button(token, action, label, kind, fields = {}) {
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${esc(value)}">`)
    .join("");
  return `<form class="inline-form" method="post" action="${PREFIX}${token}/${action}">${inputs}<button class="btn ${kind}" type="submit">${esc(label)}</button></form>`;
}

// Jedna dvojice (sekce, řádek) na jedno tlačítko Upravit; položky o stejném řádku se sloučí.
function editButtons(pending) {
  const seen = new Set();
  const buttons = [];
  for (const item of pending.items) {
    const key = `${item.section}:${item.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = pending.items.length > 1 || item.name ? `Upravit čas: ${item.name || "místo"}` : "Upravit čas na webu";
    buttons.push(button(pending.token, "upravit", label, "btn-line", { section: item.section, targetId: item.targetId }));
  }
  return buttons.join("");
}

function waitingPage(pending, focus) {
  const due = pending.toWeb
    ? `Když nic neuděláte, v ${esc(clock(pending.dueAt))} změnu zapíšeme na web.`
    : `Když nic neuděláte, v ${esc(clock(pending.dueAt))} změnu dáme ke kontrole a na web půjde, až ji potvrdíme.`;
  const approve = pending.toWeb ? "Schválit hned" : "Poslat ke kontrole hned";
  const all = `<div class="form-foot">${button(pending.token, "schvalit", approve, "btn-primary")}${button(pending.token, "zamitnout", "Zamítnout", "btn-ghost btn-danger-text")}</div>
    <p class="adm-lede confirm-edit">Nebo si čas upravte přímo na webu (odkaz platí den a jen jednou):</p>
    <div class="manage-actions">${editButtons(pending)}</div>`;
  const only = {
    schvalit: `<p>${pending.toWeb ? "Zapsat změnu na web hned?" : "Dát změnu ke kontrole hned?"}</p><div class="form-foot">${button(pending.token, "schvalit", pending.toWeb ? "Ano, zapsat" : "Ano, dát ke kontrole", "btn-primary")}<a class="btn btn-ghost" href="${PREFIX}${pending.token}">Zpět</a></div>`,
    zamitnout: `<p>Opravdu změnu zamítnout? Nic nezapíšeme.</p><div class="form-foot">${button(pending.token, "zamitnout", "Ano, zamítnout", "btn-danger")}<a class="btn btn-ghost" href="${PREFIX}${pending.token}">Zpět</a></div>`,
    upravit: `<p>Čas si upravíte přímo na webu, odkaz platí den a jen jednou.</p><div class="form-foot">${editButtons(pending)}</div>`,
  }[focus];
  return shell(
    "Potvrzení změny",
    `<h1>Z e-mailu nám vyšlo toto</h1>
    ${lines(pending)}
    <p class="adm-lede">${due}</p>
    ${only ?? all}`,
  );
}

function donePage(pending) {
  const text = {
    zapsano: "Změna je na webu.",
    ke_schvaleni: "Změna čeká na naši kontrolu, na web půjde po potvrzení.",
    zamitnuto: "Změnu jste zamítli, nic jsme nezapsali.",
    upraveno: "Čas upravujete přímo na webu.",
    zapisuje: "Změna se právě zapisuje, obnovte stránku za chvíli.",
    chyba: "Změnu se nepodařilo zapsat hned, zapíšeme ji.",
  }[pending.status] ?? "Tahle změna už je vyřízená.";
  return shell("Hotovo", `<h1>Hotovo</h1><p class="adm-lede">${esc(text)}</p>${lines(pending)}`);
}

export async function confirmGet(path, env, url) {
  const parsed = parsePath(path);
  if (!parsed || parsed.action) return null;
  const pending = await pendingByToken(env, parsed.token);
  if (!pending) return html(deadPage(), 404);
  if (pending.status !== "ceka") return html(donePage(pending));
  return html(waitingPage(pending, url.searchParams.get("akce") ?? ""));
}

export async function confirmPost(path, env, fields) {
  const parsed = parsePath(path);
  if (!parsed || !parsed.action) return null;
  const pending = await pendingByToken(env, parsed.token);
  if (!pending) return html(deadPage(), 404);
  const back = `${PREFIX}${pending.token}`;
  if (parsed.action === "schvalit") await applyPending(env, pending.id);
  else if (parsed.action === "zamitnout") await rejectPending(env, pending.token);
  else if (parsed.action === "upravit") {
    const link = await editPending(env, pending.token, { section: String(fields.section ?? ""), targetId: Number(fields.targetId) || 0 });
    if (link) return redirect(linkPath(link));
  }
  return redirect(back);
}
