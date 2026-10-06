// Redakce: akce z okolí (programy kulturních domů a měst kolem Kopidla) a týdenní článek „Kam vyrazit“.
import { formatShort } from "../format.js";
import { okoliRunning } from "../okoli/store.js";
import { czechDay, outingsFrom } from "../okoli/outings.js";
import { periodLabel } from "../okoli/weekend.js";
import { pragueNow } from "../waste.js";
import { esc } from "../view.js";
import { madeLinks, stamp, VOICE_NOTE } from "./imports.js";
import { adminShell } from "./shell.js";
import { badge, callout, cancelLink, check, field, formFoot, icon, input, item, list, modal, pageHead, panel, postButton } from "./ui.js";

const BASE = "/redakce/okoli";
const KIND_LABEL = { divadlo: "divadlo", kino: "kino", akce: "akce" };

function settingsForm(settings) {
  return `<form class="form" method="post" action="${BASE}/ulozit">
    ${check("enabled", "1", settings.enabled, "Stahovat akce z okolí automaticky", "Drbna se na weby zdrojů podívá každé čtyři hodiny. Akce se na webu samy neukážou, jsou jen podkladem pro víkendový článek.")}
    ${check("weekly", "1", settings.weekly, "Psát článek Kam vyrazit na víkendy a svátky", "Drběna ho napíše v pátek ráno na pátek až neděli. Volno se svátkem (Velikonoce, prodloužený víkend) vezme celé a napíše den před ním, k samostatnému svátku uprostřed týdne napíše den předem krátký článek. Nejdřív akce v Kopidlně z kalendáře, pak výběr z okolí. Když se nic nekoná, článek nevyjde.")}
    ${check("autoPublish", "1", settings.autoPublish, "Článek rovnou zveřejnit", "Bez zaškrtnutí čeká jako návrh ke schválení.")}
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
  const next = outingsFrom(today).find((period) => period.write >= today && period.key !== settings.weekendOn);
  if (!next) return "";
  const holidays = next.holidays.map((holiday) => holiday.name).join(", ");
  const range = next.from === next.to ? czechDay(next.from) : `${czechDay(next.from)} až ${czechDay(next.to)}`;
  return `Příští článek: ${czechDay(next.write)} na ${periodLabel(next)} ${range}${holidays ? ` (${holidays})` : ""}.`;
}

function statusPanel(data, settings) {
  const checked = settings.checkedAt ? `Naposledy načteno ${stamp(settings.checkedAt)}.` : "Ještě se nenačítalo.";
  const fetching = settings.enabled ? "Stahuje se automaticky." : "Stahuje se jen tlačítkem.";
  const weekly = settings.weekly
    ? `Článek píše na víkendy a svátky, ${settings.autoPublish ? "rovnou na web" : "jako návrh"}.`
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
      <form method="post" action="${BASE}/napsat"><button class="btn btn-line" type="submit" data-busy="Drběna píše, trvá to asi minutu…">Napsat článek teď</button></form>
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
    ${modal({ id: "nastaveni", title: "Nastavení", size: "wide", close: BASE, open: Boolean(query.importSettings), body: settingsForm(settings) })}`;
  return adminShell(ctx, data, "okoli", message, body, { title: "Akce v okolí" });
}
