// Zdroj zprávy a patička pod textem. Zdroj je v sloupci `source` u zprávy i návrhu, ne v textu.
// Zápis je obyčejný text: víc zdrojů oddělených čárkou, za názvem může být odkaz
// („Munipolis města Kopidlna https://…“, „facebook“, „KZMJ Jičín https://kzmj.cz/, MIC Jičín https://…“).
// Patička pod zprávou: odkaz na zprávu, na kterou navazuje (`follows_id`), zdroj a pozvánka na Facebook.
import { esc } from "./html.js";

export const SOURCE_MAX = 600;

const LINK = /^https?:\/\/\S+$/i;

// Hodnota z formuláře nebo z importu: jeden řádek, bez zbytečných mezer.
export function readSource(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SOURCE_MAX);
}

// Jeden zdroj z importu: název a odkaz (může chybět).
export function sourceEntry(label, url = "") {
  return readSource([label, url].filter(Boolean).join(" "));
}

export function sourceParts(text) {
  return readSource(text)
    .split(/,\s+/)
    .map((part) => {
      const words = part.trim().split(" ");
      const last = words.at(-1) ?? "";
      if (LINK.test(last)) return { label: words.slice(0, -1).join(" ").trim(), url: last };
      return { label: part.trim(), url: "" };
    })
    .filter((part) => part.label || part.url);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function partHtml({ label, url }) {
  if (!url) return esc(label);
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || hostOf(url))}</a>`;
}

// „Zdroj: …“ (víc zdrojů „Zdroje: …“), nebo prázdné.
export function sourceLine(text) {
  const parts = sourceParts(text);
  if (!parts.length) return "";
  return `${parts.length > 1 ? "Zdroje" : "Zdroj"}: ${parts.map(partHtml).join(", ")}`;
}

export function followsLine(slug) {
  if (!slug) return "";
  return `Kdo to minule propásl, <a href="/zpravy/${encodeURIComponent(slug)}">může si to přečíst tady</a>.`;
}

// Řádky patičky jako HTML odstavce (web i feed). `extra` jsou další hotové řádky (pozvánka na Facebook).
export function footLines(article, extra = []) {
  return [followsLine(article.followsSlug), sourceLine(article.source), ...extra].filter(Boolean);
}

export function articleFoot(article, extra = []) {
  const lines = footLines(article, extra);
  if (!lines.length) return "";
  return `<footer class="article-foot">${lines.map((line) => `<p>${line}</p>`).join("")}</footer>`;
}
