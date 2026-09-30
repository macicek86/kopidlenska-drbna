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
  const prefix = folder === "reklamy" ? "reklamy" : "clanky";
  const key = `${prefix}/${crypto.randomUUID()}.${ext}`;
  await env.BUCKET.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });
  return { key };
}

export async function releaseImage(env, key) {
  if (!key) return;
  const article = await env.DB.prepare("select 1 as ok from articles where image_key = ?").bind(key).first();
  if (article) return;
  const proposal = await env.DB.prepare("select 1 as ok from proposals where image_key = ?").bind(key).first();
  if (proposal) return;
  const ad = await env.DB.prepare("select 1 as ok from ads where image_key = ?").bind(key).first();
  if (ad) return;
  const adProposal = await env.DB.prepare("select 1 as ok from ad_proposals where image_key = ?").bind(key).first();
  if (adProposal) return;
  await env.BUCKET.delete(key);
}

export async function media(env, key) {
  if (!key || key.includes("..") || key.startsWith("/")) return null;
  return env.BUCKET.get(key);
}
