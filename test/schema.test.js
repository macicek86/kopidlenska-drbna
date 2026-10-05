import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SCHEMA_VERSION } from "../src/schema.js";

// Otisk migrací. Když test spadne: zvedni SCHEMA_VERSION v src/schema.js a sem napiš novou verzi a otisk,
// jinak produkce migraci nespustí (databáze se starší verzí ji nespustí, novější verzi nikdo nezapíše).
const KNOWN = { version: 29, fingerprint: "2c6c11cb81e17c27" };

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)]))
    .filter((file) => file.endsWith(".js"))
    .sort();
}

// Řetězce ze zdrojáku (bez komentářů), stačí na SQL v kódu.
function literals(text) {
  const found = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
    else if (ch === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 1;
    else if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      found.push(text.slice(i + 1, j));
      i = j;
    }
  }
  return found;
}

function fingerprint() {
  const hash = createHash("sha256");
  for (const file of sources("src")) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith("schema.js")) {
      hash.update(text.replace(/export const SCHEMA_VERSION = \d+;/, ""));
      continue;
    }
    // Ostatní moduly: všechny řetězce, které zakládají nebo mění tabulky a indexy. Soubor bez nich
    // otisk nemění, ať nový modul bez SQL test neshodí.
    const ddl = literals(text).filter((value) => /\b(?:create|alter)\s+(?:table|unique index|index)\b/i.test(value));
    if (ddl.length) hash.update(`${file}\n${ddl.join("\n")}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

test("změna migrací zvedá verzi schématu", () => {
  const now = fingerprint();
  assert.equal(
    `${SCHEMA_VERSION} ${now}`,
    `${KNOWN.version} ${KNOWN.fingerprint}`,
    `Migrace se změnily: zvedni SCHEMA_VERSION v src/schema.js a v test/schema.test.js nastav version a fingerprint "${now}".`,
  );
});

function fakeDb(version) {
  const log = [];
  const statement = (sql) => ({
    bind() {
      return this;
    },
    async first() {
      log.push(sql);
      if (/from schema_version/.test(sql)) {
        if (version == null) throw new Error("no such table: schema_version");
        return { version };
      }
      return /sqlite_master|from settings/.test(sql) ? { ok: 1 } : null;
    },
    async all() {
      log.push(sql);
      return { results: [] };
    },
    async run() {
      log.push(sql);
      return { meta: { changes: 0 } };
    },
  });
  return { log, env: { DB: { prepare: statement } } };
}

test("sedící verze schématu stojí jeden dotaz", async () => {
  const { ensureSchema } = await import(`../src/schema.js?sedi`);
  const { env, log } = fakeDb(SCHEMA_VERSION);
  await ensureSchema(env);
  await ensureSchema(env);
  assert.equal(log.length, 1);
});

test("bez verze se migruje a verze se zapíše", async () => {
  const { ensureSchema } = await import(`../src/schema.js?nova`);
  const { env, log } = fakeDb(null);
  await ensureSchema(env);
  assert.ok(log.length > 50);
  assert.ok(log.some((sql) => /insert into schema_version/.test(sql)));
  const after = log.length;
  await ensureSchema(env);
  assert.equal(log.length, after);
});

test("starší verze spustí migraci", async () => {
  const { ensureSchema } = await import(`../src/schema.js?starsi`);
  const { env, log } = fakeDb(SCHEMA_VERSION - 1);
  await ensureSchema(env);
  assert.ok(log.some((sql) => /create table if not exists users/.test(sql)));
});
