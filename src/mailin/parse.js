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

// Ověření odesílatele: hlavička, kterou e-mailu přidá Cloudflare při příjmu (DMARC nebo DKIM pro doménu z „Od“).
// Bere se jen hlavička nad první hlavičkou Received: tu nahoru přidává přijímající server a odesílatel ji
// podvrhnout nemůže, kdežto hlavičky níž mohl napsat kdokoli. Když ji Cloudflare nepřidá, e-mail je neověřený
// a změny z něj jdou ke schválení.
export function authVerdict(headers, fromEmail) {
  const fromDomain = domainOf(fromEmail);
  const lines = [];
  for (const header of headers ?? []) {
    const key = String(header.key ?? "").toLowerCase();
    if (key === "received") break;
    if ((key === "authentication-results" || key === "arc-authentication-results") && /cloudflare/i.test(header.value)) lines.push(String(header.value));
  }
  for (const line of lines) {
    const dmarc = /\bdmarc=pass\b[^;]*?header\.from=([^\s;]+)/i.exec(line);
    if (dmarc && sameDomain(dmarc[1], fromDomain)) return { verified: true, auth: line };
    for (const dkim of line.matchAll(/\bdkim=pass\b[^;]*?header\.d=([^\s;]+)/gi)) {
      if (sameDomain(dkim[1], fromDomain)) return { verified: true, auth: line };
    }
  }
  return { verified: false, auth: lines[0] ?? "" };
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
