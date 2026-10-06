// Most pro zdroj akcí, který Cloudflare nepustí (kzmj.cz vrací Workerům 500). Běží na GitHubu
// (.github/workflows/okoli-relay.yml): zeptá se drbny, co už má, stáhne stejnou čtečkou jen nové a změněné
// akce a pošle je na /okoli/prijem (src/okoli/relay.js). Místně: OKOLI_RELAY_TOKEN=… node scripts/okoli-relay.mjs
import { fetchKzmj } from "../src/okoli/kzmj.js";

const SOURCES = { kzmj: fetchKzmj };
const base = (process.env.DRBNA_URL || "https://www.kopidlenskadrbna.org").replace(/\/+$/, "");
const token = process.env.OKOLI_RELAY_TOKEN;
if (!token) {
  console.error("Chybí OKOLI_RELAY_TOKEN.");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${token}` };

let failed = false;
for (const [tag, fetchEvents] of Object.entries(SOURCES)) {
  const address = `${base}/okoli/prijem?zdroj=${tag}`;
  const asked = await fetch(address, { headers });
  if (!asked.ok) {
    console.error(`${tag}: drbna odpověděla ${asked.status} ${await asked.text()}`);
    failed = true;
    continue;
  }
  const { known } = await asked.json();
  const feed = await fetchEvents({ known: new Map(Object.entries(known ?? {})) });
  if (!feed.ok) {
    console.error(`${tag}: ${feed.error}`);
    failed = true;
    continue;
  }
  const sent = await fetch(address, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ items: feed.items, listed: feed.listed, complete: feed.complete, warning: feed.warning }),
  });
  const result = await sent.text();
  if (!sent.ok) failed = true;
  const changed = feed.items.filter((item) => !item.unchanged).length;
  console.log(`${tag}: na webu ${feed.listed.length}, poslaných nových nebo změněných ${changed}${feed.warning ? `, ${feed.warning}` : ""} → ${sent.status} ${result}`);
}
process.exit(failed ? 1 : 0);
