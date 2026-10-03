// Detail zprávy: text obtéká fotku. Když z odstavce pod fotku přeteče jen jeden řádek
// (dvě osiřelá slova přes celou šířku), odstavec zůstane celý vedle fotky (třída hug).
// Bez JS se nic nemění, text fotku jen obtéká.

function lineHeight(element) {
  const style = getComputedStyle(element);
  const value = Number.parseFloat(style.lineHeight);
  return Number.isFinite(value) ? value : Number.parseFloat(style.fontSize) * 1.5;
}

function hugOrphans(body) {
  const figure = body.querySelector(".article-figure");
  const blocks = body.querySelectorAll(".prose > :is(p, h2, h3)");
  blocks.forEach((block) => block.classList.remove("hug"));
  if (!figure || getComputedStyle(figure).float === "none") return;

  const box = figure.getBoundingClientRect();
  const floatEnd = box.bottom + Number.parseFloat(getComputedStyle(figure).marginBottom || "0");
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.top >= floatEnd) return;
    if (rect.bottom <= floatEnd) continue;
    // Řádky, které celé začínají až pod fotkou; ten, co začíná vedle ní, se nepočítá.
    const linesBelow = Math.floor((rect.bottom - floatEnd + 1) / lineHeight(block));
    if (linesBelow <= 1) block.classList.add("hug");
    return;
  }
}

function setup(body) {
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => hugOrphans(body));
  };
  update();
  body.querySelector(".article-photo")?.addEventListener("load", update);
  window.addEventListener("load", update);
  window.addEventListener("resize", update);
  document.fonts?.ready.then(update);
}

document.querySelectorAll(".article-body.has-photo").forEach(setup);
