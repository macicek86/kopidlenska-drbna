const MAX_EDGE = 1600;
const START_QUALITY = 0.82;

for (const form of document.querySelectorAll("form")) {
  const fileInput = form.querySelector('input[type="file"][name="image"]');
  if (!fileInput) continue;
  let ready = false;
  form.addEventListener("submit", async (event) => {
    if (ready) return;
    const input = fileInput;
    const file = input.files?.[0];
    if (!file || file.size === 0) return;
    if (file.type === "image/webp" && file.size <= 500_000) {
      const small = await edgeOf(file);
      if (small !== null && small <= MAX_EDGE) return;
    }
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const previous = button?.textContent ?? "";
    if (button) {
      button.disabled = true;
      button.textContent = "Zmenšuji fotku…";
    }
    try {
      const next = await toWebp(file);
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

async function toWebp(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
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
  while (blob.size > 500_000 && quality > 0.5) {
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

const RICH_DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "NOSCRIPT", "TEMPLATE", "SVG", "MATH", "TEXTAREA", "FORM", "LINK", "META"]);
const RICH_ALIAS = { B: "STRONG", I: "EM", H1: "H2", H4: "H3", H5: "H3", H6: "H3", DIV: "P" };
const RICH_ALLOWED = new Set(["P", "BR", "STRONG", "EM", "U", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "A"]);

function safeRichHref(raw) {
  let value = String(raw ?? "").trim().replace(/[\u0000-\u001F\u007F\s]/g, "");
  if (!value) return "";
  if (/^https:\/\//i.test(value) || /^http:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes(":")) return value;
  return "";
}

function cleanRich(node) {
  const fragment = document.createDocumentFragment();
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      fragment.append(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    if (RICH_DROP.has(child.tagName)) continue;
    const name = RICH_ALIAS[child.tagName] || child.tagName;
    if (!RICH_ALLOWED.has(name)) {
      fragment.append(cleanRich(child));
      continue;
    }
    if (name === "A") {
      const href = safeRichHref(child.getAttribute("href"));
      if (!href) {
        fragment.append(cleanRich(child));
        continue;
      }
      const link = document.createElement("a");
      link.setAttribute("href", href);
      link.append(cleanRich(child));
      fragment.append(link);
      continue;
    }
    const element = document.createElement(name.toLowerCase());
    if (name !== "BR") element.append(cleanRich(child));
    fragment.append(element);
  }
  return fragment;
}

function plainRichFragment(value) {
  const fragment = document.createDocumentFragment();
  const blocks = String(value ?? "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const paragraph = document.createElement("p");
    const lines = block.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) paragraph.append(document.createElement("br"));
      paragraph.append(document.createTextNode(line));
    });
    fragment.append(paragraph);
  }
  return fragment;
}

function looksRich(value) {
  return /<\/?[a-z][\s\S]*?>/i.test(value);
}

function htmlFromRich(area) {
  const holder = document.createElement("div");
  holder.append(cleanRich(area));
  return holder.innerHTML;
}

function fillRich(area, value) {
  area.replaceChildren();
  if (!value.trim()) return;
  if (looksRich(value)) {
    const parsed = new DOMParser().parseFromString(value, "text/html");
    area.append(cleanRich(parsed.body));
    return;
  }
  area.append(plainRichFragment(value));
}

function insertRich(fragment) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(fragment);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

for (const rich of document.querySelectorAll(".rich")) {
  const source = rich.querySelector("textarea");
  const area = rich.querySelector(".rich-area");
  const bar = rich.querySelector(".rich-bar");
  if (!source || !area || !bar) continue;
  fillRich(area, source.value);
  source.hidden = true;
  source.required = false;
  area.hidden = false;
  bar.hidden = false;
  document.execCommand("defaultParagraphSeparator", false, "p");

  bar.addEventListener("mousedown", (event) => {
    if (event.target.closest("button")) event.preventDefault();
  });
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-rich]");
    if (!button) return;
    area.focus();
    const command = button.dataset.rich;
    if (command === "bold") document.execCommand("bold");
    else if (command === "italic") document.execCommand("italic");
    else if (command === "underline") document.execCommand("underline");
    else if (command === "ul") document.execCommand("insertUnorderedList");
    else if (command === "ol") document.execCommand("insertOrderedList");
    else if (command === "h2" || command === "h3") document.execCommand("formatBlock", false, command);
    else if (command === "quote") document.execCommand("formatBlock", false, "blockquote");
    else if (command === "link") {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || range.collapsed) {
        window.alert("Nejdřív v textu označte slova, která mají být odkaz.");
        return;
      }
      const typed = window.prompt("Adresa odkazu. Začíná na https://, http:// nebo mailto:");
      if (!typed) return;
      const href = safeRichHref(typed);
      if (!href) {
        window.alert("Tahle adresa nejde vložit. Použijte https://, http:// nebo mailto:.");
        return;
      }
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("createLink", false, href);
    }
  });

  area.addEventListener("paste", (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html") ?? "";
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (html) {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      insertRich(cleanRich(parsed.body));
      return;
    }
    document.execCommand("insertText", false, text);
  });
  area.addEventListener("drop", (event) => event.preventDefault());

  source.form?.addEventListener(
    "submit",
    () => {
      source.value = htmlFromRich(area);
    },
    true,
  );
}
