import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const placeholder = "00000000-0000-4000-8000-000000000001";
const dbName = "kopidlenska-drbna";
const bucket = "kopidlenska-drbna";

function run(args, { allowFail = false } = {}) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { cwd: root, encoding: "utf8" });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (text.trim()) process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  if (!allowFail && result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return { code: result.status ?? 1, text };
}

function uuidFrom(text) {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
}

const tomlPath = join(root, "wrangler.toml");
let toml = readFileSync(tomlPath, "utf8");

if (toml.includes(placeholder)) {
  console.log("Zakládám databázi D1…");
  let created = run(["d1", "create", dbName], { allowFail: true });
  let id = created.code === 0 ? uuidFrom(created.text) : null;
  if (!id) {
    console.log("Databáze už asi existuje, beru ji ze seznamu…");
    const listed = run(["d1", "list", "--json"], { allowFail: true });
    const start = listed.text.indexOf("[");
    if (start >= 0) {
      const rows = JSON.parse(listed.text.slice(start));
      const row = rows.find((item) => item.name === dbName || item.database_name === dbName);
      id = row?.uuid || row?.database_id || null;
    }
  }
  if (!id || id === placeholder) {
    console.error("Nepodařilo se zjistit id databáze. Jsi přihlášený? Spusť nejdřív: npx wrangler login");
    process.exit(1);
  }
  toml = toml.replaceAll(placeholder, id);
  writeFileSync(tomlPath, toml);
  console.log(`D1 je ${dbName} (${id}).`);
}

console.log("Zakládám R2 bucket…");
const bucketResult = run(["r2", "bucket", "create", bucket], { allowFail: true });
if (bucketResult.code !== 0 && !/already exists|already owned/i.test(bucketResult.text)) {
  process.exit(bucketResult.code);
}

console.log("Zakládám index pro hledání podle významu (Vectorize)…");
const vectorsResult = run(["vectorize", "create", "kopidlenska-drbna-zpravy", "--dimensions=1024", "--metric=cosine"], { allowFail: true });
if (vectorsResult.code !== 0 && !/already exists|duplicate/i.test(vectorsResult.text)) {
  process.exit(vectorsResult.code);
}

console.log("Zakládám frontu úloh (Queues)…");
const queueResult = run(["queues", "create", "kopidlenska-drbna-ukoly"], { allowFail: true });
if (queueResult.code !== 0 && !/already exists|already taken|11009/i.test(queueResult.text)) {
  process.exit(queueResult.code);
}

console.log("Nahrávám schéma a výchozí texty…");
run(["d1", "execute", dbName, "--remote", "--file=./schema.sql"]);

// Do redakce se přihlašuje kódem z e-mailu: hlavní redaktor potřebuje e-mail, jinak se nikdo nepřihlásí.
const chief = run(["d1", "execute", dbName, "--remote", "--json", "--command", "select email from users where role = 'hlavni' limit 1"], { allowFail: true });
if (!/"email":\s*"[^"]+@/.test(chief.text)) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let email = "";
  while (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) {
    email = (await prompt.question("E-mail hlavního redaktora (na něj přijde kód pro přihlášení): ")).trim().toLowerCase();
  }
  prompt.close();
  run(["d1", "execute", dbName, "--remote", "--command", `update users set email = '${email}' where role = 'hlavni'`]);
}

console.log("Nasazuji Worker…");
run(["deploy"]);
console.log("Hotovo. Redakce je na /redakce: zadej e-mail hlavního redaktora a přijde kód.");
console.log("Kód chodí přes Cloudflare Email Service, doména musí být přidaná pro odesílání (NAVOD-PRIHLASENI.md).");
