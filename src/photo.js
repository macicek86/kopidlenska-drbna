// Fotka u zprávy: bod, který má zůstat vidět při ořezu, a popisek pod fotkou.
import { esc, mediaUrl } from "./html.js";

const CAPTION_MAX = 200;

function tenth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, Math.round(number / 10) * 10));
}

// Bod výřezu je „x y“ v procentech, po desítkách. Prázdný znamená střed.
export function readFocus(value) {
  const parts = String(value ?? "").trim().split(/\s+/);
  if (parts.length !== 2) return "";
  const x = tenth(parts[0]);
  const y = tenth(parts[1]);
  if (x === null || y === null) return "";
  return `${x} ${y}`;
}

export function readCaption(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, CAPTION_MAX);
}

// CSP nepustí inline styl, proto bod výřezu nesou třídy fx-0…fx-10 a fy-0…fy-10.
export function focusClass(focus) {
  const clean = readFocus(focus);
  if (!clean) return "";
  const [x, y] = clean.split(" ").map((part) => Number(part) / 10);
  return `fx-${x} fy-${y}`;
}

export function storyPhoto(article, className) {
  if (!article.imageKey) return "";
  const classes = [className, focusClass(article.imageFocus)].filter(Boolean).join(" ");
  return `<img class="${classes}" src="${mediaUrl(article.imageKey)}" alt="" loading="lazy">`;
}

const LICENSE = /\bCC(0|[ -]BY(?:-(?:SA|NC|ND|NC-SA|NC-ND))?[ -](\d\.\d))\b/g;

// Název licence Creative Commons v popisku odkáže na její znění, jak licence vyžaduje.
export function captionHtml(caption) {
  return esc(readCaption(caption)).replace(LICENSE, (label, kind, version) => {
    const href =
      kind === "0"
        ? "https://creativecommons.org/publicdomain/zero/1.0/deed.cs"
        : `https://creativecommons.org/licenses/${kind.slice(1, -version.length - 1).toLowerCase()}/${version}/deed.cs`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
}

// V detailu se fotka nikdy neořezává. Fotka na výšku je užší a má kolem sebe podklad.
export function articleFigure(article) {
  if (!article.imageKey) return "";
  const caption = readCaption(article.imageCaption);
  return `<figure class="article-figure">
        <div class="article-frame"><img class="article-photo" src="${mediaUrl(article.imageKey)}" alt="${esc(caption)}"></div>
        ${caption ? `<figcaption>${captionHtml(caption)}</figcaption>` : ""}
      </figure>`;
}
