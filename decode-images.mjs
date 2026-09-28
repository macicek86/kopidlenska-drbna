import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pairs = [
  ["images/kozel-maskot.webp.b64", "public/kozel-maskot.webp"],
  ["images/kozel-popelar.webp.b64", "public/kozel-popelar.webp"],
];

for (const [src, dest] of pairs) {
  const from = join(root, src);
  const to = join(root, dest);
  if (!existsSync(from) || existsSync(to)) continue;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, Buffer.from(readFileSync(from, "utf8").replace(/\s/g, ""), "base64"));
}
