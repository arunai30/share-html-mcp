import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { publicFontsSchema } from "../dist/fonts.js";
import { ShareHtmlApiClient } from "../dist/api-client.js";
import { registerShareHtmlTools } from "../dist/server.js";

const fonts = [{ family: "Inter", weights: [400, 700], style: "normal" }];
const html = '<style>body {font-family: "Inter", sans-serif}</style><h1>Reviewed report</h1>';
assert.deepEqual(publicFontsSchema.parse([{ family: "  Inter  " }]), [{ family: "Inter", weights: [400], style: "normal" }]);
assert.deepEqual(publicFontsSchema.parse([]), []);
assert.equal(publicFontsSchema.safeParse([
  ...fonts, { family: "Inter", weights: [400], style: "italic" },
]).success, true);
for (const invalid of [
  null, {}, [{ family: "" }], [{ family: "https://example.com/font.woff2" }],
  [{ family: "Inter", url: "https://example.com/font.woff2" }],
  [{ family: "Inter", weights: [] }], [{ family: "Inter", weights: [400, 400] }],
  [{ family: "Inter", weights: [450] }], [{ family: "Inter", weights: [1000] }],
  [{ family: "Inter", weights: [400.5] }], [{ family: "Inter", weights: ["400"] }],
  [{ family: "Inter", weights: [100, 200, 300, 400, 500] }],
  [{ family: "Inter", style: "oblique" }], [{ family: "München" }],
  [{ family: "Inter" }, { family: " inter " }],
  Array.from({ length: 5 }, (_, index) => ({ family: `Family ${index}` })),
  Array.from({ length: 3 }, (_, index) => ({ family: `Family ${index}`, weights: [400, 500, 700] })),
]) assert.equal(publicFontsSchema.safeParse(invalid).success, false, JSON.stringify(invalid));

const client = new ShareHtmlApiClient("https://app.example/api/v1", "font-test-token");
const tools = new Map();
registerShareHtmlTools({ registerTool(name, config, handler) { tools.set(name, { config, handler }); } }, client);
const discovery = JSON.parse(await readFile(new URL("../dist/server-card.json", import.meta.url), "utf8"));
const cases = [
  { name: "publish_html", path: "/api/v1/pages", args: { html } },
  { name: "publish_html", path: "/api/v1/pages/controlled", args: { html, sharing: { mode: "private" } } },
  { name: "publish_presentation", path: "/api/v1/presentations", args: { html } },
  { name: "update_page", path: "/api/v1/pages/p_font", args: { pageId: "p_font", html, expectedVersion: 3 } },
];
for (const { name } of cases) {
  assert.ok(discovery.tools.find((tool) => tool.name === name).inputSchema.properties.fonts);
  assert.equal(tools.get(name).config.inputSchema.safeParse({ ...cases.find((entry) => entry.name === name).args, fonts: [{ family: "Inter", url: "https://bad.example" }] }).success, false);
}
for (const name of ["publish_html", "update_page"]) {
  const tool = tools.get(name);
  assert.equal(tool.config.inputSchema.safeParse({ pageId: "p_font", generationId: "g_one", expectedVersion: 1, fonts: [] }).success, false);
}

