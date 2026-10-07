// Snímky redakce v Chromu. Spusť `npm run nahled` a pak `npm run screens`.
// Přihlašuje se kódem z e-mailu; náhled běží s LOGIN_CODE_ECHO=1, takže kód je vidět na stránce.
// Obrázky jdou do .screens/ (desktop i mobil), ať je vidí každý, kdo na projektu dělá.
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.BASE ?? "http://127.0.0.1:8787";
const out = process.env.OUT ?? ".screens";
const email = process.env.EMAIL ?? "redakce@example.cz";
const only = process.argv.slice(2);

const TABS = [
  "prehled",
  "vzkazy",
  "statistiky",
  "zpravy",
  "rubriky",
  "reklamy",
  "akce",
  "munipolis",
  "fotbal",
  "denik",
  "skola",
  "zahradka",
  "webmesta",
  "okoli",
  "texty",
  "svoz",
  "dvory",
  "lekari",
  "oteviraci-doba",
  "emaily",
  "odstavky",
  "drbena",
  "chat",
  "odber",
  "lide",
  "historie",
  "stav",
  "ucet",
  // Otevřená okna. Název souboru je adresa bez lomítek.
  "chat?nastaveni=1",
  "skola?nastaveni=1",
  "skola?zprava=2",
  "zahradka?nastaveni=1",
  "webmesta?nastaveni=1",
  "okoli?nastaveni=1",
  "okoli?napsat=1",
  "zpravy?novy=1",
  "zpravy?id=1",
  "reklamy?novy=1",
  "akce?novy=1",
  "dvory?id=1",
  "dvory?uzavreni=1",
  "lekari?id=1",
  "lekari?zmena=1",
  "oteviraci-doba?zmena=1",
  "oteviraci-doba?nova-doba=1",
  "oteviraci-doba?sdilet=1",
  "emaily?id=1",
  "lide?novy=1",
  "rubriky?smazat=1",
  "munipolis?nastaveni=1",
  "munipolis?zprava=1",
  "fotbal?nastaveni=1",
  "fotbal?zprava=3",
  "denik?nastaveni=1",
  "odstavky?nove-oznameni=1",
  "odstavky?oznameni=1",
  "zpravy?navrh=1",
  "historie?zaznam=5",
];

function chromePath() {
  const known = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  return known.find((path) => path && existsSync(path));
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
const sizes = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobil", { width: 390, height: 844 }],
];
for (const [label, viewport] of sizes) {
  const context = await browser.newContext({ viewport, locale: "cs-CZ" });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(`[${label}] chyba na stránce:`, error.message));
  await page.goto(`${base}/redakce/zpravy`);
  await page.screenshot({ path: `${out}/${label}-prihlaseni.png`, fullPage: true });
  await page.fill("input[name=email]", email);
  await Promise.all([page.waitForURL(/kod=/), page.click("button[type=submit]")]);
  await page.screenshot({ path: `${out}/${label}-prihlaseni-kod.png`, fullPage: true });
  await page.fill("input[name=kod]", await page.textContent("[data-login-code]"));
  await Promise.all([page.waitForURL(/\/redakce\/zpravy$/), page.click("button[type=submit]")]);
  for (const tab of TABS) {
    if (only.length && !only.some((name) => tab.startsWith(name))) continue;
    await page.goto(`${base}/redakce/${tab}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);
    const file = `${out}/${label}-${tab.replace(/[?=&]/g, "-")}.png`;
    await page.screenshot({ path: file, fullPage: !tab.includes("?") });
  }
  await context.close();
}
await browser.close();
console.log(`snímky jsou v ${out}/`);
