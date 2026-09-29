export const PANEL_EDGE = 960;
export const PANEL_BYTES = 180_000;

export const AD_SEEDS = [
  {
    slug: "cerstvy-chleb-v-sobotu",
    title: "Čerstvý chléb v sobotu",
    body: "Čerstvý chléb a koláče v sobotu od sedmi. Vezměte si tašku.",
    place: "Hilmarovo náměstí",
    image: "chleb.webp",
  },
  {
    slug: "serizeni-kola",
    title: "Seřízení kola",
    body: "Před sezónou srovnám brzdy a přehazovačku. Napište si dopředu, ať na vás vyjde den.",
    place: "Mlýnec",
    image: "kolo.webp",
  },
  {
    slug: "sazenicky-za-skolou",
    title: "Sazeničky za školou",
    body: "O víkendu dávám přebytky rajčat a bylinek. Stavte se dopoledne.",
    place: "Drahoraz",
    image: "sazenicky.webp",
  },
  {
    slug: "zebrik-a-kolecko",
    title: "Žebřík a kolečko",
    body: "Půjčím žebřík a kolečko, když zrovna nestavím. Stačí se domluvit.",
    place: "Pševes",
    image: "zebrik.webp",
  },
];

function plain(value, max) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function safeAdLink(raw) {
  let value = String(raw ?? "")
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, "");
  if (!value) return "";
  if (value.length > 240) return { error: "Odkaz je moc dlouhý." };
  if (/\s/.test(value)) return { error: "Odkaz nesmí mít mezeru." };
  if (/^www\./i.test(value)) value = `https://${value}`;
  if (/^https:\/\//i.test(value) || /^http:\/\//i.test(value)) return value;
  if (/^mailto:/i.test(value) && !/[<>"]/.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !value.includes(":")) return value;
  return { error: "Odkaz musí začínat na https://, http://, mailto: nebo /." };
}

export function readAdFields(input) {
  const title = plain(input?.title, 80);
  const body = plain(input?.body, 320);
  const place = plain(input?.place, 80);
  if (title.length < 2) return { error: "Doplňte název." };
  if (body.length < 2) return { error: "Doplňte text nabídky." };
  const link = safeAdLink(input?.link);
  if (link && typeof link === "object") return link;
  return { title, body, place, link, enabled: Boolean(input?.enabled) };
}

export const AD_SEEN_COOKIE = "drbna_reklama";

function randomUnit() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 4294967296;
}

export function readSeenAd(cookieHeader) {
  const raw = String(cookieHeader ?? "");
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== AD_SEEN_COOKIE) continue;
    const id = Number(decodeURIComponent(rest.join("=")));
    return Number.isInteger(id) && id > 0 ? id : null;
  }
  return null;
}

export function seenAdCookie(id, secure) {
  const parts = [`${AD_SEEN_COOKIE}=${encodeURIComponent(String(id))}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=604800"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function pickAd(ads, options = {}) {
  const list = [...(ads ?? [])]
    .filter((item) => item && item.id != null)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!list.length) return null;
  let pool = list;
  const avoidId = Number(options.avoidId);
  if (list.length > 1 && Number.isInteger(avoidId)) {
    const rest = list.filter((item) => Number(item.id) !== avoidId);
    if (rest.length) pool = rest;
  }
  const roll = Number(typeof options.random === "function" ? options.random() : randomUnit());
  const unit = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999999999) : randomUnit();
  return pool[Math.floor(unit * pool.length)];
}
