// Rozesílání upozornění (cron každých 15 minut): novinky od minula a večer připomínky na zítřek
// se podle nastavení odběrů zařadí do fronty push_outbox a odtud se posílají po dávkách.
import { sqlStamp } from "../db-core.js";
import { addDays, pragueNow } from "../waste.js";
import { collectEvening, collectNews } from "./collect.js";
import { vapidReady } from "./crypto.js";
import { sendOutcome, sendPush } from "./send.js";
import { loadPushSettings, loadSubscriptions } from "./store.js";
import { wants } from "./topics.js";

export const PUSH_CRON = "*/15 * * * *";
// Večerní připomínky jdou v prvním běhu od 18:00; když cron do 22:00 nedoběhne, ten den se vynechají.
export const EVENING_FROM = "18:00";
const EVENING_TO = "22:00";
// Noční klid: mezi 22:00 a 6:00 nic neodejde. Novinky z noci (i urgentní zpráva) se nezapíšou a pošle je první ranní běh.
export const QUIET_FROM = "22:00";
export const QUIET_TO = "06:00";
export const quietTime = (time) => time >= QUIET_FROM || time < QUIET_TO;
// Víc novinek najednou na jeden prohlížeč: poslední místo dostane souhrn „a další…“.
export const MAX_PER_RUN = 4;
const SEND_BATCH = 300;
const PARALLEL = 10;
const MAX_TRIES = 3;
const OUTBOX_HOURS = 12;
const SENT_KEEP_DAYS = 400;

// Zapíše klíče do push_sent a vrátí jen zprávy, které tam ještě nebyly.
async function claim(env, messages) {
  const fresh = [];
  for (let at = 0; at < messages.length; at += 50) {
    const chunk = messages.slice(at, at + 50);
    const results = await env.DB.batch(chunk.map((item) => env.DB.prepare("insert or ignore into push_sent (key) values (?)").bind(item.key)));
    results.forEach((result, index) => {
      if (Number(result?.meta?.changes ?? 0) > 0) fresh.push(chunk[index]);
    });
  }
  return fresh;
}

function payloadOf(item) {
  return { title: item.title, body: item.body, url: item.url, image: item.image || undefined, tag: item.tag };
}

// Co dostane jeden prohlížeč: jeho témata, nejvýš MAX_PER_RUN upozornění.
export function messagesFor(prefs, messages) {
  const list = messages.filter((item) => wants(prefs, item));
  if (list.length <= MAX_PER_RUN) return list.map(payloadOf);
  const rest = list.length - (MAX_PER_RUN - 1);
  return [
    ...list.slice(0, MAX_PER_RUN - 1).map(payloadOf),
    { title: "Na drbně je toho víc", body: `A ještě ${rest} ${rest < 5 ? "další novinky" : "dalších novinek"}.`, url: "/", tag: "souhrn" },
  ];
}

async function enqueue(env, messages) {
  const subs = await loadSubscriptions(env);
  const rows = subs.flatMap((sub) => messagesFor(sub.prefs, messages).map((payload) => [sub.id, JSON.stringify(payload)]));
  for (let at = 0; at < rows.length; at += 50) {
    await env.DB.batch(rows.slice(at, at + 50).map(([id, payload]) => env.DB.prepare("insert into push_outbox (sub_id, payload) values (?, ?)").bind(id, payload)));
  }
  return rows.length;
}

async function settle(env, row, outcome, now) {
  if (outcome === "ok") {
    await env.DB.batch([
      env.DB.prepare("delete from push_outbox where id = ?").bind(row.id),
      env.DB.prepare("update push_subscriptions set sent_at = ? where id = ?").bind(sqlStamp(now), row.sub_id),
    ]);
  } else if (outcome === "gone") {
    await env.DB.batch([
      env.DB.prepare("delete from push_outbox where sub_id = ?").bind(row.sub_id),
      env.DB.prepare("delete from push_subscriptions where id = ?").bind(row.sub_id),
    ]);
  } else if (outcome === "drop" || Number(row.tries) + 1 >= MAX_TRIES) {
    await env.DB.prepare("delete from push_outbox where id = ?").bind(row.id).run();
  } else {
    await env.DB.prepare("update push_outbox set tries = tries + 1 where id = ?").bind(row.id).run();
  }
}

async function drain(env, now) {
  await env.DB.prepare("delete from push_outbox where created_at < ?").bind(sqlStamp(new Date(now.getTime() - OUTBOX_HOURS * 3600_000))).run();
  const rows =
    (
      await env.DB.prepare(
        `select o.id, o.sub_id, o.payload, o.tries, s.endpoint, s.p256dh, s.auth
         from push_outbox o join push_subscriptions s on s.id = o.sub_id order by o.id limit ?`,
      )
        .bind(SEND_BATCH)
        .all()
    ).results ?? [];
  let sent = 0;
  const gone = new Set();
  for (let at = 0; at < rows.length; at += PARALLEL) {
    await Promise.all(
      rows.slice(at, at + PARALLEL).map(async (row) => {
        if (gone.has(row.sub_id)) return;
        const outcome = sendOutcome(await sendPush(env, row, JSON.parse(row.payload)));
        if (outcome === "gone") gone.add(row.sub_id);
        if (outcome === "ok") sent += 1;
        await settle(env, row, outcome, now);
      }),
    );
  }
  if (sent) await env.DB.prepare("update push_settings set last_sent_at = ? where id = 1").bind(sqlStamp(now)).run();
  return sent;
}

export async function runPush(env, now = new Date()) {
  if (!vapidReady(env)) return { sent: 0 };
  const settings = await loadPushSettings(env);
  if (!settings.enabled) return { sent: 0 };
  const { date: today, time } = pragueNow(now);
  const news = await collectNews(env, today, now);
  // Úplně první běh: co už na webu je, se jen zapíše, ať první odběratelé nedostanou staré věci.
  if (!settings.seeded) {
    await claim(env, news);
    await env.DB.prepare("update push_settings set seeded = 1 where id = 1").run();
    return { sent: 0 };
  }
  if (quietTime(time)) return { sent: 0 };
  const messages = [...news];
  if (time >= EVENING_FROM && time < EVENING_TO && settings.eveningOn !== today) {
    await env.DB.prepare("update push_settings set evening_on = ? where id = 1").bind(today).run();
    messages.push(...(await collectEvening(env, today)));
    await env.DB.prepare("delete from push_sent where sent_at < ?").bind(`${addDays(today, -SENT_KEEP_DAYS)}`).run();
  }
  const fresh = (await claim(env, messages)).filter((item) => !settings.topicsOff.includes(item.topic));
  const queued = fresh.length ? await enqueue(env, fresh) : 0;
  return { queued, sent: await drain(env, now) };
}
