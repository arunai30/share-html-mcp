import assert from "node:assert/strict";
import { PageSourceError, assertSourceResponseFits } from "../dist/source-handoff.js";
import { ShareHtmlApiClient } from "../dist/api-client.js";
import { registerShareHtmlTools } from "../dist/server.js";

const source = { pageId: "p_one", artifactType: "presentation", version: 4, contentSha256: "a".repeat(64), htmlSource: { format: "sanitized-html", html: '<h1 title="untrusted">Hello 😀</h1>' } };
assert.doesNotThrow(() => assertSourceResponseFits(source));
for (const htmlSource of [undefined, null, {}, { format: "raw", html: "hello" }, { format: "sanitized-html", html: 42 }]) {
  assert.throws(() => assertSourceResponseFits({ ...source, htmlSource }), (error) => error instanceof PageSourceError && error.code === "source_handoff_unsupported");
}
assert.throws(() => assertSourceResponseFits(source, 3), { code: "source_too_large", status: 413 });
assert.throws(() => assertSourceResponseFits({ ...source, htmlSource: { format: "sanitized-html", html: "😀".repeat(250_001) } }), { code: "source_too_large" });
// Quotes/backslashes grow when JSON text is itself serialized inside an MCP result.
assert.throws(() => assertSourceResponseFits({ ...source, htmlSource: { format: "sanitized-html", html: '"\\'.repeat(180_000) } }), { code: "source_too_large" });
assert.throws(() => assertSourceResponseFits({ ...source, extra: "a".repeat(2_000_001) }), { code: "source_too_large" });

const tools = new Map();
const calls = [];
let response = source;
let failure;
registerShareHtmlTools({ registerTool(name, config, handler) { tools.set(name, { config, handler }); } }, {
  async getPage(...args) { calls.push(args); if (failure) throw failure; return response; },
  async updatePage() { throw failure; },
});
const get = tools.get("get_page");
assert.equal(get.config.inputSchema.parse({ pageId: "p_one", includeHtmlSource: true }).includeHtmlSource, true);
assert.match(get.config.description, /untrusted/i);
assert.match(tools.get("update_page").config.description, /expectedVersion/);
assert.match(tools.get("update_page").config.description, /styleRef/);
const result = await get.handler({ pageId: "p_one", includeHtmlSource: true, includeDiagramSource: true });
assert.deepEqual(calls.pop(), ["p_one", { includeDiagramSource: true, includeHtmlSource: true }]);
assert.deepEqual(result.structuredContent, source);
assert.deepEqual(JSON.parse(result.content[0].text), source);
response = { pageId: "p_one", version: 4 };
assert.equal((await get.handler({ pageId: "p_one", includeHtmlSource: true })).structuredContent.error.code, "source_handoff_unsupported");
assert.deepEqual((await get.handler({ pageId: "p_one" })).structuredContent, response);
assert.deepEqual(calls.pop(), ["p_one", undefined]);
for (const code of ["invalid_request", "html_source_unsupported", "source_too_large", "source_handoff_unsupported", "page_not_found", "insufficient_scope", "invalid_api_token"]) {
  failure = Object.assign(new Error("Safe failure"), { code });
  assert.equal((await get.handler({ pageId: "p_one", includeHtmlSource: true })).structuredContent.error.code, code);
}
failure = new Error("private diagnostic");
assert.doesNotMatch(JSON.stringify(await get.handler({ pageId: "p_one" })), /private diagnostic/);
for (const currentVersion of [5, 0, -1, 1.5, "5", Number.MAX_SAFE_INTEGER + 1]) {
  failure = Object.assign(new Error("Get the current page and review changes before retrying."), { code: "page_version_conflict", details: { currentVersion, privateDiagnostic: "secret" } });
  const error = (await tools.get("update_page").handler({ pageId: "p_one", html: "new", expectedVersion: 4 })).structuredContent.error;
  assert.equal(error.code, "page_version_conflict");
  assert.equal(error.updateState, "not_updated");
  assert.deepEqual(error.details, currentVersion === 5 ? { currentVersion: 5 } : undefined);
}
failure = Object.assign(new Error("Bad version"), { code: "invalid_request" });
assert.equal((await tools.get("update_page").handler({ pageId: "p_one", html: "new" })).structuredContent.error.updateState, "not_updated");

const originalFetch = globalThis.fetch;
const requests = [];
let apiResponse = source;
let apiStatus = 200;
globalThis.fetch = async (url, init) => { requests.push([new URL(url), init]); return new Response(JSON.stringify(apiResponse), { status: apiStatus }); };
try {
  const client = new ShareHtmlApiClient("https://example.test/api/v1", "test-token");
  assert.deepEqual((await client.getPage("p_one", { includeHtmlSource: true, includeDiagramSource: true })).htmlSource, source.htmlSource);
  assert.equal(requests.at(-1)[0].searchParams.get("includeHtmlSource"), "true");
  assert.equal(requests.at(-1)[0].searchParams.get("includeDiagramSource"), "true");
  apiResponse = { pageId: "p_one" };
  assert.equal((await client.getPage("p_one")).artifactType, "document");
  await assert.rejects(client.getPage("p_one", { includeHtmlSource: true }), { code: "source_handoff_unsupported" });
  apiResponse = { ...source, htmlSource: { format: "sanitized-html", html: "a".repeat(1_000_001) } };
  await assert.rejects(client.getPage("p_one", { includeHtmlSource: true }), { code: "source_too_large" });
  apiResponse = { ...source, htmlSource: { format: "sanitized-html", html: "a".repeat(2_600_000) } };
  await assert.rejects(client.getPage("p_one", { includeHtmlSource: true }), { code: "source_too_large" });
  apiStatus = 409;
  for (const currentVersion of [5, 0, 1.5, "5"]) {
    apiResponse = { error: { code: "page_version_conflict", message: "Conflict", details: { currentVersion, privateDiagnostic: "secret" } } };
    await assert.rejects(client.updatePage("p_one", { html: "new", expectedVersion: 4 }), (error) => { assert.deepEqual(error.details, currentVersion === 5 ? { currentVersion: 5 } : undefined); return error.code === "page_version_conflict"; });
  }
} finally { globalThis.fetch = originalFetch; }
console.log("Source handoff contract checks passed.");
