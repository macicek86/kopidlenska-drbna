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
