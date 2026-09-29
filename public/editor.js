const MAX_EDGE = 1600;
const MAX_BYTES = 500_000;
const START_QUALITY = 0.82;

function photoLimits(input) {
  const edge = Number(input.dataset.edge);
  const bytes = Number(input.dataset.bytes);
  return {
    edge: Number.isInteger(edge) && edge >= 320 && edge <= MAX_EDGE ? edge : MAX_EDGE,
    bytes: Number.isInteger(bytes) && bytes >= 40_000 && bytes <= MAX_BYTES ? bytes : MAX_BYTES,
  };
}

for (const form of document.querySelectorAll("form")) {
  const fileInput = form.querySelector('input[type="file"][name="image"]');
  if (!fileInput) continue;
  let ready = false;
  form.addEventListener("submit", async (event) => {
    if (ready) return;
    const input = fileInput;
    const file = input.files?.[0];
    if (!file || file.size === 0) return;
    const limits = photoLimits(input);
    if (file.type === "image/webp" && file.size <= limits.bytes) {
      const small = await edgeOf(file);
      if (small !== null && small <= limits.edge) return;
    }
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const previous = button?.textContent ?? "";
    if (button) {
      button.disabled = true;
      button.textContent = "Zmenšuji fotku…";
    }
    try {
      const next = await toWebp(file, photoLimits(input));
      const transfer = new DataTransfer();
      transfer.items.add(next);
      input.files = transfer.files;
      ready = true;
      if (button) button.disabled = false;
      form.requestSubmit();
    } catch (error) {
      ready = false;
      if (button) {
        button.disabled = false;
        button.textContent = previous;
      }
      window.alert(error instanceof Error ? error.message : "Fotku se nepodařilo zmenšit.");
    }
  });
}

async function edgeOf(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const edge = Math.max(bitmap.width, bitmap.height);
    bitmap.close?.();
    return edge;
  } catch {
    return null;
  }
}

async function toWebp(file, limits) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, limits.edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    bitmap.close?.();
    throw new Error("Tenhle prohlížeč fotku neumí zmenšit.");
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = START_QUALITY;
  let blob = await blobOf(canvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp") {
    throw new Error("Tenhle prohlížeč neumí uložit fotku jako WEBP.");
  }
  while (blob.size > limits.bytes && quality > 0.5) {
    quality = Math.round((quality - 0.1) * 10) / 10;
    const smaller = await blobOf(canvas, "image/webp", quality);
    if (!smaller) break;
    blob = smaller;
  }
  const name = file.name.replace(/\.[^.]+$/, "") || "fotka";
  return new File([blob], `${name}.webp`, { type: "image/webp", lastModified: Date.now() });
}

