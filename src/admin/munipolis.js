// Redakce: import zpráv z Munipolisu. Nastavení, stav poslední kontroly a co Koza Drběna se zprávami udělala.
import { formatShort } from "../format.js";
import { DEFAULT_VOICE, MODEL } from "../munipolis/ai.js";
import { DEFAULT_FEED_URL } from "../munipolis/feed.js";
import { STATUS } from "../munipolis/store.js";
import { esc } from "../view.js";
import { pragueNow } from "../waste.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, field, formFoot, icon, input, item, list, modal, modalLink, pageHead, panel } from "./ui.js";

const BASE = "/redakce/munipolis";

const TONE = { nove: "info", stare: "off", hotovo: "ok", preskoceno: "off", duplicita: "warn", chyba: "bad" };

// Kam vede značka, kterou Claude použil v duplicate_of nebo kterou zpráva vytvořila.
export function refLink(ref) {
  const [kind, id] = String(ref ?? "").split(":");
  const links = {
    zprava: ["/redakce/zpravy?id=", "Zpráva"],
    navrh: ["/redakce/zpravy?navrh=", "Návrh zprávy"],
    akce: ["/redakce/akce?id=", "Akce"],
    odstavka: ["/redakce/odstavky?oznameni=", "Odstávka"],
    munipolis: [`${BASE}?zprava=`, "Zpráva z Munipolisu"],
  };
  if (!links[kind] || !/^\d+$/.test(id ?? "")) return "";
  return `<a href="${links[kind][0]}${id}">${esc(links[kind][1])} #${id}</a>`;
}

function stamp(iso) {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const clock = pragueNow(new Date(parsed));
  return `${formatShort(clock.date)} v ${clock.time}`;
}

function results(entry) {
  return [
    entry.proposalId && refLink(`navrh:${entry.proposalId}`),
    entry.articleId && refLink(`zprava:${entry.articleId}`),
    entry.eventId && refLink(`akce:${entry.eventId}`),
    entry.noticeId && refLink(`odstavka:${entry.noticeId}`),
  ].filter(Boolean);
}

