// Redakce: Chat s Drběnou. Zapnutí, model, limity a rozpočet, povaha v chatu, statistiky a uložené otázky.
import { CHAT_MODELS, USD_CZK } from "../chat/ai.js";
import { CHAT_PERSONA_MAX, DEFAULT_CHAT_PERSONA } from "../chat/prompt.js";
import { DEFAULT_CHAT_IDEAS, IDEA_LENGTH, IDEAS_MAX } from "../chat/store.js";
import { formatDayMonth } from "../format.js";
import { esc } from "../view.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, confirmForm, field, formFoot, icon, input, item, list, modal, pageHead, panel, postButton } from "./ui.js";

const BASE = "/redakce/chat";

const number = (value) => Number(value).toLocaleString("cs-CZ");

export function czk(value) {
  const amount = Number(value) || 0;
  const digits = amount > 0 && amount < 10 ? 2 : 0;
  return `${amount.toLocaleString("cs-CZ", { minimumFractionDigits: digits, maximumFractionDigits: digits })} Kč`;
}

function stamp(iso) {
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function tile(glyph, value, label, tone = "") {
  return `<div class="stat${tone ? ` stat-${tone}` : ""}">${icon(glyph)}<b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

// Otázky po dnech, SVG bez stylů (CSP).
export function questionChart(days) {
  const width = 720;
  const height = 160;
  const top = Math.max(1, ...days.map((row) => row.questions));
  const step = width / Math.max(1, days.length);
  const bar = Math.max(2, step * 0.72);
  const bars = days
    .map((row, index) => {
      const x = (index * step + (step - bar) / 2).toFixed(1);
      const tall = Math.round((row.questions / top) * (height - 4));
      return `<g><title>${esc(`${formatDayMonth(row.day)}: ${number(row.questions)} otázek, ${czk(row.cost)}`)}</title>
        <rect class="chart-visitors" x="${x}" y="${height - tall}" width="${bar.toFixed(1)}" height="${tall}" rx="1.5"/></g>`;
    })
    .join("");
  return `<figure class="visit-chart">
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Otázky po dnech, nejvíc ${esc(number(top))} za den">${bars}</svg>
    <figcaption><span>${esc(formatDayMonth(days[0]?.day ?? ""))}</span>
      <span class="chart-key"><i class="key-visitors"></i>otázky</span>
      <span>${esc(formatDayMonth(days.at(-1)?.day ?? ""))}</span></figcaption>
  </figure>`;
}

function modelOptions(selected) {
  return Object.entries(CHAT_MODELS)
    .map(([key, model]) => {
      const price = `asi ${czk(((model.price.input * 6000 + model.price.output * 300) / 1_000_000) * USD_CZK)} za otázku`;
      return `<option value="${key}"${key === selected ? " selected" : ""}>${esc(`${model.label} (${price})`)}</option>`;
    })
    .join("");
}

function numberField(label, name, value, min, max, hint) {
  return field(label, `<input class="${input}" type="number" name="${name}" min="${min}" max="${max}" required value="${value}">`, hint);
}

function settingsForm(settings) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Chat je na webu", "V rohu každé stránky bude okénko „Zeptej se Drběny“. Vypnutím zmizí hned.")}
    ${field("Model", `<select class="${input}" name="model">${modelOptions(settings.model)}</select>`, "Sonnet píše česky lépe a líp drží povahu, Haiku je o polovinu levnější. Cena je odhad, záleží na délce otázky a na tom, kolik Drběna hledá.")}
    <div class="pair">
      ${numberField("Otázek na návštěvníka za den", "perVisitor", settings.perVisitor, 1, 200, "Návštěvníka pozná jen po dobu dne, bez cookies.")}
      ${numberField("Otázek za den pro celý web", "perDay", settings.perDay, 1, 10000, "Pojistka proti zahlcení.")}
    </div>
    <div class="pair">
      ${numberField("Měsíční rozpočet v Kč", "budget", settings.budget, 0, 100000, "Když ho chat vyčerpá, do konce měsíce se odmlčí.")}
      ${numberField("Otázky uchovávat dní", "keepDays", settings.keepDays, 1, 365, "Starší se samy smažou.")}
    </div>
    ${numberField("Starších zpráv v rejstříku", "archive", settings.archive, 0, 1000, "Kromě 30 nejnovějších vidí Drběna i tolik starších, každou jen s nadpisem a klíčovými slovy. Každých 100 zpráv přidá k otázce asi 0,20 Kč se Sonnetem a 0,10 Kč s Haiku. Hledáním najde zprávu v celém archivu i bez rejstříku, ten jen ušetří hledání u nedávných věcí. 0 rejstřík vypne.")}
    ${field(
      `Rychlé otázky ${settings.ideas ? badge("Vlastní", "info") : badge("Výchozí")}`,
      `<textarea class="${input}" name="ideas" rows="4">${esc(settings.ideas || DEFAULT_CHAT_IDEAS.join("\n"))}</textarea>`,
      `Tlačítka pod pozdravem, ťuknutím se Drběny rovnou zeptají. Jedna otázka na řádek, nejvýš ${IDEAS_MAX}, každá do ${IDEA_LENGTH} znaků. Řádek smažete a otázka zmizí. Prázdné pole vrátí výchozí otázky, pomlčka (-) je schová všechny.`,
    )}
    ${check("chatAds", "1", settings.ads, "Drběna vidí reklamy", "Nabídku sousedů zmíní, jen když se hodí k otázce, a řekne, že jde o reklamu.")}
    ${field(
      `Jak se Drběna chová v chatu ${settings.persona ? badge("Vlastní text", "info") : badge("Výchozí text")}`,
      `<textarea class="${input}" name="persona" rows="6" maxlength="${CHAT_PERSONA_MAX}">${esc(settings.persona || DEFAULT_CHAT_PERSONA)}</textarea>`,
      "Přidá se k povaze ze stránky <a href=\"/redakce/drbena\">Koza Drběna</a> a má přednost. Prázdné pole vrátí výchozí text. Že mluví v první osobě a drží se toho, co je na drbně, platí vždy.",
    )}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

// Rychlé zapnutí a vypnutí: stejné nastavení, jen obrácený vypínač.
function toggleButton(settings) {
  const fields = {
    model: settings.model,
    perVisitor: settings.perVisitor,
    perDay: settings.perDay,
    budget: settings.budget,
    keepDays: settings.keepDays,
    archive: settings.archive,
    persona: settings.persona,
    ideas: settings.ideas,
  };
  if (settings.ads) fields.chatAds = "1";
  if (!settings.enabled) fields.enabled = "1";
  return postButton(`${BASE}/ulozit`, fields, settings.enabled ? "Vypnout chat" : "Zapnout chat", settings.enabled ? "btn-line" : "btn-primary");
}

function statusPanel(chat) {
  const { settings, stats } = chat;
  const model = CHAT_MODELS[settings.model].label;
  const main = settings.enabled ? "Chat je na webu." : "Chat je vypnutý.";
  const sub = `Model ${model}, ${number(settings.perVisitor)} otázek na návštěvníka a ${number(settings.perDay)} za den, rozpočet ${czk(settings.budget)} měsíčně.`;
  const notes = [];
  if (!chat.hasApiKey) notes.push(callout("Chybí klíč pro Claude. Nastavíte ho příkazem <code>npx wrangler secret put ANTHROPIC_API_KEY</code>. Do té doby Drběna neodpoví.", "warn"));
  if (!chat.turnstile) {
    notes.push(
      callout(
        "Turnstile není nastavený, takže chat neověřuje, že píše člověk. Chrání ho jen limity. V Cloudflare založte widget Turnstile pro adresu webu a uložte klíče: <code>npx wrangler secret put TURNSTILE_SITE_KEY</code> a <code>npx wrangler secret put TURNSTILE_SECRET</code>.",
        "warn",
      ),
    );
  }
  if (settings.enabled && stats.month.cost >= settings.budget) notes.push(callout("Rozpočet na tento měsíc je vyčerpaný. Drběna do konce měsíce neodpovídá, pokud ho nezvýšíte.", "bad"));
  if (settings.enabled && stats.today.questions >= settings.perDay) notes.push(callout("Dnešní strop otázek je vyčerpaný. Zítra se chat zase rozjede.", "warn"));
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("chat")}</span>
      <div>
        <p class="status-main">${esc(main)}</p>
        <p class="status-sub">${esc(sub)}</p>
      </div>
      ${toggleButton(settings)}
    </div>
    ${notes.join("")}
  </section>`;
}

function answerHtml(text) {
  return esc(text).replace(/\n/g, "<br>");
}

function questionItem(row) {
  const meta = `${esc(stamp(row.askedAt))} · ${esc(CHAT_MODELS[row.model]?.label ?? row.model)} · ${esc(czk(row.cost))}`;
  return item({
    title: row.question,
    meta,
    badges: row.ok ? "" : badge("Nepovedlo se", "bad"),
    extra: `<details class="chat-answer"><summary>Odpověď Drběny</summary><p>${answerHtml(row.answer)}</p>${
      row.lookups ? `<p class="hint">${answerHtml(row.lookups)}</p>` : ""
    }</details>`,
    search: `${row.question} ${row.answer}`,
  });
}

export function adminChat(ctx, data, message, query = {}) {
  const chat = data.chat;
  if (!chat) return adminShell(ctx, data, "chat", message, "", { title: "Chat s Drběnou" });
  const { settings, stats } = chat;
  const share = settings.budget ? Math.min(100, Math.round((stats.month.cost / settings.budget) * 100)) : 100;
  const dialogs = [
    modal({ id: "nastaveni", title: "Nastavení chatu", size: "wide", close: BASE, open: Boolean(query.importSettings), body: settingsForm(settings) }),
    modal({
      id: "smazat-otazky",
      title: "Smazat uložené otázky?",
      close: BASE,
      open: Boolean(query.clearChat),
      body: confirmForm({
        action: `${BASE}/smazat-otazky`,
        id: 1,
        text: "Smažou se všechny uložené otázky a odpovědi. Statistiky a útrata zůstanou.",
        submit: "Smazat otázky",
        close: BASE,
      }),
    }),
  ];
  const body = `${pageHead(
    "Chat s Drběnou",
    "Návštěvníci se v okénku na webu ptají Drběny. Odpovídá jen z toho, co je na drbně (zprávy, služby, akce) a ze zdrojů Munipolisu a fotbalu. Deník ne.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(chat)}
    <div class="stats">
      ${tile("chat", number(stats.today.questions), `otázek dnes · ${number(stats.today.conversations)} rozhovorů`)}
      ${tile("chart", czk(stats.today.cost), "útrata dnes")}
      ${tile("calendar", czk(stats.month.cost), `tento měsíc · ${share} % rozpočtu · ${number(stats.month.questions)} otázek`, share >= 100 ? "bad" : share >= 80 ? "warn" : "")}
      ${tile("x", number(stats.last30.limited + stats.last30.blocked), `zastaveno za 30 dní · limit ${number(stats.last30.limited)}, Turnstile ${number(stats.last30.blocked)}`)}
    </div>
    ${panel({
      title: "Posledních 30 dní",
      id: "graf",
      body: stats.last30.questions
        ? `${questionChart(stats.chart)}<p class="hint">Za 30 dní ${number(stats.last30.questions)} otázek za ${czk(stats.last30.cost)}${
            stats.last30.questions ? `, průměrně ${czk(stats.last30.cost / stats.last30.questions)} za otázku` : ""
          }${stats.last30.failed ? `, ${number(stats.last30.failed)} se nepovedlo` : ""}. Ceny jsou přepočtené kurzem ${USD_CZK} Kč za dolar.</p>`
        : callout("Zatím se nikdo nezeptal."),
    })}
    ${panel({
      title: "Na co se lidé ptají",
      id: "otazky",
      count: stats.questions.length,
      filter: stats.questions.length > 6 ? "Hledat v otázkách…" : "",
      tools: stats.questions.length ? `<a class="btn btn-sm btn-ghost" href="${BASE}?smazat-otazky=1" data-open="smazat-otazky">Smazat všechny</a>` : "",
      body: `${list(stats.questions.map(questionItem), "Zatím žádné otázky.")}
        <p class="hint">Posledních 100 otázek. Ukládají se bez vazby na člověka a po ${number(settings.keepDays)} dnech se samy smažou.</p>`,
    })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "chat", message, body, { title: "Chat s Drběnou" });
}