function blobOf(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

const RICH_INLINE = ["bold", "italic", "underline", "href", "strike"];
const RICH_CLEAR = [
  "heading1",
  "heading2",
  "quote",
  "bullet",
  "bulletList",
  "number",
  "numberList",
  "code",
  ...RICH_INLINE,
];
const RICH_SWAP = {
  heading1: ["heading2", "quote", "bullet", "bulletList", "number", "numberList", "code"],
  heading2: ["heading1", "quote", "bullet", "bulletList", "number", "numberList", "code"],
  quote: ["heading1", "heading2", "bullet", "bulletList", "number", "numberList", "code"],
  bullet: ["heading1", "heading2", "quote", "number", "numberList", "code"],
  number: ["heading1", "heading2", "quote", "bullet", "bulletList", "code"],
};
const RICH_LIMIT = 20000;
let richSeq = 0;

function safeRichHref(raw) {
  let value = String(raw ?? "").trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!value || /\s/.test(value)) return "";
  if (/^www\./i.test(value)) value = `https://${value}`;
  else if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#]|$)/i.test(value)) value = `https://${value}`;
  if (/^https:\/\//i.test(value) || /^http:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value) && !/[<>"]/.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes(":")) return value;
  return "";
}

function richSvg(body) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function richButton(label, title, extra, graphic) {
  return `<button type="button" class="trix-button" tabindex="-1" aria-label="${label}" title="${title}" ${extra}>${graphic}</button>`;
}

function richToolbarHtml() {
  const mark = (text) => `<span class="rich-mark">${text}</span>`;
  return `<div class="trix-button-row">
    <span class="trix-button-group" data-trix-button-group="text">
      ${richButton("Tučně", "Tučně (Ctrl+B)", 'data-trix-attribute="bold" data-trix-key="b"', mark("B"))}
      ${richButton("Kurzíva", "Kurzíva (Ctrl+I)", 'data-trix-attribute="italic" data-trix-key="i"', mark("I"))}
      ${richButton("Podtržení", "Podtržení (Ctrl+U)", 'data-trix-attribute="underline" data-trix-key="u"', mark("U"))}
      ${richButton("Odkaz", "Odkaz (Ctrl+K)", 'data-trix-attribute="href" data-trix-action="link" data-trix-key="k"', richSvg('<path d="M10 13a5 5 0 0 0 7.5.5l1-1a5 5 0 0 0-7-7L10 7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-1 1a5 5 0 0 0 7 7L14 17"/>'))}
      ${richButton("Bez formátu", "Zrušit formátování", 'data-drbna="clear"', richSvg('<path d="M5 18 12 4l7 14"/><path d="M8.2 13h7.6"/><path d="M16 17l4 4"/>'))}
    </span>
    <span class="trix-button-group" data-trix-button-group="history">
      ${richButton("Zpět", "Vrátit úpravu (Ctrl+Z)", 'data-trix-action="undo" data-trix-key="z"', richSvg('<path d="M9 14 5 10l4-4"/><path d="M5 10h8a6 6 0 1 1 0 12h-2"/>'))}
      ${richButton("Znovu", "Znovu (Ctrl+Shift+Z)", 'data-trix-action="redo" data-trix-key="shift+z"', richSvg('<path d="m15 14 4-4-4-4"/><path d="M19 10h-8a6 6 0 1 0 0 12h2"/>'))}
    </span>
  </div>
  <div class="trix-button-row">
    <span class="trix-button-group trix-button-group--block" data-trix-button-group="block">
      ${richButton("Nadpis", "Nadpis", 'data-trix-attribute="heading1"', mark("H2"))}
      ${richButton("Podnadpis", "Podnadpis", 'data-trix-attribute="heading2"', mark("H3"))}
      ${richButton("Citace", "Citace", 'data-trix-attribute="quote"', mark("„"))}
      ${richButton("Odrážky", "Odrážky", 'data-trix-attribute="bullet"', richSvg('<circle cx="5" cy="7" r="1.7" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.7" fill="currentColor" stroke="none"/><path d="M10 7h10M10 12h10M10 17h10" stroke-width="2.4"/>'))}
      ${richButton("Čísla", "Číslovaný seznam", 'data-trix-attribute="number"', mark("1."))}
      ${richButton("Míň odsazení", "Menší odsazení seznamu", 'data-trix-action="decreaseNestingLevel"', richSvg('<path d="M11 7h9M11 12h9M11 17h9"/><path d="M7 9 3 12l4 3"/>'))}
      ${richButton("Víc odsazení", "Větší odsazení seznamu", 'data-trix-action="increaseNestingLevel"', richSvg('<path d="M4 7h9M4 12h9M4 17h9"/><path d="m15 9 4 3-4 3"/>'))}
    </span>
  </div>
  <div class="trix-dialogs" data-trix-dialogs>
    <div class="trix-dialog trix-dialog--link" data-trix-dialog="href" data-trix-dialog-attribute="href">
      <div class="trix-dialog__link-fields">
        <input type="text" name="href" class="trix-input trix-input--dialog" placeholder="https://… nebo mailto:…" aria-label="Adresa odkazu" required data-trix-input>
        <div class="trix-button-group">
          <input type="button" class="trix-button trix-button--dialog" value="Vložit" data-trix-method="setAttribute">
          <input type="button" class="trix-button trix-button--dialog" value="Zrušit odkaz" data-trix-method="removeAttribute">
        </div>
      </div>
    </div>
  </div>`;
}

function preparePastedHtml(html) {
  return html
    .replace(/<(\/?)h1\b/gi, "<$1h2")
    .replace(/<(\/?)h[4-6]\b/gi, "<$1h3")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/?figure\b[^>]*>/gi, "");
}

