// Redakce: Odběr a data. Vypínače feedů, kalendáře akcí a otevírací doby pro vyhledávače (src/feeds/settings.js).
import { FEED_SWITCHES } from "../feeds/settings.js";
import { PUSH_TOPICS } from "../push/topics.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { callout, check, formFoot, pageHead } from "./ui.js";

const BASE = "/redakce/odber";

function switchRow(item, on) {
  const where = item.path ? ` <a href="${esc(item.path.replace(/\?rubrika=$/, ""))}" target="_blank" rel="noopener">${esc(item.path)}</a>` : "";
  return `<div class="feed-switch">${check("feed", item.key, on, esc(item.label), `${esc(item.hint)}${where}`)}</div>`;
}

function pushStamp(stamp) {
  if (!stamp) return "zatím nic";
  const when = new Date(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(when.getTime()) ? stamp : when.toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Upozornění do prohlížeče (src/push/): kolik lidí odebírá a co, vypínač celé věci i jednotlivých témat.
function pushPanel(push) {
  if (!push) return "";
  const { settings, total, byTopic, waiting, ready } = push;
  const rows = PUSH_TOPICS.map(
    (topic) => `<div class="feed-switch">${check("push_topic", topic.key, !settings.topicsOff.includes(topic.key), `${esc(topic.label)} <span class="muted">(${byTopic[topic.key] ?? 0})</span>`, esc(topic.hint))}</div>`,
  ).join("");
  const facts = [`Odebírá: <strong>${total}</strong> ${total === 1 ? "prohlížeč" : total >= 2 && total <= 4 ? "prohlížeče" : "prohlížečů"}`, `Naposledy odeslané: ${esc(pushStamp(settings.lastSentAt))}`];
  if (waiting) facts.push(`Čeká na odeslání: ${waiting}`);
  return `<section class="panel">
      <header class="panel-head"><h2>Upozornění</h2><p class="panel-note">${!settings.enabled ? "Vypnuto" : settings.promo ? "Zapnuto" : "Zapnuto, na webu schované"}</p></header>
      <form class="form" method="post" action="${BASE}/upozorneni" data-dirty>
        ${ready ? "" : callout("Chybí tajemství VAPID_PUBLIC_KEY a VAPID_PRIVATE_KEY (vyrobí je <code>node scripts/vapid-keys.mjs</code>). Bez nich upozornění nejdou zapnout.", "warn")}
        <p>${facts.join(" · ")}</p>
        <p class="hint">Číslo u tématu říká, kolik odběratelů ho má zaškrtnuté.</p>
        <div class="feed-switch">${check("push_enabled", "1", settings.enabled, "Posílat upozornění", "Vypnuté: nic neodchází a stránka Upozornění řekne, že teď nejdou zapnout.")}</div>
        <div class="feed-switch">${check("push_promo", "1", settings.promo, "Ukazovat na webu", "Zvoneček v hlavičce a bublina s nabídkou. Vypnuté: na webu o upozorněních nikdo neví, ale stránka <a href=\"/upozorneni\" target=\"_blank\" rel=\"noopener\">/upozorneni</a> i rozesílání fungují dál, třeba na zkoušení.")}</div>
        ${rows}
        ${formFoot("Uložit")}
      </form>
    </section>`;
}

export function adminFeeds(ctx, data, message) {
  const settings = data.feedSettings ?? {};
  const off = FEED_SWITCHES.filter((item) => settings[item.key] === false).length;
  const body = `${pageHead("Odběr a data", "Feedy pro čtečky, kalendář akcí k odběru a otevírací doba pro vyhledávače. Všechno je na stránce <a href=\"/odber\" target=\"_blank\" rel=\"noopener\">Odebírat drbnu</a>.")}
    <section class="panel">
      <header class="panel-head"><h2>Co je zapnuté</h2><p class="panel-note">${off ? `Vypnuto: ${off} z ${FEED_SWITCHES.length}` : "Všechno zapnuté"}</p></header>
      <form class="form" method="post" action="${BASE}/ulozit" data-dirty>
        ${callout("Vypnutý feed na své adrese hlásí, že tu není, a zmizí z webu i ze stránky Odebírat drbnu. Kdo ho už odebírá, přestane dostávat novinky. Když vypnete všechno, zmizí i stránka Odebírat drbnu a odkaz v patičce.")}
        ${FEED_SWITCHES.map((item) => switchRow(item, settings[item.key] !== false)).join("")}
        ${formFoot("Uložit")}
      </form>
    </section>
    ${pushPanel(data.push)}`;
  return adminShell(ctx, data, "odber", message, body, { title: "Odběr a data" });
}
