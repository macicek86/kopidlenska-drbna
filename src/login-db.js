// Přihlášení do redakce kódem z e-mailu: kódy, přihlášená zařízení a odhlášení po nečinnosti.
// Kód i odkaz z e-mailu jsou v D1 jen jako otisk SHA-256. Kód patří k prohlížeči, který si ho vyžádal
// (cookie drbna_login nese „výzvu“), odkaz z e-mailu funguje kdekoli. Přihlášené zařízení je řádek
// v `sessions`; cookie drbna_editor nese jeho token, v D1 je zase jen otisk.

export const LOGIN_COOKIE = "drbna_login";
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
const EMAIL_PER_HOUR = 5;
const IP_PER_HOUR = 20;
// Čas posledního kliknutí se zapisuje nejvýš jednou za minutu, ať každá stránka redakce nepíše do D1.
const TOUCH_MS = 60_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

// Odhlášení po nečinnosti v minutách (0 = neodhlašovat) a nejdelší přihlášení ve dnech.
export const IDLE_CHOICES = [30, 60, 120, 240, 480, 1440, 0];
export const MAX_DAY_CHOICES = [1, 7, 14, 30, 90];
const DEFAULTS = { idleMinutes: 120, maxDays: 30 };

export const CODE_EXPIRED = "Kód už neplatí. Nechte si poslat nový.";

export async function ensureLoginTables(env) {
  await env.DB.prepare(
    `create table if not exists login_codes (
      id integer primary key autoincrement,
      email text not null,
      user_id integer,
      challenge_hash text not null unique,
      link_hash text not null unique,
      code_hash text not null,
      ip_hash text not null default '',
      created_at integer not null,
      attempts integer not null default 0,
      used integer not null default 0
    )`,
  ).run();
  await env.DB.prepare("create index if not exists login_codes_email on login_codes(email, created_at)").run();
  await env.DB.prepare("create index if not exists login_codes_ip on login_codes(ip_hash, created_at)").run();
  await env.DB.prepare(
    `create table if not exists sessions (
      id integer primary key autoincrement,
      user_id integer not null,
      token_hash text not null unique,
      device text not null default '',
      created_at integer not null,
      last_seen integer not null
    )`,
  ).run();
  await env.DB.prepare("create index if not exists sessions_user on sessions(user_id)").run();
  await env.DB.prepare(
    `create table if not exists login_settings (
      id integer primary key,
      idle_minutes integer not null default 120,
      max_days integer not null default 30
    )`,
  ).run();
  await env.DB.prepare("insert or ignore into login_settings (id) values (1)").run();
}

const encoder = new TextEncoder();

function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value)))));
}

function randomToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

function randomCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
}

