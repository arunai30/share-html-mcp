import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageSpec = process.env.SHARE_HTML_TEST_MCP_PACKAGE_SPEC;
const packageCwd = process.env.SHARE_HTML_TEST_MCP_CWD;
const token = "shp_mock_token_that_must_not_be_logged";
let tokenActive = true;
let page = null;
let sharing = null;
const archivePages = Array.from({ length: 125 }, (_, index) => ({
  artifactType: "document",
  artifactSchemaVersion: 1,
  artifactMetadata: {},
  pageId: `p_archive_${String(index).padStart(3, "0")}`,
  title: `Archive report ${String(index).padStart(3, "0")}`,
  status: index % 5 === 0 ? "unpublished" : "published",
  publicUrl: `https://app.example/view/p_archive_${String(index).padStart(3, "0")}`,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString(),
})).reverse();
const recipe = {
  kind: "recipe",
  schemaVersion: 1,
  recipeId: "animated-meme",
  version: 1,
  contentSha256: "a".repeat(64),
  title: "Animated Meme",
  summary: "A safe animated meme recipe.",
  prompt: "Build a static animated meme.",
  starterHtml: "<!doctype html><html><body><h1>Animated meme</h1></body></html>",
  rules: ["No JavaScript."],
  qualityChecklist: ["The punchline is readable."],
};

function childEnvironment(extra = {}) {
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
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_USERCONFIG",
  ];
  return {
    ...Object.fromEntries(
      allowedKeys
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    ),
    ...extra,
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || "{}");
}

