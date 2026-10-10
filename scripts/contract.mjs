import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ShareHtmlApiClient,
  ShareHtmlApiError,
} from "../dist/api-client.js";
import {
  artifactStyleDefinitionSchema,
  registerArtifactStyleTools,
  registerShareHtmlTools,
} from "../dist/server.js";
import { artifactStyleDefinition } from "./artifact-style-fixture.mjs";

// Check the actual SDK tools/list serialization produced during the build,
// including sharing tools, rather than only the registration mock below.
const discovery = JSON.parse(await readFile(new URL("../dist/server-card.json", import.meta.url), "utf8"));
const expectedToolEffects = {
  // [read only, destructive, open world]
  get_recipe: [true, false, false],
  generate_diagram: [false, false, false],
  publish_html: [false, false, true],
  publish_presentation: [false, false, true],
  update_page: [false, true, true],
  get_page: [true, false, false],
  list_pages: [true, false, false],
  publish_page: [false, false, true],
  unpublish_page: [false, true, true],
  delete_page: [false, true, true],
  get_page_sharing: [true, false, false],
  set_page_sharing: [false, true, true],
  end_current_viewing_sessions: [false, true, true],
  preview_artifact_style: [false, false, false],
  set_artifact_style: [false, true, false],
  get_artifact_style: [true, false, false],
  list_templates: [true, false, false],
  get_template: [true, false, false],
  preview_template: [false, false, false],
  save_template: [false, false, false],
};
assert.deepEqual(discovery.tools.map((tool) => tool.name).sort(), Object.keys(expectedToolEffects).sort());
for (const tool of discovery.tools) {
  assert.deepEqual(
    [tool.annotations.readOnlyHint, tool.annotations.destructiveHint, tool.annotations.openWorldHint],
    expectedToolEffects[tool.name],
    `${tool.name} discovery must describe its actual effects.`,
  );
}

const artifactStyleRef = {
  styleVersionId: "497b866b-bc15-439b-a7eb-954fe0eab25b",
  revision: 1,
  contentSha256: "e".repeat(64),
};

function missingStyleReadScopeError() {
  return Object.assign(
    new Error(
      "This connection needs styles:read access before it can attach an artifact style. Reconnect share/artifacts to continue.",
    ),
    {
      code: "insufficient_scope",
      requiredScope: "styles:read",
      details: {
        requiredScopes: ["styles:read"],
        reauthorizeUrl: "https://app.example/connect?intent=style",
        retryGuidance:
          "Reconnect share/artifacts and approve styles:read access, then retry with the same styleRef.",
        privateDiagnostic: "must not escape",
      },
    },
  );
}

const registered = new Map();
const server = {
  registerTool(name, config, handler) {
    assert.equal(registered.has(name), false, `duplicate tool: ${name}`);
    registered.set(name, { config, handler });
  },
};
const calls = [];
const operations = {
  async getRecipe(input) {
    calls.push(["getRecipe", input]);
    return input.recipeId
      ? { kind: "recipe", recipeId: input.recipeId, version: input.version ?? 1 }
      : { kind: "recipe_catalog", recipes: [] };
  },
  async listPages(input) {
    if (input.query === "Database failure") {
      throw new Error("private database diagnostic");
    }
    if (input.query === "Bad cursor") {
      throw Object.assign(new Error("The cursor is invalid."), {
        code: "invalid_cursor",
      });
    }
    calls.push(["listPages", input]);
    return {
      pages: [],
      pageInfo: {
        limit: input.limit ?? 25,
        resultCount: 0,
        matchingCount: 0,
        totalLibraryCount: 0,
        nextCursor: null,
        previousCursor: null,
      },
    };
  },
  async getPage(pageId) {
    calls.push(["getPage", pageId]);
    return { pageId };
  },
  async publishPage(input) {
    if (input.title === "Legacy OAuth style scope") {
      throw missingStyleReadScopeError();
    }
    if (input.title === "Missing page scope") {
      throw Object.assign(
        new Error("The authenticated actor does not have the required scope."),
        { code: "insufficient_scope", requiredScope: "pages:write" },
      );
    }
    if (input.styleRef?.revision === 99) {
      throw Object.assign(new Error("The style reference is no longer active."), {
        code: "style_reference_conflict",
      });
    }
    if (input.styleRef?.revision === 98) {
      throw Object.assign(new Error("The style reference is invalid."), {
        code: "invalid_style_reference",
      });
    }
    if (input.title === "Rejected token") {
      throw Object.assign(new Error("The API token is invalid."), {
        code: "invalid_api_token",
      });
    }
    if (input.title === "Timed out") {
      throw Object.assign(new Error("The request timed out."), {
        code: "request_timeout",
      });
    }
    if (input.title === "Database failure") {
      throw Object.assign(new Error("The controlled artifact was not published."), {
        code: "controlled_publish_failed",
      });
    }
    calls.push(["publishPage", input]);
    return { pageId: "p_new" };
  },
  async publishPresentation(input) {
    if (input.title === "Invalid deck") {
      throw Object.assign(new Error("Slide IDs must be sequential."), {
        code: "invalid_presentation",
      });
    }
    if (input.title === "Timed out deck") {
      throw Object.assign(new Error("The request timed out."), {
        code: "request_timeout",
      });
    }
    calls.push(["publishPresentation", input]);
    return {
      pageId: "p_deck",
      artifactType: "presentation",
      publicUrl: "https://app.example/view/p_deck",
    };
  },
  async updatePage(pageId, input) {
    if (input.title === "Legacy OAuth style scope") {
      throw missingStyleReadScopeError();
    }
    if (input.styleRef?.revision === 99) {
      throw Object.assign(new Error("The style reference is no longer active."), {
        code: "style_reference_conflict",
      });
    }
    if (input.styleRef?.revision === 98) {
      throw Object.assign(new Error("The style reference is invalid."), {
        code: "invalid_style_reference",
      });
    }
    if (input.title === "Invalid deck") {
      throw Object.assign(new Error("Slide IDs must be sequential."), {
        code: "invalid_presentation",
      });
    }
    if (input.title === "Timed out deck") {
      throw Object.assign(new Error("The request timed out."), {
        code: "request_timeout",
      });
    }
    calls.push(["updatePage", pageId, input]);
    return { pageId, version: 2 };
  },
  async publishExistingPage(pageId) {
    calls.push(["publishExistingPage", pageId]);
    return { ok: true, status: "published" };
  },
  async unpublishPage(pageId) {
    calls.push(["unpublishPage", pageId]);
    return { ok: true, status: "unpublished" };
  },
  async deletePage(pageId) {
    calls.push(["deletePage", pageId]);
    return { ok: true };
  },
};

