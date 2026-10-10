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
      "dist/artifact-style.d.ts",
      "dist/artifact-style.js",
      "dist/artifact-template.d.ts",
      "dist/artifact-template.js",
      "dist/fonts.d.ts",
      "dist/fonts.js",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/server-card.json",
      "dist/server.d.ts",
      "dist/server.js",
      "dist/source-handoff.d.ts",
      "dist/source-handoff.js",
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
      'import { createShareHtmlServer, type ArtifactStyleDefinition, type ArtifactStyleRef, type InitialSharingPolicyInput, type ShareHtmlOperations, type StyleOperations, type TemplateOperations } from "@aiformasses/mcp-server";',
      'import { ShareHtmlApiClient, ShareHtmlApiError } from "@aiformasses/mcp-server/client";',
      'import { previewTemplateInputSchema, type PreviewTemplateInput } from "@aiformasses/mcp-server/artifact-template";',
      'import { publicFontSchema, publicFontsSchema, type PublicFontInput, type PublicFont, type PublicFontsInput, type PublicFonts } from "@aiformasses/mcp-server/fonts";',
      'import { assertSourceResponseFits, PageSourceError, type PageSourceErrorCode } from "@aiformasses/mcp-server/source-handoff";',
      'import serverCard from "@aiformasses/mcp-server/server-card.json" with { type: "json" };',
      "void serverCard.tools;",
      "declare const operations: ShareHtmlOperations;",
      "declare const styles: StyleOperations;",
      "declare const templates: TemplateOperations;",
      "declare const definition: ArtifactStyleDefinition;",
      "declare const styleRef: ArtifactStyleRef;",
      "createShareHtmlServer(operations);",
      "createShareHtmlServer(operations, undefined, styles);",
      "createShareHtmlServer(operations, undefined, styles, templates);",
      'const client = new ShareHtmlApiClient("https://api.example.com/api/v1", "shp_example");',
      "void client.getRecipe({ recipeId: \"animated-meme\", version: 1 });",
      "void client.previewArtifactStyle({ definition });",
      'void client.setArtifactStyle({ draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c", expectedRevision: 0, clientRequestId: "consumer-1" });',
      'void client.getArtifactStyle({ format: "report" });',
      'const sharing: InitialSharingPolicyInput = { mode: "restricted", methods: { password: { action: "set", value: "private-password" } } };',
      'void client.publishPage({ html: "<h1>Private</h1>", sharing, styleRef });',
      'void client.updatePage("p_example", { html: "<h1>Updated</h1>", styleRef });',
      'const fontInput: PublicFontInput = { family: "Inter" };',
      'const font: PublicFont = publicFontSchema.parse(fontInput);',
      'const fontInputs: PublicFontsInput = [fontInput, { family: "Inter", weights: [700], style: "italic" }];',
      'const fonts: PublicFonts = publicFontsSchema.parse(fontInputs);',
      'const normalizedWeight: number = font.weights[0];',
      'const normalizedStyle: "normal" | "italic" = font.style;',
      'void normalizedWeight; void normalizedStyle;',
      'void client.publishPage({ html: "<h1>Fonts</h1>", fonts: fontInputs });',
      'void client.publishPresentation({ html: "<h1>Deck</h1>", presentation: { schemaVersion: 1, aspectRatio: "16:9" }, fonts });',
      'void client.updatePage("p_example", { html: "<h1>Updated fonts</h1>", fonts: [] });',
      'const template: PreviewTemplateInput = { name: "Company", description: "Reusable design", html: "<h1>Example</h1>" };',
      "void client.previewTemplate(previewTemplateInputSchema.parse(template));",
      "void client.listTemplates({});",
      'void client.getTemplate({ templateId: "1f5f93e1-d137-4a25-b067-65de57e7225c", includeHtml: true });',
      'void client.saveTemplate({ draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c" });',
      'assertSourceResponseFits({ htmlSource: { format: "sanitized-html", html: "<h1>Example</h1>" } });',
      'const sourceErrorCode: PageSourceErrorCode = "source_too_large";',
      'void new PageSourceError(sourceErrorCode, "Example");',
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
        resolveJsonModule: true,
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
      [
        'import assert from "node:assert/strict";',
        'const root = await import("@aiformasses/mcp-server");',
        'await import("@aiformasses/mcp-server/client");',
        'const fonts = await import("@aiformasses/mcp-server/fonts");',
        'assert.equal(root.publicFontSchema, fonts.publicFontSchema);',
        'assert.equal(root.publicFontsSchema, fonts.publicFontsSchema);',
        'assert.deepEqual(fonts.publicFontsSchema.parse([{ family: "  Inter  " }]), [{ family: "Inter", weights: [400], style: "normal" }]);',
        'assert.equal(fonts.publicFontsSchema.safeParse([{ family: "Inter", url: "https://example.com/font.woff2" }]).success, false);',
        'const templates = await import("@aiformasses/mcp-server/artifact-template");',
        'assert.equal(root.previewTemplateInputSchema, templates.previewTemplateInputSchema);',
        'assert.deepEqual(templates.listTemplatesInputSchema.parse({}), { limit: 20 });',
        'const source = await import("@aiformasses/mcp-server/source-handoff");',
        'source.assertSourceResponseFits({ htmlSource: { format: "sanitized-html", html: "<h1>Example</h1>" } });',
        'const { default: card } = await import("@aiformasses/mcp-server/server-card.json", { with: { type: "json" } });',
        'assert.ok(card.authentication.required && card.tools.length);',
        'for (const name of ["list_templates", "get_template", "preview_template", "save_template"]) assert.ok(card.tools.some((tool) => tool.name === name), `Missing ${name}`);',
      ].join("\n"),
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
