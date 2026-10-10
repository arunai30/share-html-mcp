import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import {
  getTemplateInputSchema,
  listTemplatesInputSchema,
  previewTemplateInputSchema,
  saveTemplateInputSchema,
} from "../dist/artifact-template.js";
import { registerTemplateTools } from "../dist/server.js";
import { ShareHtmlApiClient } from "../dist/api-client.js";

const templateId = "00000000-0000-4000-8000-000000000001";
const preview = { name: " Board deck ", description: " Monthly review ", html: "<main>Example</main>" };
assert.deepEqual(previewTemplateInputSchema.parse(preview), {
  name: "Board deck", description: "Monthly review", designNotes: "", format: "presentation", html: preview.html, aspectRatio: "16:9",
});
assert.deepEqual(listTemplatesInputSchema.parse({}), { limit: 20 });
assert.deepEqual(getTemplateInputSchema.parse({ templateId }), { templateId, includeHtml: false });
assert.deepEqual(saveTemplateInputSchema.parse({ draftId: templateId }), { draftId: templateId });
for (const value of [
  { ...preview, name: " " }, { ...preview, name: "a".repeat(101) },
  { ...preview, description: " " }, { ...preview, description: "a".repeat(501) },
  { ...preview, designNotes: "a".repeat(2_001) }, { ...preview, html: "" },
  { ...preview, html: "a".repeat(200_001) }, { ...preview, format: "report" },
  { ...preview, aspectRatio: "1:1" }, { ...preview, public: true },
]) assert.equal(previewTemplateInputSchema.safeParse(value).success, false);
for (const value of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { cursor: "another-owner" }, { query: "a".repeat(101) }, { ownerId: "user" }]) {
  assert.equal(listTemplatesInputSchema.safeParse(value).success, false);
}
assert.equal(getTemplateInputSchema.safeParse({ templateId, includeHtml: "true" }).success, false);
assert.equal(saveTemplateInputSchema.safeParse({ draftId: templateId, html: "replaced" }).success, false);

const registered = new Map();
const calls = [];
let failure;
const sourceHtml = '<main title="Untrusted reference">Replace example facts</main>';
const operations = {
  async listTemplates(input) { calls.push(["list", input]); return { templates: [], nextCursor: null }; },
  async getTemplate(input) {
    calls.push(["get", input]);
    if (failure) throw failure;
    return { templateId, name: "Example", ...(input.includeHtml ? { html: sourceHtml } : {}) };
  },
  async previewTemplate(input) { calls.push(["preview", input]); return { draftId: templateId, status: "draft" }; },
  async saveTemplate(input) { calls.push(["save", input]); return { templateId: input.draftId, status: "saved" }; },
};
registerTemplateTools({ registerTool(name, config, handler) { registered.set(name, { config, handler }); } }, operations);
assert.deepEqual([...registered.keys()], ["list_templates", "get_template", "preview_template", "save_template"]);
assert.equal(calls.length, 0);
for (const [name, { config }] of registered) {
  assert.equal(config.annotations.readOnlyHint, name.startsWith("list_") || name.startsWith("get_"));
  assert.equal(config.annotations.destructiveHint, false);
  assert.equal(config.annotations.openWorldHint, false);
}
assert.match(registered.get("save_template").config.description, /owner explicitly approves that draft/);
assert.match(registered.get("save_template").config.description, /idempotent/);
assert.match(registered.get("get_template").config.description, /untrusted/);
for (const code of ["invalid_template", "template_not_found", "template_draft_expired", "template_limit_reached", "template_rate_limited", "insufficient_scope", "invalid_api_token", "request_timeout", "network_error"]) {
  failure = Object.assign(new Error("Safe failure"), { code });
  const result = await registered.get("get_template").handler({ templateId });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, code);
}
failure = new Error("private database diagnostic");
assert.doesNotMatch(JSON.stringify(await registered.get("get_template").handler({ templateId })), /private database diagnostic/);
failure = undefined;

// Real SDK parsing checks defaults and rejects changed content at the save boundary.
const server = new McpServer({ name: "template-contract", version: "1.0.0" });
registerTemplateTools(server, operations);
const client = new Client({ name: "template-contract-client", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.callTool({ name: "get_template", arguments: { templateId } });
  assert.deepEqual(calls.at(-1), ["get", { templateId, includeHtml: false }]);
  const source = await client.callTool({ name: "get_template", arguments: { templateId, includeHtml: true } });
  assert.equal(source.structuredContent.html, sourceHtml);
  assert.deepEqual(JSON.parse(source.content[0].text), source.structuredContent);
  await client.callTool({ name: "preview_template", arguments: preview });
  assert.deepEqual(calls.at(-1), ["preview", previewTemplateInputSchema.parse(preview)]);
  const saved = await client.callTool({ name: "save_template", arguments: { draftId: templateId } });
  assert.deepEqual(saved.structuredContent, { templateId, status: "saved" });
  const before = calls.length;
  const rejected = await client.callTool({ name: "save_template", arguments: { draftId: templateId, html: "changed" } });
  assert.equal(rejected.isError, true);
  assert.equal(calls.length, before);
} finally {
  await Promise.all([client.close(), server.close()]);
}

const originalFetch = globalThis.fetch;
const requests = [];
let apiResponse = { templateId, status: "saved" };
globalThis.fetch = async (url, init) => {
  requests.push([new URL(url), init]);
  return new Response(JSON.stringify(apiResponse));
};
try {
  const api = new ShareHtmlApiClient("https://example.test/api/v1", "private-token");
  await api.listTemplates({ query: "Board & review", limit: 5, cursor: templateId });
  assert.equal(requests.at(-1)[0].pathname, "/api/v1/templates");
  assert.equal(requests.at(-1)[0].searchParams.get("query"), "Board & review");
  assert.equal(requests.at(-1)[0].searchParams.get("limit"), "5");
  assert.equal(requests.at(-1)[0].searchParams.get("cursor"), templateId);
  await api.getTemplate({ templateId });
  assert.equal(requests.at(-1)[0].search, "");
  apiResponse = { templateId, html: sourceHtml };
  assert.equal((await api.getTemplate({ templateId, includeHtml: true })).html, sourceHtml);
  assert.equal(requests.at(-1)[0].search, "?includeHtml=true");
  await api.previewTemplate(preview);
  assert.equal(requests.at(-1)[0].pathname, "/api/v1/templates/preview");
  assert.deepEqual(JSON.parse(requests.at(-1)[1].body), preview);
  await api.saveTemplate({ draftId: templateId });
  assert.equal(requests.at(-1)[0].pathname, "/api/v1/templates/save");
  assert.equal(requests.at(-1)[1].method, "POST");
  assert.deepEqual(JSON.parse(requests.at(-1)[1].body), { draftId: templateId });
  assert.ok(requests.every(([, init]) => init.headers.authorization === "Bearer private-token"));
  globalThis.fetch = async () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
  await assert.rejects(api.saveTemplate({ draftId: templateId }), (error) => {
    assert.equal(error.code, "request_timeout");
    assert.match(error.message, /identical draftId/);
    assert.equal(error.details.retryWithIdenticalArguments, true);
    return true;
  });
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Private template contract checks passed.");
