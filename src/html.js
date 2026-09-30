// Drobné pomocníky pro skládání HTML. Používá je web i redakce.

const AMP = "\u0026amp;";
const LT = "\u0026lt;";
const GT = "\u0026gt;";
const QUOT = "\u0026quot;";

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT);
}

export function mediaUrl(key) {
  return `/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}
