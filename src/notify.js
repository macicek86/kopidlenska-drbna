// Upozornění redakce e-mailem: něco nového čeká v redakci (vzkaz z chatu, návrh ke schválení…).
// Každý druh je v NOTIFY_TOPICS (komu, popisek vypínače, kam vede odkaz); dopis skládá notifyEditors.
// Každý si druhy vypíná sám v Můj účet (tabulka notify_off, výchozí vše zapnuté).
// Chyba odeslání nic nezastaví, upozornění je jen navíc ke stránce redakce.
import { esc } from "./html.js";
import { SITE_ORIGIN } from "./http.js";
import { sendMail } from "./mail.js";

// who: "hlavni" = jen hlavní redaktoři, jinak oprávnění, které příjemce musí mít (hlavní redaktor má všechna).
// path: výchozí odkaz do redakce, dopis ho může upřesnit (okno konkrétního návrhu).
export const NOTIFY_TOPICS = {
  vzkaz: { who: "hlavni", label: "Vzkaz z chatu s Drběnou", path: "/redakce/vzkazy" },
  navrh: { who: "hlavni", label: "Návrh zprávy nebo nabídky od přispěvatele", path: "/redakce/zpravy" },
  drbena: { who: "hlavni", label: "Návrh zprávy od Drběny (z importů)", path: "/redakce/zpravy" },
  hodiny: { who: "hlavni", label: "Změna u dvorů, lékařů nebo otevírací doby ke schválení", path: "/redakce/prehled" },
};

export const NOTIFY_TABLES = [
  `create table if not exists notify_off (
    user_id integer not null,
    topic text not null,
    primary key (user_id, topic)
  )`,
];

export async function ensureNotifyTables(env) {
  for (const sql of NOTIFY_TABLES) await env.DB.prepare(sql).run();
}

function receives(user, rule) {
  if (user?.role === "hlavni") return true;
  return rule.who !== "hlavni" && Array.isArray(user?.permissions) && user.permissions.includes(rule.who);
}

// Druhy, které člověku patří, a jestli je má zapnuté (pro Můj účet).
export async function loadNotifySwitches(env, user) {
  const topics = Object.entries(NOTIFY_TOPICS).filter(([, rule]) => receives(user, rule));
  if (!topics.length) return [];
  const rows = await env.DB.prepare("select topic from notify_off where user_id = ?").bind(user.id).all();
  const off = new Set((rows.results ?? []).map((row) => String(row.topic)));
  return topics.map(([key, rule]) => ({ key, label: rule.label, on: !off.has(key) }));
}

// Uloží vypínače z formuláře: on = zaškrtnuté druhy, ostatní z těch, které člověku patří, se vypnou.
export async function saveNotifySwitches(env, user, on) {
  const keep = new Set((on ?? []).map(String));
  const statements = [env.DB.prepare("delete from notify_off where user_id = ?").bind(user.id)];
  for (const [key, rule] of Object.entries(NOTIFY_TOPICS)) {
    if (receives(user, rule) && !keep.has(key)) {
      statements.push(env.DB.prepare("insert into notify_off (user_id, topic) values (?, ?)").bind(user.id, key));
    }
  }
  await env.DB.batch(statements);
}

// Aktivní lidé redakce s e-mailem, kterým druh upozornění patří a nemají ho vypnutý.
export async function notifyRecipients(env, topic) {
  const rule = NOTIFY_TOPICS[topic];
  if (!rule) return [];
  const who =
    rule.who === "hlavni"
      ? "role = 'hlavni'"
      : "(role = 'hlavni' or id in (select user_id from user_permissions where code = ?2))";
  const query = env.DB.prepare(
    `select email from users where active = 1 and email <> '' and ${who}
     and id not in (select user_id from notify_off where topic = ?1) order by id`,
  );
  const rows = await (rule.who === "hlavni" ? query.bind(topic) : query.bind(topic, rule.who)).all();
  return (rows.results ?? []).map((row) => String(row.email));
}

// Text i HTML dopisu: úvod, řádky „Popisek: hodnota“ (prázdné vynechá), volný text a odkaz do redakce.
export function noticeMail({ subject, intro, fields = [], body = "", link = "" }) {
  const rows = fields.filter(([, value]) => String(value ?? "").trim());
  const text = [
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(body ? ["", body] : []),
    ...(link ? ["", `V redakci: ${link}`] : []),
    "",
    "Upozornění si vypnete v redakci na stránce Můj účet.",
  ].join("\n");
  const html = `<!doctype html><html lang="cs"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
<p>${esc(intro)}</p>
${rows.length ? `<table style="border-collapse:collapse">${rows.map(([label, value]) => `<tr><td style="color:#777;padding:2px 12px 2px 0;vertical-align:top">${esc(label)}</td><td style="padding:2px 0">${esc(value)}</td></tr>`).join("")}</table>` : ""}
${body ? `<p style="white-space:pre-line;border-left:3px solid #ddd;padding-left:12px">${esc(body)}</p>` : ""}
${link ? `<p><a href="${esc(link)}">Otevřít v redakci</a></p>` : ""}
<p style="color:#777;font-size:13px">Upozornění si vypnete v redakci na stránce Můj účet.</p>
</body></html>`;
  return { subject: String(subject).slice(0, 150), text, html };
}

// Pošle upozornění všem, komu patří. mail: { subject, intro, fields, body, path }; path upřesní odkaz.
// Odkaz vede vždy na web drbny (cron adresu z požadavku nemá). Vrací { sent, failed }; nikdy nevyhodí chybu.
export async function notifyEditors(env, topic, mail) {
  try {
    const to = await notifyRecipients(env, topic);
    if (!to.length) return { sent: 0, failed: 0 };
    const message = noticeMail({ ...mail, link: `${SITE_ORIGIN}${mail.path ?? NOTIFY_TOPICS[topic].path}` });
    const results = await Promise.all(to.map((address) => sendMail(env, { to: address, ...message })));
    const sent = results.filter((result) => result.ok).length;
    return { sent, failed: results.length - sent };
  } catch {
    return { sent: 0, failed: 1 };
  }
}
