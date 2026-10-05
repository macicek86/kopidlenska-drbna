// Redakce: Odběr a data. Vypínače feedů, kalendáře akcí a otevírací doby pro vyhledávače (src/feeds/settings.js).
import { FEED_SWITCHES } from "../feeds/settings.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { callout, check, formFoot, pageHead } from "./ui.js";

const BASE = "/redakce/odber";

function switchRow(item, on) {
  const where = item.path ? ` <a href="${esc(item.path.replace(/\?rubrika=$/, ""))}" target="_blank" rel="noopener">${esc(item.path)}</a>` : "";
  return `<div class="feed-switch">${check("feed", item.key, on, esc(item.label), `${esc(item.hint)}${where}`)}</div>`;
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
    </section>`;
  return adminShell(ctx, data, "odber", message, body, { title: "Odběr a data" });
}