const api = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/api/v1/recipes") {
    assert.equal(request.headers.authorization, undefined);
    sendJson(response, 200, {
      kind: "recipe_catalog",
      schemaVersion: 1,
      recipes: [
        {
          recipeId: recipe.recipeId,
          title: recipe.title,
          summary: recipe.summary,
          availableVersions: [1],
          latestVersion: 1,
          latestContentSha256: recipe.contentSha256,
        },
      ],
    });
    return;
  }
  const recipeMatch = url.pathname.match(/^\/api\/v1\/recipes\/([^/]+)$/);
  if (request.method === "GET" && recipeMatch) {
    assert.equal(request.headers.authorization, undefined);
    if (recipeMatch[1] !== "animated-meme") {
      sendJson(response, 404, {
        error: {
          code: "recipe_not_found",
          message:
            "Recipe not found. Call get_recipe with no arguments to rediscover the catalog.",
        },
      });
      return;
    }
    if (url.searchParams.has("version") && url.searchParams.get("version") !== "1") {
      sendJson(response, 404, {
        error: {
          code: "recipe_version_not_found",
          message:
            "Recipe version not found. Available versions: [1]. Latest version: 1; omit version to get the latest.",
        },
      });
      return;
    }
    sendJson(response, 200, recipe);
    return;
  }

  if (!tokenActive || request.headers.authorization !== `Bearer ${token}`) {
    sendJson(response, 401, {
      error: { code: "invalid_api_token", message: "The API token is invalid." },
    });
    return;
  }

  const pageMatch = url.pathname.match(/^\/api\/v1\/pages\/([^/]+)$/);
  const actionMatch = url.pathname.match(
    /^\/api\/v1\/pages\/([^/]+)\/(publish|unpublish)$/,
  );
  const sharingMatch = url.pathname.match(/^\/api\/v1\/pages\/([^/]+)\/sharing$/);
  const sessionsMatch = url.pathname.match(/^\/api\/v1\/pages\/([^/]+)\/sharing\/sessions$/);

  if (request.method === "GET" && url.pathname === "/api/v1/pages") {
    const query = url.searchParams.get("query")?.trim().toLowerCase();
    const status = url.searchParams.get("status");
    const limit = Number(url.searchParams.get("limit") ?? "25");
    const cursor = url.searchParams.get("cursor");
    const offset = cursor ? Number(cursor.replace(/^cursor_/, "")) : 0;
    const library = [...(page ? [page] : []), ...archivePages].filter(
      (candidate) =>
        (!query ||
          candidate.title.toLowerCase().includes(query) ||
          candidate.pageId.toLowerCase().includes(query)) &&
        (!status ||
          candidate.status === status ||
          (status === "unpublished" && candidate.status === "taken_down")),
    );
    const pages = library.slice(offset, offset + limit).map((candidate) => ({
      artifactType: candidate.artifactType,
      artifactSchemaVersion: candidate.artifactSchemaVersion,
      artifactMetadata: candidate.artifactMetadata,
      pageId: candidate.pageId,
      title: candidate.title,
      status: candidate.status,
      publicUrl: candidate.publicUrl,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    }));
    const nextOffset = offset + pages.length;
    sendJson(response, 200, {
      pages,
      pageInfo: {
        limit,
        resultCount: pages.length,
        matchingCount: library.length,
        totalLibraryCount: archivePages.length + (page ? 1 : 0),
        nextCursor: nextOffset < library.length ? `cursor_${nextOffset}` : null,
        previousCursor: offset > 0 ? `cursor_${Math.max(0, offset - limit)}` : null,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/pages") {
    const input = await readJson(request);
    page = {
      artifactType: "document",
      artifactSchemaVersion: 1,
      artifactMetadata: {},
      pageId: "p_mock",
      title: input.title ?? null,
      status: "published",
      version: 1,
      publicUrl: "https://app.example/view/p_mock",
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    sharing = {
      pageId: "p_mock",
      publicUrl: page.publicUrl,
      mode: "private",
      revision: 1,
      expiresAt: null,
      hasPassword: false,
      recipients: [],
      emailDomain: null,
    };
    sendJson(response, 201, page);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/presentations") {
    const input = await readJson(request);
    assert.deepEqual(input.presentation, {
      schemaVersion: 1,
      aspectRatio: "16:9",
    });
    page = {
      artifactSchemaVersion: 1,
      pageId: "p_mock_deck",
      title: input.title ?? null,
      status: "published",
      version: 1,
      artifactType: "presentation",
      artifactMetadata: {
        aspectRatio: "16:9",
        slideCount: 7,
      },
      publicUrl: "https://app.example/view/p_mock_deck",
      contentSha256: "b".repeat(64),
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    sharing = {
      pageId: page.pageId,
      publicUrl: page.publicUrl,
      mode: "private",
      revision: 1,
      expiresAt: null,
      hasPassword: false,
      recipients: [],
      emailDomain: null,
    };
    sendJson(response, 201, page);
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/v1/pages/controlled"
  ) {
    const input = await readJson(request);
    page = {
      artifactType: "document",
      artifactSchemaVersion: 1,
      artifactMetadata: {},
      pageId: "p_mock_controlled",
      title: input.title ?? null,
      status: "published",
      version: 1,
      publicUrl: "https://app.example/view/p_mock_controlled",
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    sharing = {
      pageId: page.pageId,
      publicUrl: page.publicUrl,
      mode: input.sharing.mode,
      revision: 2,
      expiresAt: input.sharing.expiresAt ?? null,
      hasPassword: Boolean(input.sharing.methods?.password),
      recipients: input.sharing.methods?.recipients ?? [],
      emailDomain: input.sharing.methods?.emailDomain ?? null,
    };
    sendJson(response, 201, { ...page, sharing });
    return;
  }

  if (pageMatch && pageMatch[1] === page?.pageId) {
    if (request.method === "GET") {
      sendJson(response, 200, page);
      return;
    }
    if (request.method === "PATCH") {
      const input = await readJson(request);
      page = {
        ...page,
        title: input.title ?? page.title,
        version: page.version + 1,
      };
      sendJson(response, 200, page);
      return;
    }
    if (request.method === "DELETE") {
      page = null;
      sendJson(response, 200, { ok: true });
      return;
    }
  }

  if (actionMatch && actionMatch[1] === page?.pageId && request.method === "POST") {
    if (actionMatch[2] === "publish" && page.status === "taken_down") {
      sendJson(response, 409, {
        error: {
          code: "page_taken_down",
          message:
            "This artifact was taken down by the platform and cannot be published.",
        },
      });
      return;
    }
    page = {
      ...page,
      status: actionMatch[2] === "publish" ? "published" : "unpublished",
    };
    sendJson(response, 200, page);
    return;
  }

  if (sharingMatch && sharingMatch[1] === page?.pageId) {
    if (request.method === "GET") {
      sendJson(response, 200, sharing);
      return;
    }
    if (request.method === "PUT") {
      const input = await readJson(request);
      if (input.expectedRevision !== sharing.revision) {
        sendJson(response, 409, {
          error: { code: "sharing_conflict", message: "Sharing changed elsewhere." },
        });
        return;
      }
      sharing = {
        ...sharing,
        mode: input.policy.mode,
        revision: sharing.revision + 1,
        expiresAt: input.policy.expiresAt ?? null,
        hasPassword: Boolean(input.policy.methods?.password),
        recipients: input.policy.methods?.recipients ?? [],
        emailDomain: input.policy.methods?.emailDomain ?? null,
      };
      sendJson(response, 200, sharing);
      return;
    }
  }

  if (sessionsMatch && sessionsMatch[1] === page?.pageId && request.method === "DELETE") {
    const input = await readJson(request);
    if (input.expectedRevision !== sharing.revision) {
      sendJson(response, 409, {
        error: { code: "sharing_conflict", message: "Sharing changed elsewhere." },
      });
      return;
    }
    sharing = { ...sharing, revision: sharing.revision + 1 };
    sendJson(response, 200, sharing);
    return;
  }

  sendJson(response, 404, {
    error: { code: "page_not_found", message: "Page not found." },
  });
});

await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const address = api.address();
assert.ok(address && typeof address === "object");

const client = new Client({ name: "share-html-public-release-check", version: "0.1.0" });

function value(result) {
  assert.equal(result.isError, undefined);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

try {
  const transport = new StdioClientTransport({
    command: packageSpec ? "npx" : process.execPath,
    args: packageSpec
      ? ["--yes", packageSpec]
      : [path.join(packageRoot, "dist/index.js")],
    cwd: packageCwd,
    env: childEnvironment({
      SHARE_HTML_API_BASE_URL: `http://127.0.0.1:${address.port}/api/v1`,
      SHARE_HTML_API_TOKEN: token,
    }),
    stderr: "pipe",
  });
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "delete_page",
      "end_current_viewing_sessions",
      "get_page",
      "get_page_sharing",
      "get_recipe",
      "list_pages",
      "publish_html",
      "publish_page",
      "publish_presentation",
      "set_page_sharing",
      "unpublish_page",
      "update_page",
    ],
  );

  const catalog = value(
    await client.callTool({ name: "get_recipe", arguments: {} }),
  );
  assert.equal(catalog.kind, "recipe_catalog");
  assert.equal(catalog.recipes[0].recipeId, "animated-meme");

  const latestRecipe = value(
    await client.callTool({
      name: "get_recipe",
      arguments: { recipeId: "animated-meme" },
    }),
  );
  const pinnedRecipe = value(
    await client.callTool({
      name: "get_recipe",
      arguments: { recipeId: "animated-meme", version: 1 },
    }),
  );
  assert.deepEqual(latestRecipe, pinnedRecipe);
  assert.equal(pinnedRecipe.contentSha256.length, 64);

  const missingRecipeVersion = await client.callTool({
    name: "get_recipe",
    arguments: { recipeId: "animated-meme", version: 2 },
  });
  assert.equal(missingRecipeVersion.isError, true);
  assert.match(
    missingRecipeVersion.content?.[0]?.text ?? "",
    /available versions.*omit version/i,
  );

  const missingRecipe = await client.callTool({
    name: "get_recipe",
    arguments: { recipeId: "unknown-recipe" },
  });
  assert.equal(missingRecipe.isError, true);
  assert.match(
    missingRecipe.content?.[0]?.text ?? "",
    /call get_recipe with no arguments/i,
  );

  const invalidRecipeInput = await client.callTool({
    name: "get_recipe",
    arguments: { version: 1 },
  });
  assert.equal(invalidRecipeInput.isError, true);

  const presentation = value(
    await client.callTool({
      name: "publish_presentation",
      arguments: {
        title: "Mock deck",
        html: '<main class="share-presentation"></main>',
      },
    }),
  );
  assert.equal(presentation.artifactType, "presentation");
  assert.equal(
    presentation.publicUrl,
    "https://app.example/view/p_mock_deck",
  );
  assert.equal(presentation.contentSha256.length, 64);

  const published = value(
    await client.callTool({
      name: "publish_html",
      arguments: { title: "Mock report", html: "<h1>Mock report</h1>" },
    }),
  );
  assert.equal(published.pageId, "p_mock");
  assert.equal(published.version, 1);

  const listed = value(await client.callTool({ name: "list_pages", arguments: {} }));
  assert.equal(listed.pages.length, 25);
  assert.equal(listed.pageInfo.totalLibraryCount, 126);
  assert.ok(listed.pages.some((candidate) => candidate.pageId === published.pageId));
  const searched = value(
    await client.callTool({
      name: "list_pages",
      arguments: { query: "Archive report 119", status: "published", limit: 10 },
    }),
  );
  assert.equal(searched.pages.length, 1);
  assert.equal(searched.pages[0].pageId, "p_archive_119");
  const traversed = [];
  let cursor;
  do {
    const batch = value(
      await client.callTool({
        name: "list_pages",
        arguments: { limit: 40, ...(cursor ? { cursor } : {}) },
      }),
    );
    traversed.push(...batch.pages.map((candidate) => candidate.pageId));
    cursor = batch.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(traversed.length, 126);
  assert.equal(new Set(traversed).size, 126);
  assert.equal(
    value(
      await client.callTool({
        name: "get_page",
        arguments: { pageId: published.pageId },
      }),
    ).publicUrl,
    published.publicUrl,
  );

  const updated = value(
    await client.callTool({
      name: "update_page",
      arguments: { pageId: published.pageId, html: "<h1>Updated</h1>" },
    }),
  );
  assert.equal(updated.version, 2);

  const initialSharing = value(
    await client.callTool({
      name: "get_page_sharing",
      arguments: { pageId: published.pageId },
    }),
  );
  const passwordSharing = value(
    await client.callTool({
      name: "set_page_sharing",
      arguments: {
        pageId: published.pageId,
        expectedRevision: initialSharing.revision,
        policy: {
          mode: "restricted",
          methods: {
            password: { action: "set", value: "mock-private-password" },
          },
        },
      },
    }),
  );
  assert.equal(passwordSharing.mode, "restricted");
  const stale = await client.callTool({
    name: "set_page_sharing",
    arguments: {
      pageId: published.pageId,
      expectedRevision: initialSharing.revision,
      policy: { mode: "public" },
    },
  });
  assert.equal(stale.isError, true);
  assert.equal(value({ ...stale, isError: undefined }).error.code, "sharing_conflict");

  assert.equal(
    value(await client.callTool({
      name: "end_current_viewing_sessions",
      arguments: { pageId: published.pageId, expectedRevision: passwordSharing.revision },
    })).revision,
    passwordSharing.revision + 1,
  );

  const unpublished = value(
    await client.callTool({
      name: "unpublish_page",
      arguments: { pageId: published.pageId },
    }),
  );
  assert.equal(unpublished.status, "unpublished");

  const republished = value(
    await client.callTool({
      name: "publish_page",
      arguments: { pageId: published.pageId },
    }),
  );
  assert.equal(republished.status, "published");

  page = { ...page, status: "taken_down" };
  const heldList = value(
    await client.callTool({
      name: "list_pages",
      arguments: { status: "unpublished", query: published.pageId },
    }),
  );
  assert.equal(heldList.pages.length, 1);
  assert.equal(heldList.pages[0].status, "taken_down");
  const blockedRepublish = await client.callTool({
    name: "publish_page",
    arguments: { pageId: published.pageId },
  });
  assert.equal(blockedRepublish.isError, true);
  assert.equal(
    value({ ...blockedRepublish, isError: undefined }).error.code,
    "page_taken_down",
  );

  assert.equal(
    value(
      await client.callTool({
        name: "delete_page",
        arguments: { pageId: published.pageId },
      }),
    ).ok,
    true,
  );

  const controlled = value(
    await client.callTool({
      name: "publish_html",
      arguments: {
        title: "Private report",
        html: "<h1>Private report</h1>",
        sharing: {
          mode: "restricted",
          methods: {
            emailDomain: "example.com",
            recipients: ["reader@example.com"],
          },
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
      },
    }),
  );
  assert.equal(controlled.pageId, "p_mock_controlled");
  assert.equal(controlled.sharing.mode, "restricted");
  assert.equal(controlled.sharing.emailDomain, "example.com");
  assert.equal(controlled.sharing.revision, 2);
  assert.deepEqual(controlled.sharing.recipients, ["reader@example.com"]);

  tokenActive = false;
  const rejected = await client.callTool({ name: "list_pages", arguments: {} });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content?.[0]?.text ?? "", /invalid/i);
  assert.doesNotMatch(rejected.content?.[0]?.text ?? "", new RegExp(token));

  console.log(
    "Public MCP integration passed: twelve tools, presentations, sharing parity, recipes, and safe auth failure.",
  );
} finally {
  await client.close().catch(() => undefined);
  await new Promise((resolve, reject) =>
    api.close((error) => (error ? reject(error) : resolve())),
  );
}
