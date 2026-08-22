import path from "node:path";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(packageRoot, "dist");

if (path.dirname(dist) !== packageRoot || path.basename(dist) !== "dist") {
  throw new Error("Refusing to clean an unexpected directory.");
}

rmSync(dist, { recursive: true, force: true });
