import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MCP_SERVER_VERSION } from "../dist/version.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);

assert.equal(
  MCP_SERVER_VERSION,
  packageJson.version,
  "MCP server metadata version must match package.json",
);
assert.equal(
  packageJson.repository?.url,
  "git+https://github.com/arunai30/share-html-mcp.git",
  "Published metadata must point to the public MCP repository",
);
assert.equal(
  packageJson.homepage,
  "https://github.com/arunai30/share-html-mcp#readme",
  "Published homepage must be publicly accessible",
);
assert.equal(
  packageJson.bugs?.url,
  "https://github.com/arunai30/share-html-mcp/issues",
  "Published issue tracker must be publicly accessible",
);

console.log(`Package metadata check passed for ${packageJson.name}@${packageJson.version}.`);
