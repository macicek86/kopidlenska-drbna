// Fotky v R2: uložení nahrané fotky, úklid nepoužité a výdej na /media.

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function storeImage(env, file, folder = "clanky") {
  if (!(file instanceof File) || file.size === 0) return { key: null };
  if (file.size > 4 * 1024 * 1024) return { error: "Fotka může mít nejvýš 4 MB." };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { error: "Fotka musí být JPG, PNG, WEBP nebo GIF." };
  const prefix = ["reklamy", "knihovna", "prilohy"].includes(folder) ? folder : "clanky";
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return { key };
}

// Obrázek z cizího webu (třeba z Munipolisu). Vrací bajty a typ, nebo null, když to není rozumná fotka.
export async function fetchImage(url, { fetchImpl = fetch } = {}) {
  if (!/^https:\/\//i.test(String(url ?? ""))) return null;
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const type = String(response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES[type]) return null;
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 4 * 1024 * 1024) return null;
  return { bytes, type };
}

export async function storeImageBytes(env, image, folder = "clanky") {
  const key = `${folder === "prilohy" ? "prilohy" : "clanky"}/${crypto.randomUUID()}.${IMAGE_TYPES[image.type]}`;
  await env.BUCKET.put(key, image.bytes, { httpMetadata: { contentType: image.type } });
  return key;
}

// Smaže fotku z R2, když ji už nic nepoužívá. Fotky z knihovny sdílí víc zpráv, ty drží knihovna.
export async function releaseImage(env, key) {
  if (!key) return;
  const stock = await env.DB.prepare("select 1 as ok from stock_images where image_key = ?").bind(key).first();
  if (stock) return;
  const article = await env.DB.prepare("select 1 as ok from articles where image_key = ?").bind(key).first();
  if (article) return;
  const proposal = await env.DB.prepare("select 1 as ok from proposals where image_key = ?").bind(key).first();
  if (proposal) return;
  const ad = await env.DB.prepare("select 1 as ok from ads where image_key = ?").bind(key).first();
  if (ad) return;
  const adProposal = await env.DB.prepare("select 1 as ok from ad_proposals where image_key = ?").bind(key).first();
  if (adProposal) return;
  // Přílohy zprávy (src/attachments.js) drží JSON, ve kterém je klíč celý.
  const attached = await env.DB.prepare(
    "select 1 as ok from articles where instr(attachments, ?) > 0 union all select 1 from proposals where instr(attachments, ?) > 0 limit 1",
  )
    .bind(key, key)
    .first();
  if (attached) return;
  await env.BUCKET.delete(key);
}

export async function media(env, key) {
  if (!key || key.includes("..") || key.startsWith("/")) return null;
  return env.BUCKET.get(key);
}
