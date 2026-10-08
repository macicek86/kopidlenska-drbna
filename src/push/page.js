// Stránka /upozorneni: zapnutí upozornění v prohlížeči a výběr, co chodí. Odkaz na ni je ve zvonečku v hlavičce
// a v patičce (src/push/promo.js). Chování je v public/push.js.
import { text as tx } from "../copy.js";
import { esc } from "../html.js";
import { layout } from "../view.js";
import { NOTICE_PICKS, PUSH_TOPICS } from "./topics.js";

function pickBox(name, value, label, extra = "") {
  return `<li${extra}><label class="push-check"><input type="checkbox" name="${name}" value="${esc(value)}"> <span>${esc(label)}</span></label></li>`;
}

// Rubriky: hlavní a pod ní podrubriky, jen ty, kde už nějaká zpráva je.
function rubricItems(rubrics) {
  const used = rubrics.filter((item) => item.articleCount || rubrics.some((child) => child.parentId === item.id && child.articleCount));
  return used
    .filter((item) => !item.parentId)
    .map((top) => {
      const kids = used.filter((item) => item.parentId === top.id && item.articleCount);
      return `${pickBox("rubrics", top.id, top.name)}${kids.map((kid) => pickBox("rubrics", kid.id, kid.name, ` class="push-sub"`)).join("")}`;
    })
    .join("");
}

function pickItems(topic, lists) {
  if (topic.pick === "rubrics") return rubricItems(lists.rubrics);
  if (topic.pick === "kinds") return NOTICE_PICKS.map(([value, label]) => pickBox("kinds", value, label)).join("");
  return (lists[topic.pick] ?? []).map((item) => pickBox(topic.pick, item.id, item.label)).join("");
}

function topicRow(topic, lists) {
  const items = topic.pick ? pickItems(topic, lists) : "";
  const pick = items
    ? `<details class="push-pick">
        <summary>${esc(topic.pickLabel)}…</summary>
        <p class="muted">Když nic nezaškrtnete, přijde všechno.</p>
        <ul class="plain">${items}</ul>
      </details>`
    : "";
  return `<li class="push-topic">
      <label class="push-check push-main"><input type="checkbox" name="topic" value="${esc(topic.key)}" checked> <span><strong>${esc(topic.label)}</strong><small>${esc(topic.hint)}</small></span></label>
      ${pick}
    </li>`;
}

const IOS_HINT = `<div class="push-ios" data-push-ios hidden>
    <p><strong>Na iPhonu a iPadu</strong> upozornění fungují, jen když si drbnu přidáte na plochu:</p>
    <ol>
      <li>Dole ťukněte na <strong>Sdílet</strong> (čtvereček se šipkou).</li>
      <li>Vyberte <strong>Přidat na plochu</strong>.</li>
      <li>Drbnu otevřete z plochy a tady ťukněte na Zapnout upozornění.</li>
    </ol>
  </div>`;

// lists: { rubrics, places, doctors, yards } (položky s id a label). ready: jsou klíče VAPID, settings: nastavení redakce.
export function pushPage(ctx, { lists, settings, publicKey }) {
  const topics = PUSH_TOPICS.filter((topic) => !settings.topicsOff.includes(topic.key));
  const live = Boolean(publicKey) && settings.enabled && topics.length;
  const panel = live
    ? `<section class="card push" data-push data-key="${esc(publicKey)}">
        <div class="push-head">
          <p class="push-msg" data-push-msg role="status">Zjišťuji, jestli to váš prohlížeč umí…</p>
          <div class="row">
            <button class="btn btn-primary" type="button" data-push-on hidden>Zapnout upozornění</button>
            <button class="btn btn-line" type="button" data-push-test hidden>Poslat zkušební</button>
            <button class="btn btn-line" type="button" data-push-off hidden>Vypnout</button>
          </div>
          ${IOS_HINT}
        </div>
        <form class="push-topics" data-push-form>
          <h2>Co chcete dostávat</h2>
          <ul class="plain push-list">${topics.map((topic) => topicRow(topic, lists)).join("")}</ul>
          <p class="push-saved" data-push-saved aria-live="polite"></p>
        </form>
      </section>`
    : `<section class="card push"><p>Upozornění teď nejdou zapnout. Zkuste to prosím později.</p></section>`;
  return layout({
    ...ctx,
    title: `Upozornění | ${tx(ctx.copy, "site_name")}`,
    description: "Drbna vám dá vědět, když se mění otevírací doba, jde se do sběrného dvora, koná se akce nebo vyšla zpráva.",
    // Bez klíčů nebo s vypnutými upozorněními stránka nic neumí: do vyhledávačů nepatří.
    noindex: !live,
    // Náhled při sdílení: Drběna s telefonem plným upozornění (1200 × 630 jako výchozí).
    image: "/og-upozorneni.webp",
    imageSize: true,
    head: `<link rel="stylesheet" href="/push.css">`,
    script: live ? `<script src="/push.js" defer></script>` : "",
    body: `
      <p class="eyebrow">Upozornění</p>
      <h1>Drbna vám dá vědět</h1>
      <p class="lede">Upozornění přijde do telefonu nebo počítače, i když drbnu zrovna nemáte otevřenou. Bez registrace, vyberete si, co vás zajímá.</p>
      ${panel}
      <p class="fine push-fine">Drbna si pamatuje jen adresu, kam upozornění posílat, a co jste zaškrtli. Vypnout je jde tady, nebo v nastavení prohlížeče.</p>`,
  });
}