function richHasText(html) {
  const plain = String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
  return plain.trim().length > 0;
}

function configureTrix() {
  const { blockAttributes, textAttributes, toolbar } = window.Trix.config;
  blockAttributes.default.tagName = "p";
  blockAttributes.heading1.tagName = "h2";
  blockAttributes.heading1.terminal = false;
  blockAttributes.heading2 = {
    tagName: "h3",
    terminal: false,
    breakOnReturn: true,
    group: false,
  };
  textAttributes.underline = { tagName: "u", inheritable: true };
  toolbar.getDefaultHTML = richToolbarHtml;
  document.addEventListener("trix-file-accept", (event) => event.preventDefault());
  document.addEventListener("trix-attachment-add", (event) => {
    event.target?.editor?.composition?.removeAttachment(event.attachment);
  });
  document.addEventListener("mousedown", onRichMouseDown, true);
  document.addEventListener("click", onRichClick, true);
  document.addEventListener("keydown", onRichKey, true);
}

function editorOf(node) {
  return node.closest(".rich")?.querySelector("trix-editor")?.editor ?? null;
}

function onRichMouseDown(event) {
  const clear = event.target.closest?.("[data-drbna='clear']");
  if (clear) {
    event.preventDefault();
    event.stopPropagation();
    const editor = editorOf(clear);
    if (!editor) return;
    editor.recordUndoEntry("Formát");
    for (const name of RICH_CLEAR) editor.deactivateAttribute(name);
    return;
  }

  const format = event.target.closest?.("trix-toolbar button[data-trix-attribute]");
  if (!format) return;
  const name = format.getAttribute("data-trix-attribute");
  const others = RICH_SWAP[name];
  if (!others) return;
  event.preventDefault();
  event.stopPropagation();
  const editor = editorOf(format);
  if (!editor) return;
  const turningOff = format.classList.contains("trix-active");
  editor.recordUndoEntry("Formát");
  if (turningOff) {
    editor.deactivateAttribute(name);
    return;
  }
  for (const other of others) editor.deactivateAttribute(other);
  editor.activateAttribute(name);
}

function closeLinkDialog(input) {
  const dialog = input.closest("[data-trix-dialog]");
  dialog?.removeAttribute("data-trix-active");
  dialog?.classList.remove("trix-active");
  input.setAttribute("disabled", "disabled");
  editorOf(input)?.deactivateAttribute("frozen");
}

function onRichClick(event) {
  const apply = event.target.closest?.("[data-trix-method='setAttribute']");
  if (!apply) return;
  const input = apply.closest("[data-trix-dialog]")?.querySelector("input[name='href']");
  if (!input) return;
  const href = safeRichHref(input.value);
  if (!href) {
    event.preventDefault();
    event.stopPropagation();
    closeLinkDialog(input);
    window.alert("Tahle adresa nejde vložit. Použijte https://, http://, mailto: nebo odkaz začínající na /.");
    return;
  }
  input.value = href;
}

function onRichKey(event) {
  if (event.key !== "Enter") return;
  const input = event.target.closest?.(".trix-input--dialog");
  if (!input) return;
  event.preventDefault();
  input.closest(".trix-dialog")?.querySelector("[data-trix-method='setAttribute']")?.click();
}