function entryItem(entry) {
  const made = results(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  return item({
    title: entry.title,
    meta: [stamp(entry.publishedAt), entry.reason ? esc(entry.reason) : ""].filter(Boolean).join(" · "),
    badges: `${badge(STATUS[entry.status] ?? entry.status, TONE[entry.status] ?? "")}${made.length ? `<span class="item-sub">${made.join(" · ")}</span>` : ""}${duplicate ? `<span class="item-sub">Stejné jako ${duplicate}</span>` : ""}`,
    actions: modalLink(`${BASE}?zprava=${entry.id}`, "Detail"),
    search: `${entry.title} ${entry.reason}`,
  });
}

function processButton(entry) {
  if (entry.status === "hotovo") return "";
  const label = entry.status === "preskoceno" || entry.status === "duplicita" ? "Přesto zpracovat" : "Zpracovat teď";
  return `<form method="post" action="${BASE}/zpracovat"><input type="hidden" name="id" value="${entry.id}"><button class="btn btn-primary" type="submit" data-busy="Drběna čte…">${label}</button></form>`;
}

function textBlock(text) {
  const paragraphs = String(text ?? "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${esc(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return paragraphs || `<p class="muted">Zpráva nemá text. Údaje jsou nejspíš jen na obrázku.</p>`;
}

function entryDetail(entry) {
  const made = results(entry);
  const duplicate = entry.duplicateOf ? refLink(entry.duplicateOf) : "";
  const images = entry.images.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Obrázek ${index + 1}</a>`).join(" · ");
  const source = entry.link ? `<a href="${esc(entry.link)}" target="_blank" rel="noopener noreferrer">Původní zpráva</a>` : "";
  return `<div class="import-detail">
    <p class="item-badges">${badge(STATUS[entry.status] ?? entry.status, TONE[entry.status] ?? "")}<span class="item-sub">${esc(stamp(entry.publishedAt))}</span></p>
    ${entry.reason ? callout(`<b>Drběna:</b> ${esc(entry.reason)}`, entry.status === "chyba" ? "bad" : "info") : ""}
    ${made.length ? `<p>Vzniklo: ${made.join(" · ")}</p>` : ""}
    ${duplicate ? `<p>Stejná věc už je tady: ${duplicate}</p>` : ""}
    <div class="import-source">${textBlock(entry.text)}</div>
    ${source || images ? `<p class="item-sub">${[source, images].filter(Boolean).join(" · ")}</p>` : ""}
    <div class="form-foot">${cancelLink(BASE, "Zavřít")}<span class="form-foot-gap"></span>${processButton(entry)}</div>
  </div>`;
}

function settingsForm(settings) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Kontrolovat Munipolis", "Drbna se podívá každé čtyři hodiny. Při prvním zapnutí vezme jen zprávy z posledních tří dnů.")}
    ${check("autoPublish", "1", settings.autoPublish, "Rovnou zveřejňovat", "Bez zaškrtnutí čeká všechno na schválení: zprávy jako návrhy, akce a odstávky jako skryté.")}
    ${field("Adresa RSS", `<input class="${input}" type="url" name="feedUrl" required maxlength="300" value="${esc(settings.feedUrl || DEFAULT_FEED_URL)}">`)}
    ${field("Jak Drběna píše", `<textarea class="${input}" name="voice" rows="7" maxlength="3000">${esc(settings.voice || DEFAULT_VOICE)}</textarea>`, "Pokyny pro styl textů. Pravidla o faktech, rubrikách a duplicitách platí vždy.")}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function statusPanel(data, settings) {
  const checked = settings.checkedAt ? `Naposledy zkontrolováno ${stamp(settings.checkedAt)}.` : "Ještě se nekontrolovalo.";
  const mode = settings.enabled ? (settings.autoPublish ? "Zapnuto, rovnou zveřejňuje." : "Zapnuto, všechno čeká na schválení.") : "Vypnuto. Kontrolovat jde jen ručně.";
  const keyWarn = data.hasApiKey
    ? ""
    : callout("Chybí klíč pro Claude. Nastavíte ho příkazem <code>npx wrangler secret put ANTHROPIC_API_KEY</code>. Do té doby se zprávy jen stáhnou a počkají.", "warn");
  const tone = settings.status === "error" ? "bad" : "warn";
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("clock")}</span>
      <div>
        <p class="status-main">${esc(checked)}</p>
        <p class="status-sub">${esc(mode)} Model ${esc(MODEL)}.</p>
      </div>
      <form method="post" action="${BASE}/zkontrolovat"><button class="btn btn-line" type="submit" data-busy="Kontroluji…">Zkontrolovat teď</button></form>
    </div>
    ${settings.note && settings.status !== "ok" ? callout(esc(settings.note), tone) : settings.note ? `<p class="status-sub">${esc(settings.note)}</p>` : ""}
    ${keyWarn}
  </section>`;
}

export function adminMunipolis(ctx, data, message, query = {}) {
  const settings = data.importSettings ?? { feedUrl: DEFAULT_FEED_URL, voice: "", enabled: false, autoPublish: false };
  const entries = data.importItems ?? [];
  const open = entries.find((entry) => entry.id === query.importId) ?? null;
  const dialogs = [
    modal({ id: "nastaveni", title: "Nastavení importu", size: "wide", close: BASE, open: Boolean(query.importSettings) && !open, body: settingsForm(settings) }),
  ];
  if (open) dialogs.push(modal({ id: "okno", title: open.title, size: "wide", close: BASE, open: true, body: entryDetail(open) }));
  const body = `${pageHead(
    "Munipolis",
    "Koza Drběna čte zprávy města z Munipolisu, třídí je do rubrik, akcí a odstávek a přepisuje je po svém. Když už stejná věc na drbně je, nechá ji být.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(data, settings)}
    ${panel({ id: "zpravy-mesta", title: "Zprávy města", count: entries.length, filter: entries.length > 6 ? "Hledat ve zprávách…" : "", body: list(entries.map(entryItem), "Zatím žádná zpráva. Klikněte na Zkontrolovat teď.") })}
    ${dialogs.join("")}`;
  return adminShell(ctx, data, "munipolis", message, body, { title: "Munipolis" });
}
