// Redakce: Statistiky návštěv. Vidí je hlavní redaktor a kdo má oprávnění Statistiky.
import { formatDayMonth } from "../format.js";
import { esc } from "../view.js";
import { STAT_PERIODS } from "../visits-db.js";
import { adminShell } from "./shell.js";
import { callout, icon, pageHead, panel } from "./ui.js";

const BASE = "/redakce/statistiky";

const PAGE_NAMES = {
  "/": "Titulka",
  "/zpravy": "Zprávy",
  "/akce": "Akce",
  "/popelnice": "Popelnice",
  "/odstavky": "Odstávky",
  "/lekari": "Lékaři",
  "/oteviraci-doba": "Otevírací doba",
  "/sberne-dvory": "Sběrné dvory",
  "/reklamy": "Reklamy",
  "/o-nas": "O nás",
};

const number = (value) => Number(value).toLocaleString("cs-CZ");

function tile(glyph, value, label) {
  return `<div class="stat">${icon(glyph)}<b>${esc(number(value))}</b><span>${esc(label)}</span></div>`;
}

function perDay(totals) {
  return totals.days ? Math.round(totals.visitors / totals.days) : 0;
}

function pageName(row) {
  if (row.title) return row.title;
  return PAGE_NAMES[row.path] ?? row.path;
}

// Sloupce po dnech: celé zobrazení světlé, návštěvníci tmavě přes ně. SVG bez stylů, CSP ho pustí.
export function visitChart(days) {
  const width = 720;
  const height = 180;
  const top = Math.max(1, ...days.map((row) => row.views));
  const step = width / Math.max(1, days.length);
  const bar = Math.max(2, step * 0.72);
  const scale = (value) => Math.round((value / top) * (height - 4));
  const bars = days
    .map((row, index) => {
      const x = (index * step + (step - bar) / 2).toFixed(1);
      const views = scale(row.views);
      const visitors = scale(row.visitors);
      return `<g><title>${esc(`${formatDayMonth(row.day)}: návštěvníci ${number(row.visitors)}, zobrazení ${number(row.views)}`)}</title>
        <rect class="chart-views" x="${x}" y="${height - views}" width="${bar.toFixed(1)}" height="${views}" rx="1.5"/>
        <rect class="chart-visitors" x="${x}" y="${height - visitors}" width="${bar.toFixed(1)}" height="${visitors}" rx="1.5"/></g>`;
    })
    .join("");
  const first = days[0]?.day ?? "";
  const last = days.at(-1)?.day ?? "";
  return `<figure class="visit-chart">
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Návštěvy po dnech, nejvíc ${esc(number(top))} zobrazení za den">${bars}</svg>
    <figcaption><span>${esc(formatDayMonth(first))}</span>
      <span class="chart-key"><i class="key-visitors"></i>návštěvníci <i class="key-views"></i>zobrazení</span>
      <span>${esc(formatDayMonth(last))}</span></figcaption>
  </figure>`;
}

function ranking(rows, label, value, emptyText) {
  if (!rows.length) return `<p class="empty">${esc(emptyText)}</p>`;
  const top = Math.max(1, ...rows.map(value));
  return `<ol class="ranking">${rows
    .map(
      (row) => `<li><span class="ranking-name">${label(row)}</span><b>${esc(number(value(row)))}</b>
        <meter min="0" max="${top}" value="${value(row)}"></meter></li>`,
    )
    .join("")}</ol>`;
}

function periodLinks(period) {
  return `<nav class="period" aria-label="Období">${STAT_PERIODS.map(
    (days) =>
      `<a class="btn btn-sm ${days === period ? "btn-primary" : "btn-line"}" href="${BASE}?obdobi=${days}"${
        days === period ? ' aria-current="page"' : ""
      }>${days} dní</a>`,
  ).join("")}</nav>`;
}

export function adminStats(ctx, data, message) {
  const stats = data.stats;
  const inner = `
    ${pageHead(
      "Statistiky",
      "Návštěvy veřejné části webu. Nepočítá se redakce ani roboti a nic se neukládá o konkrétních lidech: návštěvníka poznáme jen po dobu jednoho dne.",
      periodLinks(stats.period),
    )}
    <div class="stats">
      ${tile("user", stats.todayTotals.visitors, `návštěvníci dnes · ${number(stats.todayTotals.views)} zobrazení`)}
      ${tile("user", stats.yesterdayTotals.visitors, `návštěvníci včera · ${number(stats.yesterdayTotals.views)} zobrazení`)}
      ${tile("calendar", perDay(stats.week), `návštěvníků denně za 7 dní · ${number(stats.week.views)} zobrazení`)}
      ${tile("calendar", perDay(stats.month), `návštěvníků denně za 30 dní · ${number(stats.month.views)} zobrazení`)}
    </div>
    ${panel({
      title: `Posledních ${stats.period} dní`,
      body: stats.periodTotals.views
        ? visitChart(stats.chart)
        : callout("Zatím tu nic není. Čísla naskočí, jakmile web někdo otevře."),
    })}
    <div class="cards-2">
      ${panel({
        title: "Nejčtenější",
        id: "stranky",
        body: ranking(
          stats.pages,
          (row) => `<a href="${esc(row.path)}" target="_blank" rel="noopener">${esc(pageName(row))}</a>`,
          (row) => row.views,
          "Za tohle období nic.",
        ),
      })}
      ${panel({
        title: "Odkud lidé přišli",
        id: "zdroje",
        body: `${ranking(stats.sources, (row) => esc(row.source), (row) => row.visitors, "Za tohle období nic.")}
          <p class="hint">Počítá se jednou za den podle stránky, kterou člověk otevřel jako první. „Přímo“ je adresa napsaná ručně, záložka nebo odkaz z aplikace, která neprozradí, odkud je.</p>`,
      })}
    </div>`;
  return adminShell(ctx, data, "statistiky", message, inner, { title: "Statistiky" });
}