const styleCalls = [];
const styleOperations = {
  async previewArtifactStyle(input) {
    if (input.definition.name === "Rate Limited") {
      throw Object.assign(new Error("Private style preview rate exceeded."), {
        code: "artifact_style_rate_limited",
        details: {
          retryAfterSeconds: 3600,
          retryGuidance: "Review the most recent private draft or wait.",
          privateDiagnostic: "must not escape",
        },
      });
    }
    styleCalls.push(["previewArtifactStyle", input]);
    return {
      status: "pending",
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      baseProfileRevision: 0,
      definition: input.definition,
      contentSha256: "e".repeat(64),
      canonicalSummary: "Airy asymmetric layout with visible values.",
      reviewUrl: "https://app.example/settings/style?draft=1f5f93e1-d137-4a25-b067-65de57e7225c",
    };
  },
  async setArtifactStyle(input) {
    if (input.clientRequestId === "timeout-request") {
      throw Object.assign(new Error("The request timed out."), {
        code: "request_timeout",
      });
    }
    if (input.clientRequestId === "stale-request") {
      throw Object.assign(new Error("The style changed elsewhere."), {
        code: "artifact_style_conflict",
        currentRevision: 3,
      });
    }
    styleCalls.push(["setArtifactStyle", input]);
    return {
      status: "configured",
      revision: input.expectedRevision + 1,
      styleVersionId: "497b866b-bc15-439b-a7eb-954fe0eab25b",
      definition: artifactStyleDefinition,
      contentSha256: "e".repeat(64),
      canonicalSummary: "Airy asymmetric layout with visible values.",
    };
  },
  async getArtifactStyle(input) {
    styleCalls.push(["getArtifactStyle", input]);
    return {
      status: "configured",
      revision: 1,
      styleVersionId: "497b866b-bc15-439b-a7eb-954fe0eab25b",
      definition: artifactStyleDefinition,
      contentSha256: "e".repeat(64),
      canonicalSummary: "Airy asymmetric layout with visible values.",
      guidance: `Format: ${input.format}\nUse an asymmetric grid.`,
    };
  },
};

registerShareHtmlTools(server, operations);
registerArtifactStyleTools(server, styleOperations);

assert.deepEqual([...registered.keys()].sort(), [
  "delete_page",
  "get_artifact_style",
  "get_page",
  "get_recipe",
  "list_pages",
  "preview_artifact_style",
  "publish_html",
  "publish_page",
  "publish_presentation",
  "set_artifact_style",
  "unpublish_page",
  "update_page",
]);
assert.deepEqual(calls, [], "registration must not execute page operations");
assert.deepEqual(styleCalls, [], "registration must not execute style operations");

await registered.get("get_recipe").handler({});
await registered
  .get("get_recipe")
  .handler({ recipeId: "animated-meme", version: 1 });
await registered.get("list_pages").handler({
  query: "Launch",
  status: "unpublished",
  limit: 40,
  cursor: "opaque-cursor",
});
await registered.get("get_page").handler({ pageId: "p_one" });
await registered
  .get("publish_html")
  .handler({ title: "Report", html: "<h1>Report</h1>" });
