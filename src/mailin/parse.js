// Přijatý e-mail: odesílatel, předmět, čistý text bez citace předchozí zprávy a výsledek ověření odesílatele.
import PostalMime from "postal-mime";

// Kolik znaků textu jde dál (Drběně i do záznamu). Změna hodin se vejde do pár řádků.
const MAX_TEXT = 3000;

function plain(html) {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

// Odpověď na dřívější e-mail nese citaci a podpis. Drběna má číst jen to nové.
const QUOTE_START = [
  /^on .+wrote:\s*$/i,
  /^dne .+(napsal|napsala|napsal\(a\))\s*:?\s*$/i,
  /^-{2,}\s*(original message|původní zpráva|původní e-mail|forwarded message|přeposlaná zpráva)/i,
  /^(from|od):\s.+@/i,
];

export function freshText(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "--" || trimmed === "-- " || QUOTE_START.some((pattern) => pattern.test(trimmed))) break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line.replace(/\s+$/, ""));
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}

function domainOf(email) {
  return String(email ?? "").split("@").pop().toLowerCase();
}

function sameDomain(domain, fromDomain) {
  const d = String(domain ?? "").toLowerCase().replace(/[;,]$/, "");
  return Boolean(d) && (fromDomain === d || fromDomain.endsWith(`.${d}`));
}

// Ověření odesílatele: výsledek kontroly, který e-mailu při příjmu přidá Cloudflare (DMARC nebo DKIM pro doménu z „Od“).
// Cloudflare dává nahoru svůj blok: Received, ARC-*, Received-SPF, Authentication-Results. Bere se jen první
// Authentication-Results v e-mailu a jen když je od mx.cloudflare.net: odesílatel může vlastní napsat až pod něj.
// Další hlavičky (i se stejným jménem) se nečtou, mohl je podvrhnout. Neověřený e-mail jde ke schválení.
export function authVerdict(headers, fromEmail) {
  const fromDomain = domainOf(fromEmail);
  const first = (headers ?? []).find((header) => String(header.key ?? "").toLowerCase() === "authentication-results");
  const line = String(first?.value ?? "").replace(/\s+/g, " ").trim();
  if (!/^mx\.cloudflare\.net\s*;/i.test(line)) return { verified: false, auth: line };
  const dmarc = /\bdmarc=pass\b[^;]*?header\.from=([^\s;]+)/i.exec(line);
  if (dmarc && sameDomain(dmarc[1], fromDomain)) return { verified: true, auth: line };
  for (const dkim of line.matchAll(/\bdkim=pass\b[^;]*?header\.d=([^\s;]+)/gi)) {
    if (sameDomain(dkim[1], fromDomain)) return { verified: true, auth: line };
  }
  return { verified: false, auth: line };
}

// Když ověření neprojde: pořadí prvních hlaviček a všechno, co se týká ověření, ať jde ze záznamu
// v redakci poznat, kam a jak Cloudflare výsledek kontroly píše. `extra` jsou hlavičky z Workeru (message.headers).
export function authTrace(headers, extra = null) {
  const keys = (headers ?? []).slice(0, 14).map((header) => String(header.key).toLowerCase());
  const related = /authentication-results|received-spf|^cf-|^x-cf|spam/i;
  const lines = (headers ?? [])
    .filter((header) => related.test(String(header.key)))
    .map((header) => `${header.key}: ${String(header.value).replace(/\s+/g, " ").slice(0, 400)}`);
  const dkim = (headers ?? [])
    .filter((header) => String(header.key).toLowerCase() === "dkim-signature")
    .map((header) => `dkim-signature d=${/\bd=([^;\s]+)/.exec(header.value)?.[1] ?? "?"}`);
  const worker = [];
  if (extra && typeof extra.forEach === "function") {
    extra.forEach((value, key) => {
      if (related.test(key)) worker.push(`worker ${key}: ${String(value).replace(/\s+/g, " ").slice(0, 400)}`);
    });
  }
  return [`pořadí: ${keys.join(", ")}`, ...lines, ...dkim, ...worker].join("\n");
}

// Automatická odpověď (dovolená, nedoručitelnost, rozesílka): Drběna na ni neodpovídá, jinak by se točily dokola.
export function automatic(headers, fromEmail) {
  const get = (name) => (headers ?? []).find((header) => String(header.key).toLowerCase() === name)?.value ?? "";
  const auto = get("auto-submitted").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (/^(bulk|junk|list)$/i.test(get("precedence").trim())) return true;
  if (get("x-autoreply") || get("x-autorespond") || get("list-id")) return true;
  return /^(mailer-daemon|postmaster|no-?reply|noreply|bounce)/i.test(String(fromEmail ?? "").split("@")[0]);
}

export async function readMail(raw) {
  const email = await PostalMime.parse(raw);
  const from = String(email.from?.address ?? "").trim().toLowerCase();
  const body = email.text?.trim() ? email.text : plain(email.html);
  return {
    from,
    fromName: String(email.from?.name ?? "").trim(),
    subject: String(email.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    text: freshText(body),
    headers: email.headers ?? [],
    messageId: String(email.messageId ?? ""),
    references: String((email.headers ?? []).find((header) => String(header.key).toLowerCase() === "references")?.value ?? ""),
  };
}
