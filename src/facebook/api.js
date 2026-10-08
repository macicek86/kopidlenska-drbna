// Jen Graph API: token v hlavičce, veřejné příspěvky vybrané Page. Bez stahování webu Facebooku.
export const GRAPH_VERSION = "v26.0";
export const POST_FIELDS = "id,message,created_time,permalink_url,is_published";
const GRAPH = "https://graph.facebook.com";
const MAX_PAGES = 2;
const PAGE_SIZE = 25;

export function pageIdentifier(value) {
  let text = String(value ?? "").trim();
  if (/^https?:\/\//i.test(text)) {
    let url;
    try { url = new URL(text); } catch { return ""; }
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) || url.username || url.password || url.port) return "";
    text = url.pathname === "/profile.php" ? url.searchParams.get("id") ?? "" : url.pathname.replace(/^\/+|\/+$/g, "");
  }
  if (!/^[a-z\d](?:[a-z\d.]{0,78}[a-z\d])?$/i.test(text) || /^(me|feed|posts|groups|reel|watch|search|pages|events)$/i.test(text)) return "";
  return text;
}

function errorText(code) {
  if (code === 190) return "Facebook nepřijal přístupový token. Správce musí zkontrolovat jeho platnost.";
  if ([4, 17, 32, 613].includes(code)) return "Facebook omezil počet požadavků. Zkuste načtení později.";
  if ([10, 100, 200].includes(code)) return "Facebook nepovolil čtení této Page. Zkontrolujte její ID, token a schválení Page Public Content Access. Před schválením testujte Page, kterou spravuje správce aplikace.";
  return "Facebook data neposkytl. Zkuste načtení později nebo zkontrolujte nastavení aplikace.";
}

async function graph(env, node, params, fetchImpl) {
  if (!env.FACEBOOK_ACCESS_TOKEN) return { ok: false, error: "Správce ještě nenastavil přístup k Facebooku." };
  const version = env.FACEBOOK_GRAPH_VERSION || GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) return { ok: false, error: "Verze Graph API není správně nastavená." };
  const url = new URL(`${GRAPH}/${version}/${node}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetchImpl(url.href, {
      headers: { Authorization: `Bearer ${env.FACEBOOK_ACCESS_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json();
    // Zpráva Meta může obsahovat citlivé údaje. Do UI a logů jde jen naše vlastní vysvětlení.
    if (!response.ok || data?.error) return { ok: false, error: errorText(Number(data?.error?.code)) };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Facebook se nepodařilo načíst. Zkuste to později." };
  }
}

export function publicPost(row, pageId) {
  if (!row || row.is_published !== true || !new RegExp(`^${pageId}_\\d+$`).test(String(row.id))) return null;
  const message = typeof row.message === "string" ? row.message.trim() : "";
  const at = Date.parse(row.created_time);
  if (!message || !Number.isFinite(at)) return null;
  let link;
  try { link = new URL(row.permalink_url); } catch { return null; }
  if (link.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(link.hostname) || link.username || link.password || link.port) return null;
  // Z URL ponecháme jen veřejný permalink. API token nikdy není součástí uloženého odkazu.
  if (link.searchParams.has("access_token") || link.href.length > 400) return null;
  return { postId: String(row.id), text: message.slice(0, 10_000), publishedAt: new Date(at).toISOString(), link: link.href };
}

export async function fetchPagePosts(env, identifier, { fetchImpl = fetch } = {}) {
  const key = pageIdentifier(identifier);
  if (!key) return { ok: false, error: "Zadejte ID Page nebo její přímý odkaz na Facebooku." };
  const page = await graph(env, key, { fields: "id,name,category" }, fetchImpl);
  if (!page.ok) return page;
  // category je pole Page; osobní profil ani /me nejsou povoleným zdrojem.
  if (!/^\d+$/.test(String(page.data?.id)) || !page.data?.name || typeof page.data.category !== "string") return { ok: false, error: "Zdroj se nepodařilo ověřit jako Facebook Page." };
  const pageId = String(page.data.id);
  const items = new Map();
  let after = "";
  const cursors = new Set();
  for (let n = 0; n < MAX_PAGES; n++) {
    const response = await graph(env, `${pageId}/posts`, { fields: POST_FIELDS, limit: String(PAGE_SIZE), ...(after ? { after } : {}) }, fetchImpl);
    if (!response.ok) return response;
    if (!Array.isArray(response.data?.data)) return { ok: false, error: "Facebook vrátil neúplný seznam příspěvků." };
    for (const row of response.data.data) {
      const item = publicPost(row, pageId);
      if (item) items.set(item.postId, item);
    }
    // paging.next se neotevírá: mohl by přenést token jinam. Použije se pouze kurzor na stejném Graph hostu.
    const next = response.data.paging?.cursors?.after;
    if (!response.data.paging?.next || typeof next !== "string" || !next || next.length > 1000 || cursors.has(next)) break;
    after = next;
    cursors.add(next);
  }
  return { ok: true, pageId, name: String(page.data.name).slice(0, 120), items: [...items.values()] };
}