await registered.get("publish_html").handler({
  title: "Private report",
  html: "<h1>Private report</h1>",
  sharing: {
    mode: "restricted",
    methods: { recipients: ["reader@example.com"] },
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
});
await registered.get("publish_html").handler({
  title: "Styled report",
  html: "<h1>Styled report</h1>",
  sharing: { mode: "public" },
  styleRef: artifactStyleRef,
});
await registered.get("publish_presentation").handler({
  title: "Quarterly story",
  html: '<main class="share-presentation"></main>',
  presentation: { schemaVersion: 1, aspectRatio: "16:9" },
});
await registered
  .get("update_page")
  .handler({ pageId: "p_one", html: "<h1>Updated</h1>" });
await registered.get("update_page").handler({
  pageId: "p_one",
  html: "<h1>Styled update</h1>",
  styleRef: artifactStyleRef,
});
await registered.get("publish_page").handler({ pageId: "p_one" });
await registered.get("unpublish_page").handler({ pageId: "p_one" });
await registered.get("delete_page").handler({ pageId: "p_one" });

const privateAuthoredName = "Private author label must not reach the agent";
const privateAuthoredSummary =
  "Private author prose must remain visible only in the trusted human review.";
const styleDefinitionWithPrivateProse = {
  ...artifactStyleDefinition,
  name: privateAuthoredName,
  summary: privateAuthoredSummary,
};
const previewedStyle = await registered.get("preview_artifact_style").handler({
  definition: styleDefinitionWithPrivateProse,
});
const activatedStyle = await registered.get("set_artifact_style").handler({
  draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
  expectedRevision: 0,
  clientRequestId: "contract-activation-1",
});
const loadedStyle = await registered.get("get_artifact_style").handler({
  format: "report",
});

for (const styleResult of [previewedStyle, activatedStyle, loadedStyle]) {
  const serialized = JSON.stringify(styleResult);
  assert.doesNotMatch(serialized, new RegExp(privateAuthoredName, "i"));
  assert.doesNotMatch(serialized, new RegExp(privateAuthoredSummary, "i"));
  assert.equal(serialized.includes('"name"'), false);
  assert.equal(serialized.includes('"summary"'), false);
  assert.match(serialized, /canonicalSummary/);
}

assert.deepEqual(calls, [
  ["getRecipe", {}],
  ["getRecipe", { recipeId: "animated-meme", version: 1 }],
  [
    "listPages",
    {
      query: "Launch",
      status: "unpublished",
      limit: 40,
      cursor: "opaque-cursor",
    },
  ],
  ["getPage", "p_one"],
  ["publishPage", { title: "Report", html: "<h1>Report</h1>" }],
  [
    "publishPage",
    {
      title: "Private report",
      html: "<h1>Private report</h1>",
      sharing: {
        mode: "restricted",
        methods: { recipients: ["reader@example.com"] },
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
    },
  ],
  [
    "publishPage",
    {
      title: "Styled report",
      html: "<h1>Styled report</h1>",
      sharing: { mode: "public" },
      styleRef: artifactStyleRef,
    },
  ],
  [
    "publishPresentation",
    {
      title: "Quarterly story",
      html: '<main class="share-presentation"></main>',
      presentation: { schemaVersion: 1, aspectRatio: "16:9" },
    },
  ],
  [
    "updatePage",
    "p_one",
    { title: undefined, html: "<h1>Updated</h1>", styleRef: undefined },
  ],
  [
    "updatePage",
    "p_one",
    {
      title: undefined,
      html: "<h1>Styled update</h1>",
      styleRef: artifactStyleRef,
    },
  ],
  ["publishExistingPage", "p_one"],
  ["unpublishPage", "p_one"],
  ["deletePage", "p_one"],
]);
assert.deepEqual(styleCalls, [
  ["previewArtifactStyle", { definition: styleDefinitionWithPrivateProse }],
  [
    "setArtifactStyle",
    {
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      expectedRevision: 0,
      clientRequestId: "contract-activation-1",
    },
  ],
  ["getArtifactStyle", { format: "report" }],
]);

for (const { config } of registered.values()) {
  assert.equal(typeof config.inputSchema?.safeParse, "function");
}

// Reviewed backend schema snapshot; kept locally so this public package tests standalone.
const descriptor = JSON.parse(
  await readFile(
    new URL(
      "./fixtures/artifact-style-v1.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.equal(artifactStyleDefinitionSchema.safeParse(artifactStyleDefinition).success, true);
assert.equal(descriptor.additionalProperties, false);
assert.deepEqual(
  [...descriptor.required].sort(),
  Object.keys(artifactStyleDefinition).sort(),
);
assert.deepEqual(
  [...descriptor.properties.typography.properties.display.enum].sort(),
  [
    "system-sans-black",
    "system-sans",
    "system-serif",
    "system-mono",
    "system-rounded",
  ].sort(),
);
assert.equal(
  artifactStyleDefinitionSchema.safeParse({
    ...artifactStyleDefinition,
    unexpected: true,
  }).success,
  false,
);
assert.equal(
  artifactStyleDefinitionSchema.safeParse({
    ...artifactStyleDefinition,
    palette: { ...artifactStyleDefinition.palette, unexpected: "#000000" },
  }).success,
  false,
);
assert.equal(
  artifactStyleDefinitionSchema.safeParse({
    ...artifactStyleDefinition,
    typography: { ...artifactStyleDefinition.typography, display: "remote-font" },
  }).success,
  false,
);
assert.equal(
  artifactStyleDefinitionSchema.safeParse({
    ...artifactStyleDefinition,
    signatures: [
      artifactStyleDefinition.signatures[0],
      artifactStyleDefinition.signatures[0],
    ],
  }).success,
  false,
);

const previewStyleTool = registered.get("preview_artifact_style");
const setStyleTool = registered.get("set_artifact_style");
const getStyleTool = registered.get("get_artifact_style");
assert.deepEqual(previewStyleTool.config.annotations, {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false,
});
assert.deepEqual(setStyleTool.config.annotations, {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
  idempotentHint: true,
});
assert.deepEqual(getStyleTool.config.annotations, {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});
assert.equal(
  previewStyleTool.config.inputSchema.safeParse({
    definition: artifactStyleDefinition,
  }).success,
  true,
);
assert.equal(
  previewStyleTool.config.inputSchema.safeParse({
    definition: artifactStyleDefinition,
    extra: true,
  }).success,
  false,
);
assert.equal(
  setStyleTool.config.inputSchema.safeParse({
    draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
    expectedRevision: 0,
    clientRequestId: "contract.request:1",
  }).success,
  true,
);
assert.equal(
  setStyleTool.config.inputSchema.safeParse({
    draftId: "not-a-uuid",
    expectedRevision: 0,
    clientRequestId: "contract.request:1",
  }).success,
  false,
);
assert.equal(
  setStyleTool.config.inputSchema.safeParse({
    draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
    expectedRevision: Number.MAX_SAFE_INTEGER + 1,
    clientRequestId: "contract.request:1",
  }).success,
  false,
);
assert.equal(
  setStyleTool.config.inputSchema.safeParse({
    draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
    expectedRevision: 0,
    clientRequestId: "contains spaces",
  }).success,
  false,
);
assert.equal(getStyleTool.config.inputSchema.safeParse({ format: "report" }).success, true);
assert.equal(getStyleTool.config.inputSchema.safeParse({}).success, false);
assert.equal(
  getStyleTool.config.inputSchema.safeParse({ format: "presentation" }).success,
  true,
);
assert.equal(getStyleTool.config.inputSchema.safeParse({ format: "unknown" }).success, false);

const staleStyle = await setStyleTool.handler({
  draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
  expectedRevision: 2,
  clientRequestId: "stale-request",
});
assert.deepEqual(staleStyle.structuredContent.error, {
  code: "artifact_style_conflict",
  message:
    "The active artifact style changed. Get the current style, then create and review a fresh preview.",
  details: { currentRevision: 3 },
});
const timedOutStyle = await setStyleTool.handler({
  draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
  expectedRevision: 0,
  clientRequestId: "timeout-request",
});
assert.equal(timedOutStyle.structuredContent.error.code, "request_timeout");
assert.match(timedOutStyle.structuredContent.error.message, /identical.*draftId.*expectedRevision.*clientRequestId/i);
assert.deepEqual(timedOutStyle.structuredContent.error.details, {
  retryGuidance:
    "Retry set_artifact_style only with the identical draftId, expectedRevision, and clientRequestId.",
  retryWithIdenticalArguments: true,
});
const rateLimitedStyle = await previewStyleTool.handler({
  definition: { ...artifactStyleDefinition, name: "Rate Limited" },
});
assert.deepEqual(rateLimitedStyle.structuredContent.error, {
  code: "artifact_style_rate_limited",
  message:
    "Too many private artifact style previews were created. Keep reviewing the most recent draft or retry after the supplied delay.",
  details: {
    retryAfterSeconds: 3600,
    retryGuidance: "Review the most recent private draft or wait.",
  },
});

const recipeTool = registered.get("get_recipe");
assert.match(recipeTool.config.description, /share\/artifacts/);
assert.doesNotMatch(recipeTool.config.description, /share\/html/);
assert.deepEqual(recipeTool.config.annotations, {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
});
assert.equal(recipeTool.config.inputSchema.safeParse({}).success, true);
assert.equal(
  recipeTool.config.inputSchema.safeParse({ recipeId: "animated-meme", version: 1 })
    .success,
  true,
);

const listTool = registered.get("list_pages");
assert.match(listTool.config.description, /search/i);
assert.match(listTool.config.description, /offline/i);
assert.equal(listTool.config.inputSchema.safeParse({}).success, true);
assert.equal(
  listTool.config.inputSchema.safeParse({
    query: "Launch",
    status: "published",
    limit: 100,
    cursor: "opaque-cursor",
  }).success,
  true,
);
assert.equal(
  listTool.config.inputSchema.safeParse({ unexpected: true }).success,
  false,
);
const paddedListQuery = listTool.config.inputSchema.safeParse({
  query: `  ${"x".repeat(120)}  `,
});
assert.equal(paddedListQuery.success, true);
assert.equal(paddedListQuery.data.query.length, 120);
assert.equal(listTool.config.inputSchema.safeParse({ limit: 101 }).success, false);
assert.equal(typeof listTool.config.outputSchema?.safeParse, "function");
assert.equal(
  listTool.config.outputSchema.safeParse({
    pages: [],
    pageInfo: {
      limit: 25,
      resultCount: 0,
      matchingCount: 0,
      totalLibraryCount: 0,
      nextCursor: null,
      previousCursor: null,
    },
  }).success,
  true,
);
assert.equal(
  listTool.config.outputSchema.safeParse({
    pages: [
      {
        artifactType: "document",
        artifactSchemaVersion: 1,
        artifactMetadata: {},
        pageId: "p_held",
        title: "Held artifact",
        status: "taken_down",
        publicUrl: "https://app.example/view/p_held",
        createdAt: "2026-08-27T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z",
      },
    ],
    pageInfo: {
      limit: 25,
      resultCount: 1,
      matchingCount: 1,
      totalLibraryCount: 1,
      nextCursor: null,
      previousCursor: null,
    },
  }).success,
  true,
);
assert.equal(
  listTool.config.outputSchema.safeParse({
    pages: [
      {
        artifactType: "document",
        artifactSchemaVersion: 1,
        artifactMetadata: {},
        pageId: "p_example",
        title: "Example",
        status: "published",
        publicUrl: "https://app.example/view/p_example",
        createdAt: "2026-08-27T12:00:00.000Z",
        updatedAt: "2026-08-27T12:00:00.000Z",
        sanitizedHtml: "<h1>must not pass</h1>",
      },
    ],
    pageInfo: {
      limit: 25,
      resultCount: 1,
      matchingCount: 1,
      totalLibraryCount: 1,
      nextCursor: null,
      previousCursor: null,
    },
  }).success,
  false,
);

const safeListError = await listTool.handler({ query: "Bad cursor" });
assert.equal(safeListError.isError, true);
assert.match(safeListError.content[0].text, /invalid_cursor/);
assert.equal("structuredContent" in safeListError, false);
const maskedListError = await listTool.handler({ query: "Database failure" });
assert.equal(maskedListError.isError, true);
assert.match(maskedListError.content[0].text, /internal_error/);
assert.doesNotMatch(maskedListError.content[0].text, /database|diagnostic/i);
assert.equal("structuredContent" in maskedListError, false);
assert.equal(
  recipeTool.config.inputSchema.safeParse({ version: 1 }).success,
  false,
);
assert.equal(
  recipeTool.config.inputSchema.safeParse({ recipeId: "" }).success,
  false,
);

const publishTool = registered.get("publish_html");
assert.match(publishTool.config.description, /private.*domain.*email.*password/i);
assert.match(
  publishTool.config.inputSchema.shape.sharing.description,
  /optional access policy/i,
);
assert.equal(
  publishTool.config.inputSchema.safeParse({
    html: "<h1>Private</h1>",
    sharing: { mode: "restricted", methods: {} },
  }).success,
  false,
);
assert.equal(
  publishTool.config.inputSchema.safeParse({
    html: "<h1>Styled</h1>",
    styleRef: artifactStyleRef,
  }).success,
  true,
);
for (const invalidStyleRef of [
  { ...artifactStyleRef, revision: 0 },
  { ...artifactStyleRef, styleVersionId: "not-a-uuid" },
  { ...artifactStyleRef, contentSha256: "E".repeat(64) },
  { ...artifactStyleRef, extra: true },
]) {
  assert.equal(
    publishTool.config.inputSchema.safeParse({
      html: "<h1>Styled</h1>",
      styleRef: invalidStyleRef,
    }).success,
    false,
  );
}
const staleStylePublish = await publishTool.handler({
  html: "<h1>Stale style</h1>",
  styleRef: { ...artifactStyleRef, revision: 99 },
});
assert.deepEqual(staleStylePublish.structuredContent.error, {
  code: "style_reference_conflict",
  message: "The style reference is no longer active.",
  publicationState: "not_published",
});
const invalidStylePublish = await publishTool.handler({
  html: "<h1>Invalid style</h1>",
  styleRef: { ...artifactStyleRef, revision: 98 },
});
assert.deepEqual(invalidStylePublish.structuredContent.error, {
  code: "invalid_style_reference",
  message: "The style reference is invalid.",
  publicationState: "not_published",
});
const expectedHostedStyleScopeError = {
  code: "insufficient_scope",
  message:
    "This connection needs styles:read access before it can attach an artifact style. Reconnect share/artifacts to continue.",
  publicationState: "not_published",
  details: {
    requiredScopes: ["styles:read"],
    reauthorizeUrl: "https://app.example/connect?intent=style",
    retryGuidance:
      "Reconnect share/artifacts and approve styles:read access, then retry with the same styleRef.",
  },
};
const legacyStylePublish = await publishTool.handler({
  title: "Legacy OAuth style scope",
  html: "<h1>Styled</h1>",
  styleRef: artifactStyleRef,
});
assert.deepEqual(
  legacyStylePublish.structuredContent.error,
  expectedHostedStyleScopeError,
);
const legacyControlledStylePublish = await publishTool.handler({
  title: "Legacy OAuth style scope",
  html: "<h1>Styled privately</h1>",
  sharing: { mode: "private" },
  styleRef: artifactStyleRef,
});
assert.deepEqual(
  legacyControlledStylePublish.structuredContent.error,
  expectedHostedStyleScopeError,
);
const missingPageScope = await publishTool.handler({
  title: "Missing page scope",
  html: "<h1>Denied</h1>",
});
assert.deepEqual(missingPageScope.structuredContent.error, {
  code: "insufficient_scope",
  message: "The authenticated actor does not have the required scope.",
  publicationState: "not_published",
});

const presentationTool = registered.get("publish_presentation");
assert.match(presentationTool.config.description, /slides|deck/i);
assert.match(presentationTool.config.description, /get_recipe/);
assert.match(presentationTool.config.description, /pm-decision-deck.*product manager.*otherwise.*presentation-deck/);
assert.match(presentationTool.config.description, /render and inspect/i);
assert.match(presentationTool.config.description, /actual rendered pixels/i);
assert.match(presentationTool.config.description, /every slide/i);
assert.match(presentationTool.config.description, /desktop.*narrow.*print/i);
assert.match(presentationTool.config.description, /before publishing/i);
assert.match(presentationTool.config.description, /DOM.*alone/i);
assert.match(presentationTool.config.description, /fix.*re-?render/i);
assert.match(presentationTool.config.description, /shared CSS/i);
assert.match(presentationTool.config.description, /visual QA was not completed/i);
assert.match(
  presentationTool.config.description,
  /publishing may proceed.*disclosure/i,
);
assert.match(presentationTool.config.description, /viewer URL/i);
const defaultPresentation = presentationTool.config.inputSchema.safeParse({
  html: '<main class="share-presentation"></main>',
});
assert.equal(defaultPresentation.success, true);
assert.deepEqual(defaultPresentation.data.presentation, {
  schemaVersion: 1,
  aspectRatio: "16:9",
});
assert.equal(
  presentationTool.config.inputSchema.safeParse({
    html: '<main class="share-presentation"></main>',
    presentation: { schemaVersion: 1, aspectRatio: "4:3" },
  }).success,
  true,
);
assert.equal(
  presentationTool.config.inputSchema.safeParse({
    html: '<main class="share-presentation"></main>',
    presentation: { schemaVersion: 2, aspectRatio: "16:9" },
  }).success,
  false,
);
const invalidDeck = await presentationTool.handler({
  title: "Invalid deck",
  html: '<main class="share-presentation"></main>',
  presentation: { schemaVersion: 1, aspectRatio: "16:9" },
});
assert.deepEqual(invalidDeck.structuredContent.error, {
  code: "invalid_presentation",
  message: "Slide IDs must be sequential.",
  publicationState: "not_published",
});
const timedOutDeck = await presentationTool.handler({
  title: "Timed out deck",
  html: '<main class="share-presentation"></main>',
  presentation: { schemaVersion: 1, aspectRatio: "16:9" },
});
assert.deepEqual(timedOutDeck.structuredContent.error, {
  code: "publication_state_unknown",
  message: "The request timed out.",
  publicationState: "unknown",
});

const updateTool = registered.get("update_page");
assert.equal(
  updateTool.config.inputSchema.safeParse({
    pageId: "p_one",
    html: "<h1>Styled update</h1>",
    styleRef: artifactStyleRef,
  }).success,
  true,
);
const invalidUpdate = await updateTool.handler({
  pageId: "p_deck",
  title: "Invalid deck",
  html: '<main class="share-presentation"></main>',
});
assert.deepEqual(invalidUpdate.structuredContent.error, {
  code: "invalid_presentation",
  message: "Slide IDs must be sequential.",
  updateState: "not_updated",
});
const timedOutUpdate = await updateTool.handler({
  pageId: "p_deck",
  title: "Timed out deck",
  html: '<main class="share-presentation"></main>',
});
assert.deepEqual(timedOutUpdate.structuredContent.error, {
  code: "update_state_unknown",
  message: "The request timed out.",
  updateState: "unknown",
});
const staleStyleUpdate = await updateTool.handler({
  pageId: "p_one",
  html: "<h1>Stale style</h1>",
  styleRef: { ...artifactStyleRef, revision: 99 },
});
assert.deepEqual(staleStyleUpdate.structuredContent.error, {
  code: "style_reference_conflict",
  message: "The style reference is no longer active.",
  updateState: "not_updated",
});
const invalidStyleUpdate = await updateTool.handler({
  pageId: "p_one",
  html: "<h1>Invalid style</h1>",
  styleRef: { ...artifactStyleRef, revision: 98 },
});
assert.deepEqual(invalidStyleUpdate.structuredContent.error, {
  code: "invalid_style_reference",
  message: "The style reference is invalid.",
  updateState: "not_updated",
});
const legacyStyleUpdate = await updateTool.handler({
  pageId: "p_one",
  title: "Legacy OAuth style scope",
  html: "<h1>Styled update</h1>",
  styleRef: artifactStyleRef,
});
assert.deepEqual(legacyStyleUpdate.structuredContent.error, {
  code: "insufficient_scope",
  message: expectedHostedStyleScopeError.message,
  updateState: "not_updated",
  details: expectedHostedStyleScopeError.details,
});
const rejectedToken = await publishTool.handler({
  title: "Rejected token",
  html: "<h1>Private</h1>",
});
assert.equal(rejectedToken.isError, true);
assert.deepEqual(rejectedToken.structuredContent.error, {
  code: "invalid_api_token",
  message: "The API token is invalid.",
  publicationState: "not_published",
});
const timedOut = await publishTool.handler({
  title: "Timed out",
  html: "<h1>Private</h1>",
});
assert.equal(timedOut.isError, true);
assert.deepEqual(timedOut.structuredContent.error, {
  code: "publication_state_unknown",
  message: "The request timed out.",
  publicationState: "unknown",
});
const failedTransaction = await publishTool.handler({
  title: "Database failure",
  html: "<h1>Private</h1>",
});
assert.equal(failedTransaction.isError, true);
assert.deepEqual(failedTransaction.structuredContent.error, {
  code: "controlled_publish_failed",
  message: "The controlled artifact was not published.",
  publicationState: "not_published",
});
assert.equal(
  publishTool.config.inputSchema.safeParse({
    html: "<h1>Private</h1>",
    sharing: {
      mode: "restricted",
      methods: { password: { action: "set", value: "private-password" } },
    },
  }).success,
  true,
);
for (const sharing of [
  { mode: "private", expiresAt: "2027-01-01T00:00:00.000Z" },
  { mode: "public" },
  { mode: "restricted", methods: { emailDomain: "example.com" } },
  { mode: "restricted", methods: { recipients: ["reader@example.com"] } },
]) {
  assert.equal(
    publishTool.config.inputSchema.safeParse({
      html: "<h1>Controlled</h1>",
      sharing,
    }).success,
    true,
  );
}
assert.equal(
  publishTool.config.inputSchema.safeParse({
    html: "<h1>Private</h1>",
    sharing: {
      mode: "restricted",
      methods: { recipients: ["not-an-email"] },
    },
  }).success,
  false,
);

const requestedPaths = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const requestedUrl = new URL(url);
  const path = requestedUrl.pathname;
  requestedPaths.push(path);
  const input = JSON.parse(init?.body ?? "{}");
  if (input.title === "Timeout update") {
    const error = new Error("simulated timeout");
    error.name = "TimeoutError";
    throw error;
  }
  if (input.clientRequestId === "style-timeout") {
    const error = new Error("simulated style timeout");
    error.name = "TimeoutError";
    throw error;
  }
  if (input.clientRequestId === "style-conflict-details") {
    return new Response(
      JSON.stringify({
        error: {
          code: "artifact_style_conflict",
          message: "The style changed elsewhere.",
          details: {
            currentRevision: 4,
            retryGuidance: "Get the active style and create a fresh preview.",
            privateDiagnostic: "must not escape",
          },
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );
  }
  if (input.clientRequestId === "missing-style-draft") {
    return new Response(
      JSON.stringify({
        error: {
          code: "artifact_style_draft_not_found",
          message: "Artifact style draft was not found.",
        },
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  if (
    path === "/api/v1/artifact-style/preview" &&
    input.definition?.name === "Rate Limited"
  ) {
    return new Response(
      JSON.stringify({
        error: {
          code: "artifact_style_rate_limited",
          message: "Private style preview rate exceeded.",
          retryAfterSeconds: 3600,
          retryGuidance: "Review the most recent private draft or wait.",
          privateDiagnostic: "must not escape",
        },
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  }
  if (
    path === "/api/v1/artifact-style" &&
    requestedUrl.searchParams.get("format") === "dashboard"
  ) {
    return new Response(
      JSON.stringify({
        error: {
          code: "insufficient_scope",
          message: "This connection needs styles:read access.",
          requiredScopes: ["styles:read"],
          reauthorizeUrl: "https://app.example/connect?intent=style",
          recovery: "Reconnect the agent and approve style access.",
          privateDiagnostic: "must not escape",
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }
  if (
    input.styleRef &&
    (path === "/api/v1/pages" || path === "/api/v1/pages/controlled")
  ) {
    return new Response(
      JSON.stringify({
        pageId: "p_styled",
        declaredStyleRef: input.styleRef,
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  }
  if (input.styleRef && path === "/api/v1/pages/p_legacy") {
    return new Response(
      JSON.stringify({
        pageId: "p_legacy",
        declaredStyleRef: input.styleRef,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (path === "/api/v1/pages" && (!init?.method || init.method === "GET")) {
    return new Response(
      JSON.stringify({
        pages: [
          {
            pageId: "p_legacy",
            title: "Legacy document",
            status: "published",
            publicUrl: "https://app.example/view/p_legacy",
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
        ],
        pageInfo: {
          limit: 25,
          resultCount: 1,
          matchingCount: 1,
          totalLibraryCount: 1,
          nextCursor: null,
          previousCursor: null,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  if (input.title === "Database failure") {
    return new Response(
      JSON.stringify({
        error: {
          code: "controlled_publish_failed",
          message: "The controlled artifact was not published.",
        },
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
  return new Response(
    JSON.stringify({
      error: { code: "page_not_found", message: "Page not found." },
    }),
    { status: 405, headers: { "content-type": "application/json" } },
  );
};
try {
  const apiClient = new ShareHtmlApiClient(
    "https://api.example.com/api/v1",
    "shp_contract_token",
  );
  const legacyList = await apiClient.listPages();
  assert.deepEqual(legacyList.pages[0], {
    artifactType: "document",
    artifactSchemaVersion: 1,
    artifactMetadata: {},
    pageId: "p_legacy",
    title: "Legacy document",
    status: "published",
    publicUrl: "https://app.example/view/p_legacy",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  });
  await assert.rejects(
    apiClient.publishPage({
      html: "<h1>Private</h1>",
      sharing: {
        mode: "restricted",
        methods: { password: { action: "set", value: "private-password" } },
      },
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "unsupported_controlled_publishing",
  );
  assert.deepEqual(requestedPaths, [
    "/api/v1/pages",
    "/api/v1/pages/controlled",
  ]);
  await assert.rejects(
    apiClient.publishPage({
      title: "Database failure",
      html: "<h1>Private</h1>",
      sharing: {
        mode: "restricted",
        methods: { password: { action: "set", value: "private-password" } },
      },
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "controlled_publish_failed",
  );
  assert.deepEqual(requestedPaths, [
    "/api/v1/pages",
    "/api/v1/pages/controlled",
    "/api/v1/pages/controlled",
  ]);
  await assert.rejects(
    apiClient.publishPresentation({
      title: "Old server",
      html: '<main class="share-presentation"></main>',
      presentation: { schemaVersion: 1, aspectRatio: "16:9" },
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "unsupported_presentation_publishing",
  );
  await assert.rejects(
    apiClient.updatePage("p_legacy", {
      title: "Timeout update",
      html: "<h1>Updated</h1>",
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "request_timeout" &&
      error.message.includes("get_page") &&
      error.message.includes("contentSha256") &&
      !error.message.includes("creation time"),
  );
  await assert.rejects(
    apiClient.previewArtifactStyle({ definition: artifactStyleDefinition }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "unsupported_artifact_styles" &&
      /nothing was activated.*upgrade.*reconnect/i.test(error.message),
  );
  await assert.rejects(
    apiClient.previewArtifactStyle({
      definition: { ...artifactStyleDefinition, name: "Rate Limited" },
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "artifact_style_rate_limited" &&
      error.status === 429 &&
      error.details?.retryAfterSeconds === 3600 &&
      error.details?.retryGuidance ===
        "Review the most recent private draft or wait." &&
      !("privateDiagnostic" in error.details),
  );
  await assert.rejects(
    apiClient.setArtifactStyle({
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      expectedRevision: 0,
      clientRequestId: "old-server",
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "unsupported_artifact_styles" &&
      /nothing was activated.*upgrade.*reconnect/i.test(error.message),
  );
  await assert.rejects(
    apiClient.getArtifactStyle({ format: "report" }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "unsupported_artifact_styles" &&
      /upgrade.*reconnect/i.test(error.message),
  );
  await assert.rejects(
    apiClient.setArtifactStyle({
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      expectedRevision: 0,
      clientRequestId: "style-timeout",
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "request_timeout" &&
      /identical.*draftId.*expectedRevision.*clientRequestId/i.test(error.message) &&
      error.details?.retryWithIdenticalArguments === true,
  );
  await assert.rejects(
    apiClient.setArtifactStyle({
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      expectedRevision: 3,
      clientRequestId: "style-conflict-details",
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "artifact_style_conflict" &&
      error.details?.currentRevision === 4 &&
      error.details?.retryGuidance ===
        "Get the active style and create a fresh preview." &&
      !("privateDiagnostic" in error.details),
  );
  await assert.rejects(
    apiClient.setArtifactStyle({
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      expectedRevision: 3,
      clientRequestId: "missing-style-draft",
    }),
    (error) =>
      error instanceof ShareHtmlApiError &&
      error.code === "artifact_style_draft_not_found" &&
      error.status === 404,
  );
  await assert.rejects(
    apiClient.getArtifactStyle({ format: "dashboard" }),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "insufficient_scope");
      assert.deepEqual(error.details, {
        requiredScopes: ["styles:read"],
        reauthorizeUrl: "https://app.example/connect?intent=style",
        retryGuidance: "Reconnect the agent and approve style access.",
      });
      return true;
    },
  );
  assert.deepEqual(
    await apiClient.publishPage({
      html: "<h1>Styled private report</h1>",
      styleRef: artifactStyleRef,
    }),
    { pageId: "p_styled", declaredStyleRef: artifactStyleRef },
  );
  assert.deepEqual(
    await apiClient.publishPage({
      html: "<h1>Styled public report</h1>",
      sharing: { mode: "public" },
      styleRef: artifactStyleRef,
    }),
    { pageId: "p_styled", declaredStyleRef: artifactStyleRef },
  );
  assert.deepEqual(
    await apiClient.updatePage("p_legacy", {
      html: "<h1>Styled update</h1>",
      styleRef: artifactStyleRef,
    }),
    { pageId: "p_legacy", declaredStyleRef: artifactStyleRef },
  );
  assert.deepEqual(requestedPaths, [
    "/api/v1/pages",
    "/api/v1/pages/controlled",
    "/api/v1/pages/controlled",
    "/api/v1/presentations",
    "/api/v1/pages/p_legacy",
    "/api/v1/artifact-style/preview",
    "/api/v1/artifact-style/preview",
    "/api/v1/artifact-style/activate",
    "/api/v1/artifact-style",
    "/api/v1/artifact-style/activate",
    "/api/v1/artifact-style/activate",
    "/api/v1/artifact-style/activate",
    "/api/v1/artifact-style",
    "/api/v1/pages",
    "/api/v1/pages/controlled",
    "/api/v1/pages/p_legacy",
  ]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("MCP contract passed: twelve direct tool bindings, strict artifact styles, safe errors, and compatibility.");