const originalFetch = globalThis.fetch;
const requests = [];
let failure;
let capabilityMode = "supported";
globalThis.fetch = async (url, init) => {
  const body = init?.body ? JSON.parse(init.body) : undefined;
  const path = new URL(url).pathname;
  requests.push({ path, body, method: init?.method ?? "GET", authorization: init?.headers?.authorization });
  if (path === "/api/v1/fonts") {
    if (capabilityMode === "missing") return new Response("Not found", { status: 404 });
    if (capabilityMode === "method") return new Response("Method not allowed", { status: 405 });
    if (capabilityMode === "network") throw new TypeError("fetch failed");
    if (capabilityMode === "timeout") throw Object.assign(new Error("Timed out"), { name: "TimeoutError" });
    if (capabilityMode === "unavailable") return Response.json({ error: { code: "internal_error" } }, { status: 503 });
    if (capabilityMode === "unauthenticated") return Response.json({ error: { code: "invalid_api_token", message: "Invalid token" } }, { status: 401 });
    if (capabilityMode === "denied") return Response.json({ error: { code: "insufficient_scope", message: "Need pages:write" } }, { status: 403 });
    if (capabilityMode === "invalid-json") return new Response("Not JSON");
    if (capabilityMode === "empty") return Response.json({});
    if (capabilityMode === "version") return Response.json({ schemaVersion: 2, provider: "google-fonts" });
    if (capabilityMode === "string-version") return Response.json({ schemaVersion: "1", provider: "google-fonts" });
    if (capabilityMode === "provider") return Response.json({ schemaVersion: 1, provider: "other-provider" });
    return Response.json({ schemaVersion: 1, provider: "google-fonts" });
  }
  if (failure) return Response.json({ error: { code: failure, message: `Correct ${failure}; do not remove fonts automatically.` } }, { status: failure === "font_unavailable" ? 502 : 400 });
  return Response.json({ pageId: "p_font", version: 4 });
};
try {
  for (const { name, path, args } of cases) {
    const tool = tools.get(name);
    for (const fontInput of [fonts, [], undefined]) {
      const input = { ...args, ...(fontInput === undefined ? {} : { fonts: fontInput }) };
      const before = requests.length;
      const result = await tool.handler(tool.config.inputSchema.parse(input));
      assert.equal(result.isError, undefined);
      const calls = requests.slice(before);
      assert.deepEqual(calls.map(({ path }) => path), fontInput === undefined ? [path] : ["/api/v1/fonts", path]);
      if (fontInput !== undefined) {
        assert.equal(calls[0].method, "GET");
        assert.equal(calls[0].body, undefined);
        assert.equal(calls[0].authorization, "Bearer font-test-token");
      }
      assert.equal(requests.at(-1).path, path);
      if (fontInput === undefined) assert.equal("fonts" in requests.at(-1).body, false);
      else assert.deepEqual(requests.at(-1).body.fonts, fontInput);
    }
    for (const code of ["invalid_fonts", "font_unavailable", "font_too_large", "invalid_font"]) {
      failure = code;
      const before = requests.length;
      const result = await tool.handler(tool.config.inputSchema.parse({ ...args, fonts }));
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.error.code, code);
      assert.equal(result.structuredContent.error[name === "update_page" ? "updateState" : "publicationState"], name === "update_page" ? "not_updated" : "not_published");
      assert.match(result.structuredContent.error.message, /do not remove fonts/);
      assert.equal(requests.length, before + 2, "Only the capability check and one mutation are allowed; no font fallback request.");
      assert.deepEqual(requests.at(-1).body.fonts, fonts);
    }
    failure = undefined;
    for (const mode of ["missing", "method", "empty", "version", "string-version", "provider", "invalid-json", "network", "timeout", "unavailable", "unauthenticated", "denied"]) {
      capabilityMode = mode;
      for (const fontInput of [fonts, []]) {
        const before = requests.length;
        const result = await tool.handler(tool.config.inputSchema.parse({ ...args, fonts: fontInput }));
        assert.equal(result.isError, true);
        const expectedCode = ["network", "timeout", "unavailable"].includes(mode) ? "font_capability_unavailable"
          : mode === "unauthenticated" ? "invalid_api_token" : mode === "denied" ? "insufficient_scope" : "unsupported_fonts";
        assert.equal(result.structuredContent.error.code, expectedCode, `${name}: ${mode}`);
        assert.equal(result.structuredContent.error[name === "update_page" ? "updateState" : "publicationState"], name === "update_page" ? "not_updated" : "not_published");
        assert.deepEqual(requests.slice(before).map(({ path, method }) => ({ path, method })), [{ path: "/api/v1/fonts", method: "GET" }], `${name}: ${mode} must never mutate`);
      }
    }
    // Calls without fonts remain compatible and do not require the new route.
    capabilityMode = "missing";
    const before = requests.length;
    const legacy = await tool.handler(tool.config.inputSchema.parse(args));
    assert.equal(legacy.isError, undefined);
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).path, path);
    capabilityMode = "supported";
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Public font MCP and API-client contract checks passed.");