export function readNamedCookie(request, name) {
  const raw = request.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export async function loginSettings(env) {
  const row = await env.DB.prepare("select idle_minutes, max_days from login_settings where id = 1").first();
  return {
    idleMinutes: Number(row?.idle_minutes ?? DEFAULTS.idleMinutes),
    maxDays: Number(row?.max_days ?? DEFAULTS.maxDays),
  };
}

export async function saveLoginSettings(env, input) {
  const idle = Number(input.idleMinutes);
  const days = Number(input.maxDays);
  if (!IDLE_CHOICES.includes(idle) || !MAX_DAY_CHOICES.includes(days)) {
    return { ok: false, error: "Vyberte dobu ze seznamu." };
  }
  await env.DB.prepare("update login_settings set idle_minutes = ?, max_days = ? where id = 1").bind(idle, days).run();
  return { ok: true };
}

// Krátký popis zařízení pro seznam přihlášení, třeba „Chrome · Windows“. Celý User-Agent se neukládá.
export function deviceLabel(userAgent) {
  const ua = String(userAgent ?? "");
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return [browser, system].filter(Boolean).join(" · ") || "Neznámé zařízení";
}

async function countSince(env, column, value, since) {
  const row = await env.DB.prepare(`select count(*) as n from login_codes where ${column} = ? and created_at > ?`)
    .bind(value, since)
    .first();
  return Number(row?.n ?? 0);
}

// Žádost o kód. Neznámý nebo vypnutý účet dostane výzvu taky (stránka vypadá stejně, kód ale nikam nejde
// a žádný nesedí), ať formulář neprozradí, které e-maily redakce zná. Vrací { limited } nebo
// { challenge, code, link, user }; user je null, když se e-mail posílat nemá.
export async function requestCode(env, { email, ip = "", now = Date.now() }) {
  const ipHash = ip ? await sha256(`ip:${ip}`) : "";
  const hourAgo = now - 60 * MINUTE;
  const [byEmail, byIp] = await Promise.all([
    countSince(env, "email", email, hourAgo),
    ipHash ? countSince(env, "ip_hash", ipHash, hourAgo) : 0,
  ]);
  if (byEmail >= EMAIL_PER_HOUR || byIp >= IP_PER_HOUR) return { limited: true };
  const user = await env.DB.prepare("select id, name, email from users where email = ? and active = 1").bind(email).first();
  // Nový kód zneplatní starší, které ještě čekají.
  await env.DB.prepare("update login_codes set used = 1 where email = ? and used = 0").bind(email).run();
  const challenge = randomToken();
  const link = randomToken();
  const code = randomCode();
  await env.DB.prepare(
    `insert into login_codes (email, user_id, challenge_hash, link_hash, code_hash, ip_hash, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(email, user ? Number(user.id) : null, await sha256(challenge), await sha256(link), await sha256(`${challenge}:${code}`), ipHash, now)
    .run();
  return { challenge, code, link, user: user ? { id: Number(user.id), name: String(user.name), email: String(user.email) } : null };
}

async function liveCode(env, column, token, now) {
  if (!token || String(token).length < 20) return null;
  const row = await env.DB.prepare(
    `select id, email, user_id, code_hash, created_at, attempts from login_codes where ${column} = ? and used = 0`,
  )
    .bind(await sha256(token))
    .first();
  if (!row) return null;
  if (Number(row.created_at) < now - CODE_MINUTES * MINUTE || Number(row.attempts) >= CODE_ATTEMPTS) return null;
  return row;
}

// Čeká tenhle prohlížeč na kód? Vrací e-mail, na který šel, nebo null.
export async function pendingLogin(env, challenge, now = Date.now()) {
  const row = await liveCode(env, "challenge_hash", challenge, now);
  return row ? { email: String(row.email) } : null;
}

async function useCode(env, row) {
  const result = await env.DB.prepare("update login_codes set used = 1 where id = ? and used = 0").bind(row.id).run();
  if (Number(result?.meta?.changes ?? 0) === 0) return { ok: false, error: CODE_EXPIRED, email: String(row.email) };
  const user = await env.DB.prepare("select id, name, email from users where id = ? and active = 1").bind(row.user_id).first();
  if (!user) return { ok: false, error: CODE_EXPIRED, email: String(row.email) };
  return { ok: true, user: { id: Number(user.id), name: String(user.name), email: String(user.email) } };
}

// Kód z formuláře. Vrací { ok, user } nebo { ok: false, error, email, done } (done: výzva skončila, nový kód).
export async function verifyCode(env, challenge, code, now = Date.now()) {
  const row = await liveCode(env, "challenge_hash", challenge, now);
  if (!row) return { ok: false, error: CODE_EXPIRED, email: "", done: true };
  const clean = String(code ?? "").replace(/\D/g, "");
  if (!row.user_id || clean.length !== 6 || (await sha256(`${challenge}:${clean}`)) !== row.code_hash) {
    await env.DB.prepare("update login_codes set attempts = attempts + 1 where id = ?").bind(row.id).run();
    const left = CODE_ATTEMPTS - Number(row.attempts) - 1;
    return left > 0
      ? { ok: false, error: `Kód nesedí. Zbývá pokusů: ${left}.`, email: String(row.email), done: false }
      : { ok: false, error: "Kód nesedí. Nechte si poslat nový.", email: String(row.email), done: true };
  }
  return useCode(env, row);
}

// Platí odkaz z e-mailu? (Stránka s tlačítkem: odkaz sám nepřihlásí, ať ho nespotřebuje kontrola odkazů v poště.)
export async function linkLive(env, link, now = Date.now()) {
  const row = await liveCode(env, "link_hash", link, now);
  return Boolean(row?.user_id);
}

export async function verifyLink(env, link, now = Date.now()) {
  const row = await liveCode(env, "link_hash", link, now);
  if (!row?.user_id) return { ok: false, error: "Odkaz už neplatí. Nechte si poslat nový kód.", email: String(row?.email ?? "") };
  return useCode(env, row);
}

export async function startSession(env, userId, device = "", now = Date.now()) {
  const token = randomToken();
  await env.DB.prepare("insert into sessions (user_id, token_hash, device, created_at, last_seen) values (?, ?, ?, ?, ?)")
    .bind(userId, await sha256(token), String(device).slice(0, 60), now, now)
    .run();
  return token;
}

function expired(row, limits, now) {
  if (now > Number(row.created_at) + limits.maxDays * DAY) return true;
  return limits.idleMinutes > 0 && now > Number(row.last_seen) + limits.idleMinutes * MINUTE;
}

// Účet přihlášený tokenem z cookie, nebo null. Prošlé přihlášení (nečinnost, nejdelší doba, vypnutý účet) smaže.
export async function sessionAccount(env, token, now = Date.now()) {
  if (!token || String(token).length < 20) return null;
  const [row, limits] = await Promise.all([
    env.DB.prepare(
      `select s.id as session_id, s.created_at, s.last_seen, u.id, u.login, u.name, u.alias, u.email, u.role, u.active
       from sessions s join users u on u.id = s.user_id where s.token_hash = ?`,
    )
      .bind(await sha256(token))
      .first(),
    loginSettings(env),
  ]);
  if (!row) return null;
  const active = row.active === 1 || row.active === true || row.active === "1";
  if (!active || expired(row, limits, now)) {
    await env.DB.prepare("delete from sessions where id = ?").bind(row.session_id).run();
    return null;
  }
  if (now - Number(row.last_seen) > TOUCH_MS) {
    await env.DB.prepare("update sessions set last_seen = ? where id = ?").bind(now, row.session_id).run();
  }
  return { row, sessionId: Number(row.session_id) };
}

export async function listSessions(env, userId) {
  const rows = await env.DB.prepare("select id, device, created_at, last_seen from sessions where user_id = ? order by last_seen desc")
    .bind(userId)
    .all();
  return (rows.results ?? []).map((row) => ({
    id: Number(row.id),
    device: String(row.device || "Neznámé zařízení"),
    createdAt: Number(row.created_at),
    lastSeen: Number(row.last_seen),
  }));
}

export async function endSession(env, token) {
  if (!token) return;
  await env.DB.prepare("delete from sessions where token_hash = ?").bind(await sha256(token)).run();
}

export async function endSessionById(env, userId, id) {
  const result = await env.DB.prepare("delete from sessions where id = ? and user_id = ?").bind(Number(id) || 0, userId).run();
  return Number(result?.meta?.changes ?? 0) > 0;
}

export async function endOtherSessions(env, userId, keepId) {
  await env.DB.prepare("delete from sessions where user_id = ? and id != ?").bind(userId, Number(keepId) || 0).run();
}

export async function endUserSessions(env, userId) {
  await env.DB.prepare("delete from sessions where user_id = ?").bind(userId).run();
}

// Cron: staré kódy a prošlá přihlášení pryč.
export async function pruneLogin(env, now = Date.now()) {
  const limits = await loginSettings(env);
  await env.DB.prepare("delete from login_codes where created_at < ?").bind(now - DAY).run();
  await env.DB.prepare("delete from sessions where created_at < ?").bind(now - limits.maxDays * DAY).run();
  if (limits.idleMinutes > 0) {
    await env.DB.prepare("delete from sessions where last_seen < ?").bind(now - limits.idleMinutes * MINUTE).run();
  }
}
