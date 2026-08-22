import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const integrationScript = path.join(packageRoot, "scripts/mock-integration.mjs");
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "share-html-release-"));
const npmCache = path.join(temporaryRoot, "npm-cache");
const npmUserConfig = path.join(temporaryRoot, "empty.npmrc");
writeFileSync(npmUserConfig, "");

function releaseEnvironment(extra = {}) {
  const allowedKeys = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ];
  return {
    ...Object.fromEntries(
      allowedKeys
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    NPM_CONFIG_CACHE: npmCache,
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    ...extra,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed.\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function pack(destination) {
  mkdirSync(destination, { recursive: true });
  const result = run(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    {
      env: releaseEnvironment(),
    },
  );
  const jsonStart = result.stdout.lastIndexOf("[\n  {");
  if (jsonStart < 0) throw new Error(`npm pack returned invalid JSON:\n${result.stdout}`);
  return JSON.parse(result.stdout.slice(jsonStart))[0];
}

try {
  const packageJson = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.repository?.url,
    "git+https://github.com/arunai30/share-html-mcp.git",
  );
  assert.equal(
    packageJson.homepage,
    "https://github.com/arunai30/share-html-mcp#readme",
  );
  assert.equal(
    packageJson.bugs?.url,
    "https://github.com/arunai30/share-html-mcp/issues",
  );
  assert.doesNotMatch(JSON.stringify(packageJson), /arunai30\/share-html\.git/);

  mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  writeFileSync(
    path.join(packageRoot, "dist/stale-release-check.txt"),
    "This file must be removed by prepack.\n",
  );

  const first = pack(path.join(temporaryRoot, "pack-one"));
  assert.deepEqual(
    first.files.map((file) => file.path).sort(),
    [
      "LICENSE",
      "README.md",
      "dist/api-client.d.ts",
      "dist/api-client.js",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/server.d.ts",
      "dist/server.js",
      "dist/version.d.ts",
      "dist/version.js",
      "package.json",
    ],
    "tarball contents differ from the release allowlist",
  );
  assert.equal(
    first.files.some((file) => file.path === "dist/stale-release-check.txt"),
    false,
    "prepack shipped a stale dist artifact",
  );
  const second = pack(path.join(temporaryRoot, "pack-two"));
  assert.equal(second.shasum, first.shasum, "independent tarballs were not reproducible");
  assert.equal(second.integrity, first.integrity);

  const cleanCwd = path.join(temporaryRoot, "clean-cwd");
  mkdirSync(cleanCwd);
  const tarball = path.join(temporaryRoot, "pack-one", first.filename);
  const integration = run(process.execPath, [integrationScript], {
    env: releaseEnvironment({
      SHARE_HTML_TEST_MCP_PACKAGE_SPEC: `file:${tarball}`,
      SHARE_HTML_TEST_MCP_CWD: cleanCwd,
    }),
  });
  process.stdout.write(integration.stdout);

  const consumerCwd = path.join(temporaryRoot, "consumer");
  mkdirSync(consumerCwd);
  writeFileSync(
    path.join(consumerCwd, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      tarball,
    ],
    { cwd: consumerCwd, env: releaseEnvironment() },
  );
  writeFileSync(
    path.join(consumerCwd, "consumer.ts"),
    [
      'import { createShareHtmlServer, type PageOperations } from "@aiformasses/mcp-server";',
      'import { ShareHtmlApiClient, ShareHtmlApiError } from "@aiformasses/mcp-server/client";',
      "declare const operations: PageOperations;",
      "createShareHtmlServer(operations);",
      'new ShareHtmlApiClient("https://api.example.com/api/v1", "shp_example");',
      "const error: ShareHtmlApiError | undefined = undefined;",
      "void error;",
    ].join("\n"),
  );
  writeFileSync(
    path.join(consumerCwd, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
      },
      include: ["consumer.ts"],
    }),
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'await import("@aiformasses/mcp-server"); await import("@aiformasses/mcp-server/client");',
    ],
    { cwd: consumerCwd, env: releaseEnvironment() },
  );
  const typescriptBin = path.resolve(
    path.dirname(fileURLToPath(import.meta.resolve("typescript"))),
    "../bin/tsc",
  );
  run(process.execPath, [typescriptBin, "--project", "tsconfig.json"], {
    cwd: consumerCwd,
    env: releaseEnvironment(),
  });

  console.log(
    `MCP release check passed: ${first.entryCount} files, reproducible ${first.shasum}, clean npx lifecycle and consumer imports.`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
