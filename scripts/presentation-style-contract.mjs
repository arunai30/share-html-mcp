import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ShareHtmlApiClient, ShareHtmlApiError } from "../dist/api-client.js";
import {
  artifactStyleDefinitionSchema,
  getArtifactStyleInputSchema,
  registerArtifactStyleTools,
  registerShareHtmlTools,
} from "../dist/server.js";
import { artifactStyleDefinition } from "./artifact-style-fixture.mjs";

const styleRef = {
  styleVersionId: "497b866b-bc15-439b-a7eb-954fe0eab25b",
  revision: 1,
  contentSha256: "e".repeat(64),
};
const deck = {
  html: '<main class="share-presentation"><section class="share-slide" id="slide-1" aria-labelledby="title"><h1 id="title">Decision</h1></section></main>',
  presentation: { schemaVersion: 1, aspectRatio: "16:9" },
  styleRef,
};
assert.equal(getArtifactStyleInputSchema.safeParse({ format: "presentation" }).success, true);
assert.equal(artifactStyleDefinitionSchema.safeParse(artifactStyleDefinition).success, true);
assert.equal(artifactStyleDefinitionSchema.safeParse({
  ...artifactStyleDefinition,
  formatAdaptation: { ...artifactStyleDefinition.formatAdaptation, presentation: {} },
}).success, false, "Presentation is a request format, not a persisted adaptation.");

const client = new ShareHtmlApiClient("https://app.example/api/v1", "test-token");
const tools = new Map();
const registry = { registerTool(name, config, handler) { tools.set(name, { config, handler }); } };
registerShareHtmlTools(registry, client);
registerArtifactStyleTools(registry, client);
const publish = tools.get("publish_presentation");
const getStyle = tools.get("get_artifact_style");
assert.equal(publish.config.inputSchema.safeParse(deck).success, true);
assert.equal(publish.config.inputSchema.safeParse({ ...deck, styleRef: { ...styleRef, revision: 0 } }).success, false);
assert.match(publish.config.inputSchema.shape.styleRef.description, /styles:read/);
const discovery = JSON.parse(await readFile(new URL("../dist/server-card.json", import.meta.url), "utf8"));
assert.ok(discovery.tools.find((tool) => tool.name === "get_artifact_style").inputSchema.properties.format.enum.includes("presentation"));
assert.ok(discovery.tools.find((tool) => tool.name === "publish_presentation").inputSchema.properties.styleRef);

const originalFetch = globalThis.fetch;
const requests = [];
let mode = "success";
globalThis.fetch = async (url, init) => {
  const parsed = new URL(url);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  requests.push({ path: parsed.pathname, format: parsed.searchParams.get("format"), body });
  if (mode === "network") throw new TypeError("fetch failed");
  if (mode === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  if (mode === "legacy") {
    // Shapes emitted by servers before presentation style requests were supported.
    const error = parsed.pathname.endsWith("/artifact-style")
      ? { code: "invalid_artifact_style", message: 'The artifact style is invalid. Invalid option: expected one of "report"|"dashboard"|"explainer"' }
      : { code: "invalid_request", message: "The request must contain string html and may contain a string title." };
    return Response.json({ error }, { status: 400 });
  }
  if (mode === "scope") return Response.json({ error: {
    code: "insufficient_scope", message: "This connection needs styles:read access.",
    requiredScopes: ["styles:read"],
  } }, { status: 403 });
  return Response.json(parsed.pathname.endsWith("/artifact-style")
    ? { status: "configured", format: "presentation", ...styleRef, appearance: { density: "airy" }, guidance: "Preserve the recipe structure." }
    : { pageId: "p_deck", artifactType: "presentation", declaredStyleRef: body?.styleRef ?? null });
};
try {
  const style = await getStyle.handler({ format: "presentation" });
  assert.equal(style.structuredContent.format, "presentation");
  assert.equal(style.structuredContent.definition, undefined);
  assert.equal(style.structuredContent.contentSha256, styleRef.contentSha256);
  const result = await publish.handler(publish.config.inputSchema.parse(deck));
  assert.deepEqual(result.structuredContent.declaredStyleRef, styleRef);
  assert.deepEqual(requests.at(-1).body, deck);
  assert.equal(requests.at(-1).path, "/api/v1/presentations");
  const { styleRef: omitted, ...unstyledDeck } = deck;
  const unstyled = await publish.handler(unstyledDeck);
  assert.equal(unstyled.structuredContent.declaredStyleRef, null);
  assert.equal("styleRef" in requests.at(-1).body, false);

  mode = "legacy";
  for (const action of [() => client.getArtifactStyle({ format: "presentation" }), () => client.publishPresentation(deck)]) {
    await assert.rejects(action, (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "unsupported_presentation_style_request");
      assert.equal(error.status, 400);
      assert.match(error.message, /request.*may.*server update/i);
      return true;
    });
  }
  const legacyRead = await getStyle.handler({ format: "presentation" });
  assert.equal(legacyRead.structuredContent.error.code, "unsupported_presentation_style_request");
  assert.match(legacyRead.structuredContent.error.message, /request.*may.*server update/i);
  assert.doesNotMatch(legacyRead.structuredContent.error.message, /create.*preview|activate|reset/i);
  const legacyPublish = await publish.handler(deck);
  assert.equal(legacyPublish.structuredContent.error.code, "unsupported_presentation_style_request");
  assert.equal(legacyPublish.structuredContent.error.publicationState, "not_published");
  assert.match(legacyPublish.structuredContent.error.message, /nothing was published/i);
  assert.match(legacyPublish.structuredContent.error.message, /do not.*styleRef/i);
  await assert.rejects(() => client.getArtifactStyle({ format: "report" }), { code: "invalid_artifact_style" });
  await assert.rejects(() => client.publishPresentation(unstyledDeck), { code: "invalid_request" });
  // No fallback call, stripped reference, or automatic style mutation occurred.
  assert.ok(requests.every((request) => ["/api/v1/artifact-style", "/api/v1/presentations"].includes(request.path)));
  assert.equal(requests.filter((request) => request.path === "/api/v1/presentations" && request.body.styleRef).length, 3);

  mode = "scope";
  const scope = await publish.handler(deck);
  assert.equal(scope.structuredContent.error.publicationState, "not_published");
  assert.deepEqual(scope.structuredContent.error.details.requiredScopes, ["styles:read"]);
  for (const failure of ["network", "timeout"]) {
    mode = failure;
    const uncertain = await publish.handler(deck);
    assert.equal(uncertain.structuredContent.error.code, "publication_state_unknown");
    assert.equal(uncertain.structuredContent.error.publicationState, "unknown");
  }
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Presentation style contract checks passed.");