function mountRich(rich) {
  const source = rich.querySelector("textarea[name='body']");
  if (!source || rich.querySelector("trix-editor")) return;
  richSeq += 1;
  if (!source.id) source.id = `clanek-text-${richSeq}`;
  const editor = document.createElement("trix-editor");
  editor.setAttribute("input", source.id);
  editor.setAttribute("aria-label", "Text zprávy");
  editor.setAttribute("placeholder", "Text zprávy");
  editor.className = "rich-area";
  source.after(editor);

  let lastGood = source.value;
  let reverting = false;
  const markEmpty = () => editor.classList.toggle("is-empty", !richHasText(source.value));
  const keepLimit = () => {
    if (reverting) return;
    markEmpty();
    if (source.value.length <= RICH_LIMIT) {
      lastGood = source.value;
      return;
    }
    reverting = true;
    editor.editor.loadHTML(lastGood);
    reverting = false;
    markEmpty();
    window.alert("Text je moc dlouhý. Nevejde se víc než 20 000 znaků.");
  };
  editor.addEventListener("trix-change", keepLimit);
  editor.addEventListener("trix-initialize", markEmpty);
  editor.addEventListener(
    "paste",
    (event) => {
      const html = event.clipboardData?.getData("text/html") ?? "";
      if (!html) return;
      event.preventDefault();
      editor.editor.insertHTML(preparePastedHtml(html));
    },
    true,
  );
  editor.addEventListener("drop", (event) => {
    if ([...event.dataTransfer?.types ?? []].includes("Files")) event.preventDefault();
  });
  markEmpty();
}

function bootRich() {
  const fields = document.querySelectorAll(".rich");
  if (!fields.length) return;
  if (!window.Trix) {
    for (const rich of fields) {
      const source = rich.querySelector("textarea");
      if (source) source.hidden = false;
    }
    return;
  }
  configureTrix();
  for (const rich of fields) mountRich(rich);
}

function previewAdLink(raw) {
  let value = String(raw ?? "").trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!value || value.length > 240 || /\s/.test(value)) return "";
  if (/^www\./i.test(value)) value = `https://${value}`;
  if (/^https:\/\//i.test(value) || /^http:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value) && !/[<>"]/.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes(":")) return value;
  return "";
}

function bootAdPreview() {
  const form = document.querySelector("[data-ad-form]");
  if (!form) return;
  const panel = form.querySelector("[data-ad-preview]");
  if (!panel) return;
  const titleNode = panel.querySelector("[data-ad='title']");
  const bodyNode = panel.querySelector("[data-ad='body']");
  const placeNode = panel.querySelector("[data-ad='place']");
  const linkNode = panel.querySelector("[data-ad='link']");
  const photo = panel.querySelector("[data-ad='photo']");
  const linkNote = form.querySelector("[data-ad='link-note']");
  const offNote = form.querySelector("[data-ad='off']");
  const file = form.querySelector('input[type="file"][name="image"]');
  const originalSrc = photo?.getAttribute("src") ?? "";
  let objectUrl = "";

  const paintText = (node, value) => {
    if (!node) return;
    const empty = node.dataset.empty ?? "";
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    node.textContent = text || empty;
    node.classList.toggle("is-placeholder", !text && Boolean(empty));
  };

  const paint = () => {
    paintText(titleNode, form.querySelector("[name='title']")?.value ?? "");
    paintText(bodyNode, form.querySelector("[name='body']")?.value ?? "");
    const place = String(form.querySelector("[name='place']")?.value ?? "").replace(/\s+/g, " ").trim();
    if (placeNode) {
      placeNode.textContent = place;
      placeNode.hidden = !place;
    }
    const link = String(form.querySelector("[name='link']")?.value ?? "").trim();
    const shown = previewAdLink(link);
    if (linkNode) linkNode.hidden = !shown;
    if (linkNote) {
      linkNote.textContent = shown ? `Víc vede na ${shown}` : "Odkaz se na panel nedostane.";
      linkNote.hidden = !link;
    }
    const enabled = form.querySelector("[name='enabled']");
    if (offNote) offNote.hidden = !enabled || enabled.checked;
  };

  form.addEventListener("input", paint);
  form.addEventListener("change", paint);
  file?.addEventListener("change", () => {
    const next = file.files?.[0];
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    if (!photo) return;
    if (!next) {
      if (originalSrc) {
        photo.src = originalSrc;
        photo.hidden = false;
        panel.classList.add("has-photo");
      } else {
        photo.removeAttribute("src");
        photo.hidden = true;
        panel.classList.remove("has-photo");
      }
      paint();
      return;
    }
    objectUrl = URL.createObjectURL(next);
    photo.src = objectUrl;
    photo.hidden = false;
    panel.classList.add("has-photo");
  });
  paint();
}

bootRich();
bootAdPreview();
