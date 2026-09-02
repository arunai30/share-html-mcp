import assert from "node:assert/strict";

import {
  ShareHtmlApiClient,
  ShareHtmlApiError,
} from "../dist/api-client.js";
import { registerShareHtmlTools } from "../dist/server.js";

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

registerShareHtmlTools(server, operations);

assert.deepEqual([...registered.keys()].sort(), [
  "delete_page",
  "get_page",
  "get_recipe",
  "list_pages",
  "publish_html",
  "publish_page",
  "publish_presentation",
  "unpublish_page",
  "update_page",
]);
assert.deepEqual(calls, [], "registration must not execute page operations");

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
await registered.get("publish_presentation").handler({
  title: "Quarterly story",
  html: '<main class="share-presentation"></main>',
  presentation: { schemaVersion: 1, aspectRatio: "16:9" },
});
await registered
  .get("update_page")
  .handler({ pageId: "p_one", html: "<h1>Updated</h1>" });
await registered.get("publish_page").handler({ pageId: "p_one" });
await registered.get("unpublish_page").handler({ pageId: "p_one" });
await registered.get("delete_page").handler({ pageId: "p_one" });

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
    "publishPresentation",
    {
      title: "Quarterly story",
      html: '<main class="share-presentation"></main>',
      presentation: { schemaVersion: 1, aspectRatio: "16:9" },
    },
  ],
  ["updatePage", "p_one", { title: undefined, html: "<h1>Updated</h1>" }],
  ["publishExistingPage", "p_one"],
  ["unpublishPage", "p_one"],
  ["deletePage", "p_one"],
]);

for (const { config } of registered.values()) {
  assert.equal(typeof config.inputSchema?.safeParse, "function");
}

const recipeTool = registered.get("get_recipe");
assert.match(recipeTool.config.description, /share\/artifacts/);
assert.doesNotMatch(recipeTool.config.description, /share\/html/);
assert.deepEqual(recipeTool.config.annotations, {
  readOnlyHint: true,
  destructiveHint: false,
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

const presentationTool = registered.get("publish_presentation");
assert.match(presentationTool.config.description, /slides|deck/i);
assert.match(presentationTool.config.description, /get_recipe/);
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
  const path = new URL(url).pathname;
  requestedPaths.push(path);
  const input = JSON.parse(init?.body ?? "{}");
  if (input.title === "Timeout update") {
    const error = new Error("simulated timeout");
    error.name = "TimeoutError";
    throw error;
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
  assert.deepEqual(requestedPaths, [
    "/api/v1/pages",
    "/api/v1/pages/controlled",
    "/api/v1/pages/controlled",
    "/api/v1/presentations",
    "/api/v1/pages/p_legacy",
  ]);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("MCP contract passed: nine core tool bindings and safe presentation publishing.");
