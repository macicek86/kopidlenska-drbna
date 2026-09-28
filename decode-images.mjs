import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, "images");

function payload(name) {
  const whole = join(dir, `${name}.b64`);
  if (existsSync(whole)) return readFileSync(whole, "utf8");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((file) => file.startsWith(`${name}.b64.part`))
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("");
}

for (const name of ["kozel-maskot.webp", "kozel-popelar.webp"]) {
  const to = join(root, "public", name);
  if (existsSync(to)) continue;
  const body = payload(name).replace(/\s/g, "");
  if (!body) continue;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, Buffer.from(body, "base64"));
}
