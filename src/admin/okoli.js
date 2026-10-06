// Redakce: akce z okolí (programy kulturních domů a měst kolem Kopidla) a týdenní článek „Kam vyrazit“.
import { formatShort } from "../format.js";
import { okoliRunning } from "../okoli/store.js";
import { czechDay, MANUAL_MAX_DAYS, outingFor, plannedOutings, shiftDay } from "../okoli/outings.js";
import { periodLabel } from "../okoli/weekend.js";
import { pragueNow } from "../waste.js";
import { esc } from "../view.js";
import { madeLinks, stamp, VOICE_NOTE } from "./imports.js";
import { atTime, publishTimeField } from "./publish-time.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, field, formFoot, icon, input, item, list, modal, pageHead, panel, postButton } from "./ui.js";

const BASE = "/redakce/okoli";
const KIND_LABEL = { divadlo: "divadlo", kino: "kino", akce: "akce" };

function settingsForm(settings) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Stahovat akce z okolí automaticky", "Drbna se na weby zdrojů podívá každé čtyři hodiny. Akce se na webu samy neukážou, jsou jen podkladem pro víkendový článek.")}
    <fieldset class="field checks"><legend>Psát článek Kam vyrazit sám</legend>
    ${check("weekly", "1", settings.weekly, "Na víkendy", "V pátek ráno na pátek až neděli.")}
    ${check("autoVolno", "1", settings.autoVolno, "Na volno se svátkem", "Svátek navazující na víkend (Velikonoce, Vánoce, prodloužený víkend): celé volno, den před ním. Bez zaškrtnutí je to obyčejný víkendový článek.")}
    ${check("autoSvatek", "1", settings.autoSvatek, "Na samostatné svátky", "Svátek uprostřed týdne: krátký článek den předem jen na ten den.")}
    </fieldset>
    <p class="hint">Nejdřív akce v Kopidlně z kalendáře, pak výběr z okolí. Když se nic nekoná, článek nevyjde.</p>
    ${check("autoPublish", "1", settings.autoPublish, "Článek rovnou zveřejnit", "Bez zaškrtnutí čeká jako návrh ke schválení.")}
    ${publishTimeField(settings.publishTime, "Drběna píše v noci, na web článek půjde až v tuhle hodinu. Prázdné: hned. Článek napsaný tlačítkem vyjde vždy hned.")}
    ${field("Okruh v km", `<input class="${input}" type="number" name="radiusKm" min="1" max="100" required value="${settings.radiusKm}">`, "Zdroje dál od Kopidla Drběna do článku nebere.")}
    ${VOICE_NOTE}
    ${formFoot("Uložit", cancelLink(BASE))}
  </form>`;
}

function weekendLine(settings) {
  if (!settings.weekendOn) return "Víkendový článek se ještě nepsal.";
  const made = madeLinks({ articleId: settings.weekendArticleId, proposalId: settings.weekendProposalId });
  return `Naposledy na dny od ${esc(formatShort(settings.weekendOn))}: ${esc(settings.weekendNote)}${made.length ? ` ${made.join(" · ")}` : ""}`;
}

// Kdy a na co Drběna napíše příští článek (svátky počítá src/okoli/outings.js).
function nextLine(settings, today = pragueNow().date) {
  const next = plannedOutings(settings, today).find((period) => period.write >= today && period.key !== settings.weekendOn);
  if (!next) return "";
  const holidays = next.holidays.map((holiday) => holiday.name).join(", ");
  const range = next.from === next.to ? czechDay(next.from) : `${czechDay(next.from)} až ${czechDay(next.to)}`;
  const when = settings.autoPublish ? ` (vyjde${atTime(settings.publishTime)})` : "";
  return `Příští článek: ${czechDay(next.write)}${when} na ${periodLabel(next)} ${range}${holidays ? ` (${holidays})` : ""}.`;
}

function statusPanel(data, settings) {
  const checked = settings.checkedAt ? `Naposledy načteno ${stamp(settings.checkedAt)}.` : "Ještě se nenačítalo.";
  const fetching = settings.enabled ? "Stahuje se automaticky." : "Stahuje se jen tlačítkem.";
  const weekly = settings.weekly || settings.autoVolno || settings.autoSvatek
    ? `Článek píše sama, ${settings.autoPublish ? `rovnou na web${atTime(settings.publishTime)}` : "jako návrh"}.`
    : "Víkendový článek je vypnutý.";
  const keyWarn = data.hasApiKey ? "" : callout("Chybí klíč pro Claude (<code>ANTHROPIC_API_KEY</code>), článek se nenapíše.", "warn");
  const busy = okoliRunning(settings) ? `<p class="status-sub">Drběna teď s akcemi pracuje.</p>` : "";
  return `<section class="panel status-panel">
    <div class="status-line">
      <span class="status-ico">${icon("clock")}</span>
      <div>
        <p class="status-main">${esc(checked)}</p>
        <p class="status-sub">${esc(fetching)} ${esc(weekly)} Okruh ${settings.radiusKm} km.</p>
      </div>
      <form method="post" action="${BASE}/nacist"><button class="btn btn-line" type="submit" data-busy="Stahuji akce…">Načíst akce teď</button></form>
    </div>
    ${settings.note ? (settings.status === "ok" ? `<p class="status-sub">${esc(settings.note)}</p>` : callout(esc(settings.note), settings.status === "error" ? "bad" : "warn")) : ""}
    <div class="status-line">
      <span class="status-ico">${icon("pen")}</span>
      <div><p class="status-sub">${weekendLine(settings)}</p><p class="status-sub">${esc(nextLine(settings))}</p></div>
      <a class="btn btn-line" href="${BASE}?napsat=1" data-open="napsat">Napsat článek</a>
    </div>
    ${busy}${keyWarn}
  </section>`;
}

function sourceItem(source, radiusKm) {
  const out = source.km > radiusKm;
  const relay = source.relay ? `Přes GitHub, ${source.seenAt ? `naposledy ${stamp(source.seenAt)}` : "zatím nic nepřišlo"}.` : "";
  return item({
    title: source.name,
    meta: esc(`${source.title} · ${source.town} · ${source.km} km · budoucích akcí ${source.upcoming}`),
    badges: [out && badge("mimo okruh", "warn"), relay && `<span class="item-sub">${esc(relay)}</span>`].filter(Boolean).join(""),
    actions: `<a class="btn btn-sm btn-line" href="${esc(source.home)}" target="_blank" rel="noopener noreferrer">Web</a>`,
  });
}

function eventItem(event, radiusKm) {
  const when = `${czechDay(event.startsOn)}${event.startsTime ? ` ${event.startsTime}` : ""}`;
  return item({
    title: event.title,
    meta: esc([when, event.place, event.town].filter(Boolean).join(" · ")),
    badges: [
      badge(KIND_LABEL[event.kind] ?? ""),
      event.soldOut && badge("vyprodáno", "warn"),
      event.hidden && badge("schovaná"),
      event.km > radiusKm && badge("mimo okruh", "warn"),
    ]
      .filter(Boolean)
      .join(""),
    tone: event.hidden ? "off" : "",
    actions: `<a class="btn btn-sm btn-line" href="${esc(event.link)}" target="_blank" rel="noopener noreferrer">Web</a>${postButton(
      `${BASE}/schovat`,
      { id: event.id, kind: event.hidden ? "ukazat" : "schovat" },
      event.hidden ? "Vrátit" : "Schovat",
      "btn-ghost",
    )}`,
  });
}

// Ruční článek na vybrané dny, předvyplněné nejbližším obdobím. Plánovaný článek tím nepřijde.
function writeForm(today = pragueNow().date) {
  const next = outingFor(today);
  const limits = `min="${today}" max="${shiftDay(today, MANUAL_MAX_DAYS)}"`;
  return `<form class="form" method="post" action="${BASE}/napsat">
    ${field("Od", `<input class="${input}" type="date" name="od" required ${limits} value="${next.from}">`)}
    ${field("Do", `<input class="${input}" type="date" name="do" required ${limits} value="${next.to}">`, `Nejvýš ${MANUAL_MAX_DAYS} dní dopředu. Svátky v těch dnech Drběna najde sama a zmíní je.`)}
    <p class="hint">Plánovaný článek vyjde i tak, ruční se mezi napsané nepočítá. Psaní trvá asi minutu.</p>
    <div class="form-foot">${cancelLink(BASE)}<span class="form-foot-gap"></span><button class="btn btn-primary" type="submit" data-busy="Drběna píše, trvá to asi minutu…">Napsat</button></div>
  </form>`;
}

export function adminOkoli(ctx, data, message, query = {}) {
  const okoli = data.okoli ?? { settings: { radiusKm: 25 }, sources: [], events: [] };
  const { settings } = okoli;
  const body = `${pageHead(
    "Akce v okolí",
    "Koza Drběna stahuje program akcí z webů v okolí a před víkendem nebo svátkem z nich a z kalendáře drbny napíše článek, kam vyrazit. Akci, kterou do článku nechcete, schovejte.",
    `<a class="btn btn-line" href="${BASE}?nastaveni=1" data-open="nastaveni">Nastavení</a>`,
  )}
    ${statusPanel(data, settings)}
    ${panel({ id: "zdroje", title: "Zdroje", count: okoli.sources.length, body: list(okoli.sources.map((source) => sourceItem(source, settings.radiusKm)), "Žádný zdroj.") })}
    ${panel({
      id: "akce-okoli",
      title: "Akce na příští čtyři týdny",
      count: okoli.events.length,
      filter: okoli.events.length > 6 ? "Hledat v akcích…" : "",
      body: list(okoli.events.map((event) => eventItem(event, settings.radiusKm)), "Zatím žádné akce. Klikněte na Načíst akce teď."),
    })}
    ${modal({ id: "nastaveni", title: "Nastavení", size: "wide", close: BASE, open: Boolean(query.importSettings), body: settingsForm(settings) })}
    ${modal({ id: "napsat", title: "Napsat článek Kam vyrazit", close: BASE, open: Boolean(query.okoliWrite), body: writeForm() })}`;
  return adminShell(ctx, data, "okoli", message, body, { title: "Akce v okolí" });
}
