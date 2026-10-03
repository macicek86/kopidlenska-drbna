// Fotka u zprávy v redakci: náhled výřezu a ťuknutí na místo, které má zůstat vidět.
// Bez JS se fotka nahraje taky, jen s výřezem na střed.

const STEP = 10;

function snap(value) {
  return Math.min(100, Math.max(0, Math.round(value / STEP) * STEP));
}

function parseFocus(value) {
  const [x, y] = String(value || "").trim().split(/\s+/).map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: snap(x), y: snap(y) };
}

function bootPick(field) {
  if (field.dataset.pickBound) return;
  field.dataset.pickBound = "1";
  const fileInput = field.querySelector('input[type="file"][name="image"]');
  const focusInput = field.querySelector("[data-photo-focus]");
  const pick = field.querySelector("[data-photo-pick]");
  const full = field.querySelector("[data-photo-full]");
  const dot = field.querySelector("[data-photo-dot]");
  const now = field.querySelector("[data-photo-now]");
  const images = [...field.querySelectorAll("[data-photo-src]")];
  // Výřez ukazují i náhledy mimo pole, třeba panel reklamy vedle formuláře.
  const crops = [...(field.closest("form") ?? field).querySelectorAll("[data-photo-crop]")];
  if (!fileInput || !focusInput || !pick || !full || !dot) return;

  let focus = parseFocus(focusInput.value) ?? { x: 50, y: 50 };
  let objectUrl = "";
  // Dokud autor sám neťukne, výřez se u nové fotky řídí jejím tvarem.
  let chosen = Boolean(parseFocus(focusInput.value));

  function paint() {
    dot.style.left = `${focus.x}%`;
    dot.style.top = `${focus.y}%`;
    for (const img of crops) img.style.objectPosition = `${focus.x}% ${focus.y}%`;
  }

  function setFocus(next, byHand) {
    focus = { x: snap(next.x), y: snap(next.y) };
    if (byHand) chosen = true;
    focusInput.value = chosen ? `${focus.x} ${focus.y}` : "";
    paint();
  }

  function show(src) {
    for (const img of images) img.src = src;
    pick.hidden = false;
    if (now) now.hidden = true;
    paint();
  }

  const current = field.dataset.current;
  if (current) show(current);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    chosen = false;
    const probe = new Image();
    probe.onload = () => {
      // Na fotkách na výšku bývají obličeje v horní třetině.
      const tall = probe.naturalHeight > probe.naturalWidth * 1.1;
      setFocus({ x: 50, y: tall ? 30 : 50 }, false);
      focusInput.value = `${focus.x} ${focus.y}`;
    };
    probe.src = objectUrl;
    show(objectUrl);
  });

  // Fotka z knihovny: náhled ukáže ji (výřez si nese z knihovny), „Nechat, jak je“ vrátí současnou.
  for (const radio of field.querySelectorAll('input[name="stock_id"]')) {
    radio.addEventListener("change", () => {
      const src = radio.closest(".stock-option")?.querySelector("img")?.src || current;
      if (src) show(src);
    });
  }

  full.addEventListener("click", (event) => {
    const box = full.querySelector("img")?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    setFocus(
      {
        x: ((event.clientX - box.left) / box.width) * 100,
        y: ((event.clientY - box.top) / box.height) * 100,
      },
      true,
    );
  });

  full.addEventListener("keydown", (event) => {
    const moves = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setFocus({ x: focus.x + move[0], y: focus.y + move[1] }, true);
  });
}

function bootPicks(root) {
  for (const field of root.querySelectorAll("[data-photo]")) bootPick(field);
}

bootPicks(document);
document.addEventListener("drbna:mount", (event) => bootPicks(event.target instanceof Element ? event.target : document));
