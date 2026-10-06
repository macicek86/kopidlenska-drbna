// Přihlášení do redakce kódem z e-mailu: formuláře, e-mail s kódem a odhlášení.
// Data (kódy, přihlášená zařízení) jsou v src/login-db.js, stránky v src/admin/login.js.
// Bez Turnstile (místně, náhled) chrání formulář jen limity. Místně s LOGIN_CODE_ECHO=1 ukáže kód
// rovnou na stránce, ať jde redakce vyzkoušet bez pošty (jen na localhost a 127.0.0.1).

import { auditLogin, auditLogout } from "./audit.js";
import { turnstileConfig, verifyTurnstile } from "./chat/pass.js";
import { clearCookie, currentUser, readCookie, sessionCookie } from "./db-core.js";
import { html, redirect, secure } from "./http.js";
import {
  CODE_MINUTES,
  deviceLabel,
  endSession,
  linkLive,
  LOGIN_COOKIE,
  loginSettings,
  pendingLogin,
  readNamedCookie,
  REMEMBER_DAYS,
  requestCode,
  startSession,
  verifyCode,
  verifyLink,
} from "./login-db.js";
import { sendMail } from "./mail.js";
import { readEmail } from "./users-db.js";
import { linkPage } from "./admin/login.js";

const HOME = "/redakce/prehled";

export function echoEnabled(env, url) {
  return env.LOGIN_CODE_ECHO === "1" && ["localhost", "127.0.0.1"].includes(url.hostname);
}

// Kam po přihlášení: jen stránka redakce, jinak Přehled.
function nextPage(value) {
  const path = String(value ?? "");
  return /^\/redakce\/[a-z0-9-]+$/.test(path) && path !== "/redakce/odhlasit" ? path : HOME;
}

function loginCookie(value, https, maxAge = CODE_MINUTES * 60) {
  const parts = [`${LOGIN_COOKIE}=${encodeURIComponent(value)}`, "HttpOnly", "Path=/redakce", "SameSite=Lax", `Max-Age=${value ? maxAge : 0}`];
  if (https) parts.push("Secure");
  return parts.join("; ");
}

function back(next, error) {
  const join = next.includes("?") ? "&" : "?";
  return `${next}${join}chyba=${encodeURIComponent(error)}`;
}

// Stav přihlašovací stránky pro loadAdmin: čeká prohlížeč na kód, Turnstile, má někdo e-mail.
export async function loginState(env, request) {
  const [pending, someone] = await Promise.all([
    pendingLogin(env, readNamedCookie(request, LOGIN_COOKIE)),
    env.DB.prepare("select 1 as ok from users where email is not null and email != '' and active = 1 limit 1").first(),
  ]);
  return { pending, siteKey: turnstileConfig(env)?.siteKey ?? "", setupNeeded: !someone };
}

function codeMail(code, link) {
  const text = [
    `Kód pro přihlášení do redakce Kopidlenské drbny: ${code}`,
    "",
    `Platí ${CODE_MINUTES} minut. Nebo otevřete tenhle odkaz:`,
    link,
    "",
    "Když jste o přihlášení nežádali, e-mail smažte. Bez kódu se do redakce nikdo nedostane.",
  ].join("\n");
  const html = `<!doctype html><html lang="cs"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
<p>Kód pro přihlášení do redakce Kopidlenské drbny:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p>
<p>Platí ${CODE_MINUTES} minut. Nebo se přihlaste odkazem: <a href="${link}">Přihlásit do redakce</a></p>
<p style="color:#777;font-size:13px">Když jste o přihlášení nežádali, e-mail smažte. Bez kódu se do redakce nikdo nedostane.</p>
</body></html>`;
  return { subject: `Kód do redakce: ${code}`, text, html };
}

async function signIn(env, request, user, how, next, remember) {
  const https = secure(request);
  const token = await startSession(env, user.id, deviceLabel(request.headers.get("user-agent")), Date.now(), remember);
  const maxDays = remember ? REMEMBER_DAYS : (await loginSettings(env)).maxDays;
  await auditLogin(env, { user, how }).catch(() => {});
  const response = redirect(next, sessionCookie(token, https, maxDays * 86_400));
  response.headers.append("set-cookie", loginCookie("", https));
  return response;
}

async function askForCode(request, env, url, fields) {
  const next = nextPage(fields.next);
  const read = readEmail(fields.email, true);
  if (read.error) return redirect(back(next, read.error));
  const turnstile = turnstileConfig(env);
  if (turnstile && !(await verifyTurnstile(turnstile, fields.turnstile, request.headers.get("cf-connecting-ip")))) {
    return redirect(back(next, "Ověření, že nejste robot, nedoběhlo. Zkuste to znovu."));
  }
  const result = await requestCode(env, { email: read.email, ip: request.headers.get("cf-connecting-ip") ?? "" });
  if (result.limited) return redirect(back(next, "Moc pokusů za poslední hodinu. Zkuste to později."));
  const echo = echoEnabled(env, url);
  if (result.user && !echo) {
    const mail = codeMail(result.code, `${url.origin}/redakce/vstup?t=${result.link}`);
    const sent = await sendMail(env, { to: result.user.email, ...mail });
    if (!sent.ok) {
      await auditLogin(env, { email: read.email, error: sent.error }).catch(() => {});
      return redirect(back(next, `${sent.error} Zkuste to za chvíli, nebo napište hlavnímu redaktorovi.`));
    }
  }
  const target = echo && result.user ? `${next}?kod=${result.code}` : next;
  return redirect(target, loginCookie(result.challenge, secure(request)));
}

async function checkCode(request, env, fields) {
  const next = nextPage(fields.next);
  const result = await verifyCode(env, readNamedCookie(request, LOGIN_COOKIE), fields.loginCode);
  if (result.ok) return signIn(env, request, result.user, "kódem z e-mailu", next, fields.remember);
  if (result.email) await auditLogin(env, { email: result.email, error: result.error }).catch(() => {});
  const response = redirect(back(next, result.error));
  if (result.done) response.headers.set("set-cookie", loginCookie("", secure(request)));
  return response;
}

// POST přihlášení a odhlášení. Ostatní adresy: null.
export async function loginPost(path, request, env, url, fields) {
  if (path === "/redakce/prihlasit") return askForCode(request, env, url, fields);
  if (path === "/redakce/overit") return checkCode(request, env, fields);
  if (path === "/redakce/vstup") {
    const result = await verifyLink(env, fields.token);
    if (result.ok) return signIn(env, request, result.user, "odkazem z e-mailu", HOME, fields.remember);
    if (result.email) await auditLogin(env, { email: result.email, error: result.error }).catch(() => {});
    return redirect(back(HOME, result.error));
  }
  if (path === "/redakce/odhlasit") {
    await auditLogout(env, await currentUser(env, request)).catch(() => {});
    await endSession(env, readCookie(request));
    return redirect("/", clearCookie(secure(request)));
  }
  return null;
}

// GET: odkaz z e-mailu (stránka s tlačítkem) a „Jiný e-mail“. Ostatní adresy: null.
export async function loginGet(path, request, env, url) {
  if (path === "/redakce/jiny-email") return redirect(HOME, loginCookie("", secure(request)));
  if (path === "/redakce/vstup") {
    const token = url.searchParams.get("t") ?? "";
    return html(linkPage({ token, live: await linkLive(env, token) }), 200);
  }
  return null;
}
