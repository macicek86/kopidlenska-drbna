// Upozornění v D1: odběry prohlížečů s nastavením, fronta k odeslání, co už odešlo, a nastavení redakce.
import { requireChief, sqlStamp } from "../db-core.js";
import { parsePrefs, readPrefs, TOPIC_KEYS } from "./topics.js";
import { fromB64url } from "./crypto.js";

export const PUSH_TABLES = [
  `create table if not exists push_subscriptions (
    id integer primary key autoincrement,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    prefs text not null default '{}',
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    tested_at text not null default '',
    sent_at text not null default ''
  )`,
  `create table if not exists push_outbox (
    id integer primary key autoincrement,
    sub_id integer not null,
    payload text not null,
    tries integer not null default 0,
    created_at text not null default (datetime('now'))
  )`,
  "create index if not exists push_outbox_sub on push_outbox (sub_id)",
  // Klíč každé novinky, která už odešla (zprava-12, zmena-lekar-3, dvur-1-2026-10-08…), ať nepřijde dvakrát.
  `create table if not exists push_sent (
    key text primary key,
    sent_at text not null default (datetime('now'))
  )`,
  // seeded: první běh jen zapíše, co už na webu je, a nic nepošle. evening_on: den, kdy odešly večerní připomínky.
  `create table if not exists push_settings (
    id integer primary key,
    enabled integer not null default 1,
    topics_off text not null default '',
    seeded integer not null default 0,
    evening_on text not null default '',
    last_sent_at text not null default ''
  )`,
];

export async function ensurePushTables(env) {
  for (const sql of PUSH_TABLES) await env.DB.prepare(sql).run();
  await env.DB.prepare("insert into push_settings (id) select 1 where not exists (select 1 from push_settings where id = 1)").run();
}

// Služby prohlížečů, kam smí Worker posílat (Chrome a Android, Firefox, Edge, Safari a iPhone).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/;

// Odběr z prohlížeče (PushSubscription.toJSON()), nebo null.
export function readSubscription(raw) {
  const endpoint = String(raw?.endpoint ?? "");
  const p256dh = String(raw?.keys?.p256dh ?? "");
  const auth = String(raw?.keys?.auth ?? "");
  if (!endpoint || endpoint.length > 1000) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || !PUSH_HOSTS.test(url.hostname)) return null;
    if (fromB64url(p256dh).length !== 65 || fromB64url(auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint, p256dh, auth };
}

function mapSubscription(row) {
  return {
    id: Number(row.id),
    endpoint: String(row.endpoint),
    p256dh: String(row.p256dh),
    auth: String(row.auth),
    prefs: parsePrefs(row.prefs),
    testedAt: String(row.tested_at ?? ""),
  };
}

export async function findSubscription(env, endpoint) {
  const row = await env.DB.prepare("select * from push_subscriptions where endpoint = ?").bind(String(endpoint ?? "")).first();
  return row ? mapSubscription(row) : null;
}

export async function saveSubscription(env, subscription, prefs) {
  await env.DB.prepare(
    `insert into push_subscriptions (endpoint, p256dh, auth, prefs) values (?, ?, ?, ?)
     on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, prefs = excluded.prefs, updated_at = datetime('now')`,
  )
    .bind(subscription.endpoint, subscription.p256dh, subscription.auth, JSON.stringify(readPrefs(prefs)))
    .run();
  return findSubscription(env, subscription.endpoint);
}

// Prohlížeč vyměnil odběr (pushsubscriptionchange): nastavení zůstane.
export async function renewSubscription(env, oldEndpoint, subscription) {
  const old = await findSubscription(env, oldEndpoint);
  if (old) await removeSubscription(env, old.endpoint);
  return saveSubscription(env, subscription, old?.prefs ?? {});
}

export async function removeSubscription(env, endpoint) {
  const sub = await findSubscription(env, endpoint);
  if (!sub) return;
  await env.DB.batch([
    env.DB.prepare("delete from push_outbox where sub_id = ?").bind(sub.id),
    env.DB.prepare("delete from push_subscriptions where id = ?").bind(sub.id),
  ]);
}

export async function markTested(env, id, now = new Date()) {
  await env.DB.prepare("update push_subscriptions set tested_at = ? where id = ?").bind(sqlStamp(now), id).run();
}

export async function loadSubscriptions(env) {
  const rows = await env.DB.prepare("select * from push_subscriptions order by id").all();
  return (rows.results ?? []).map(mapSubscription);
}

export function mapPushSettings(row) {
  const off = String(row?.topics_off ?? "")
    .split(",")
    .filter((key) => TOPIC_KEYS.includes(key));
  return {
    enabled: row ? Number(row.enabled) === 1 : true,
    topicsOff: off,
    seeded: Number(row?.seeded) === 1,
    eveningOn: String(row?.evening_on ?? ""),
    lastSentAt: String(row?.last_sent_at ?? ""),
  };
}

export async function loadPushSettings(env) {
  return mapPushSettings(await env.DB.prepare("select * from push_settings where id = 1").first());
}

export async function savePushSettings(env, request, fields) {
  const gate = await requireChief(env, request);
  if (!gate.ok) return gate;
  const on = fields.pushTopics ?? [];
  const off = TOPIC_KEYS.filter((key) => !on.includes(key));
  await env.DB.prepare("update push_settings set enabled = ?, topics_off = ? where id = 1")
    .bind(fields.pushEnabled ? 1 : 0, off.join(","))
    .run();
  return { ok: true };
}

// Pro redakci: kolik prohlížečů odebírá a kolik u kterého tématu.
export async function loadPushStats(env) {
  const [settings, subs, waiting] = await Promise.all([
    loadPushSettings(env),
    loadSubscriptions(env),
    env.DB.prepare("select count(*) as n from push_outbox").first(),
  ]);
  const byTopic = Object.fromEntries(TOPIC_KEYS.map((key) => [key, subs.filter((sub) => sub.prefs.topics.includes(key)).length]));
  return { settings, total: subs.length, byTopic, waiting: Number(waiting?.n ?? 0) };
}
