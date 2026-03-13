import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(packageRoot, "src", "storage", "migrations");
const distDir = path.join(packageRoot, "dist", "storage", "migrations");

fs.mkdirSync(distDir, { recursive: true });

for (const entry of fs.readdirSync(srcDir)) {
  if (!entry.endsWith(".sql")) continue;
  fs.copyFileSync(path.join(srcDir, entry), path.join(distDir, entry));
}
