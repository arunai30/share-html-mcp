import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { artifactStyleDefinition } from "./artifact-style-fixture.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageSpec = process.env.SHARE_HTML_TEST_MCP_PACKAGE_SPEC;
const packageCwd = process.env.SHARE_HTML_TEST_MCP_CWD;
const token = "shp_mock_token_that_must_not_be_logged";
let tokenActive = true;
let page = null;
let pageHtml = "";
let sharing = null;
let artifactStyleDraft = null;
let artifactStyleProfile = { status: "not_configured", revision: 0 };
let artifactStyleActivation = null;
let templateDraft = null;
let savedTemplate = null;
const templateId = "00000000-0000-4000-8000-000000000001";
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

function sendLegacyStyleScopeError(response) {
  sendJson(response, 403, {
    error: {
      code: "insufficient_scope",
      message:
        "This API token does not have styles:read access. Create a replacement token to continue.",
      requiredScopes: ["styles:read"],
      reauthorizeUrl: "https://app.example/settings/tokens",
      recovery:
        "Create a replacement personal token with the required scopes, update the agent locally, then revoke the old token.",
      privateDiagnostic: "must not escape",
    },
  });
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

  if (request.method === "POST" && url.pathname === "/api/v1/templates/preview") {
    const input = await readJson(request);
    assert.deepEqual(input, { name: "Board deck", description: "Monthly review", html: "<main>Example</main>", designNotes: "", format: "presentation", aspectRatio: "16:9" });
    templateDraft = { draftId: templateId, name: input.name, description: input.description, status: "draft", reviewUrl: `https://app.example/templates/review/${templateId}` };
    sendJson(response, 201, templateDraft);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/v1/templates/save") {
    const input = await readJson(request);
    assert.deepEqual(input, { draftId: templateId });
    assert.ok(templateDraft);
    savedTemplate ??= { templateId, name: templateDraft.name, description: templateDraft.description, format: "presentation", aspectRatio: "16:9", slideCount: 1, savedAt: "2026-09-30T12:00:00.000Z" };
    sendJson(response, 200, { ...savedTemplate, status: "saved" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/v1/templates") {
    assert.equal(url.searchParams.get("limit"), "20");
    sendJson(response, 200, { templates: savedTemplate ? [savedTemplate] : [], nextCursor: null });
    return;
  }
  if (request.method === "GET" && url.pathname === `/api/v1/templates/${templateId}`) {
    if (!savedTemplate) {
      sendJson(response, 404, { error: { code: "template_not_found", message: "Template not found." } });
    } else {
      sendJson(response, 200, { ...savedTemplate, designNotes: "", ...(url.searchParams.get("includeHtml") === "true" ? { html: "<main>Example</main>" } : {}) });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/v1/artifact-style") {
    const format = url.searchParams.get("format");
    assert.ok(["report", "dashboard", "explainer", "presentation"].includes(format));
    const { definition, ...identity } = artifactStyleProfile;
    sendJson(
      response,
      200,
      artifactStyleProfile.status === "configured"
        ? {
            ...(format === "presentation"
              ? { ...identity, appearance: { composition: definition.composition } }
              : artifactStyleProfile),
            format,
            guidance: `Format: ${format}\nUse asymmetric evidence-led composition.`,
          }
        : artifactStyleProfile,
    );
    return;
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/v1/artifact-style/preview"
  ) {
    const input = await readJson(request);
    assert.deepEqual(input.definition, artifactStyleDefinition);
    artifactStyleDraft = {
      status: "pending",
      draftId: "1f5f93e1-d137-4a25-b067-65de57e7225c",
      baseProfileRevision: artifactStyleProfile.revision,
      definition: input.definition,
      contentSha256: "e".repeat(64),
      canonicalSummary: "Airy asymmetric layout with visible values.",
      reviewUrl:
        "https://app.example/settings/style?draft=1f5f93e1-d137-4a25-b067-65de57e7225c",
      expiresAt: "2026-09-04T13:00:00.000Z",
    };
    sendJson(response, 201, artifactStyleDraft);
    return;
  }

  if (
    request.method === "PUT" &&
    url.pathname === "/api/v1/artifact-style/activate"
  ) {
    const input = await readJson(request);
    if (!artifactStyleDraft || input.draftId !== artifactStyleDraft.draftId) {
      sendJson(response, 404, {
        error: {
          code: "artifact_style_draft_not_found",
          message: "Artifact style draft was not found.",
        },
      });
      return;
    }
    if (artifactStyleActivation) {
      assert.deepEqual(input, artifactStyleActivation.input);
      sendJson(response, 200, artifactStyleActivation.result);
      return;
    }
    assert.deepEqual(input, {
      draftId: artifactStyleDraft.draftId,
      expectedRevision: artifactStyleDraft.baseProfileRevision,
      clientRequestId: "mock-style-activation-1",
    });
    artifactStyleProfile = {
      status: "configured",
      revision: artifactStyleProfile.revision + 1,
      styleVersionId: "497b866b-bc15-439b-a7eb-954fe0eab25b",
      definition: artifactStyleDraft.definition,
      contentSha256: artifactStyleDraft.contentSha256,
      canonicalSummary: artifactStyleDraft.canonicalSummary,
    };
    artifactStyleActivation = { input, result: artifactStyleProfile };
    sendJson(response, 200, artifactStyleProfile);
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
    if (input.title === "Legacy personal token") {
      sendLegacyStyleScopeError(response);
      return;
    }
    pageHtml = input.html;
    page = {
      artifactType: "document",
      artifactSchemaVersion: 1,
      artifactMetadata: {},
      pageId: "p_mock",
      title: input.title ?? null,
      status: "published",
      version: 1,
      publicUrl: "https://app.example/view/p_mock",
      contentSha256: "c".repeat(64),
      declaredStyleRef: input.styleRef ?? null,
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
    pageHtml = input.html;
    assert.deepEqual(input.presentation, {
      schemaVersion: 1,
      aspectRatio: "16:9",
    });
    page = {
      artifactSchemaVersion: 1,
      pageId: "p_mock_deck",
      declaredStyleRef: input.styleRef ?? null,
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
    if (input.title === "Legacy personal token") {
      sendLegacyStyleScopeError(response);
      return;
    }
    page = {
      artifactType: "document",
      artifactSchemaVersion: 1,
      artifactMetadata: {},
      pageId: "p_mock_controlled",
      title: input.title ?? null,
      status: "published",
      version: 1,
      publicUrl: "https://app.example/view/p_mock_controlled",
      contentSha256: "c".repeat(64),
      declaredStyleRef: input.styleRef ?? null,
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
      if (url.searchParams.get("includeHtmlSource") === "true" && page.artifactType !== "presentation") {
        sendJson(response, 422, { error: { code: "html_source_unsupported", message: "HTML source handoff is supported only for presentations." } });
        return;
      }
      sendJson(response, 200, {
        ...page,
        ...(url.searchParams.get("includeHtmlSource") === "true"
          ? { htmlSource: { format: "sanitized-html", html: pageHtml } } : {}),
      });
      return;
    }
    if (request.method === "PATCH") {
      const input = await readJson(request);
      if (input.title === "Legacy personal token") {
        sendLegacyStyleScopeError(response);
        return;
      }
      if (input.expectedVersion !== undefined && input.expectedVersion !== page.version) {
        sendJson(response, 409, { error: {
          code: "page_version_conflict", message: "Get the current page and review it before retrying.",
          details: { currentVersion: page.version, privateDiagnostic: "must not escape" },
        } });
        return;
      }
      pageHtml = input.html;
      page = {
        ...page,
        title: input.title ?? page.title,
        version: page.version + 1,
        contentSha256: "d".repeat(64),
        declaredStyleRef: input.styleRef ?? null,
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

function errorValue(result) {
  assert.equal(result.isError, true);
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

  assert.equal(client.getServerVersion()?.version, "0.3.0");
  const instructions = client.getInstructions() ?? "";
  assert.match(instructions, /pm-decision-deck.*product manager.*otherwise.*presentation-deck/);
  assert.match(instructions, /separate publication approval/);
  assert.match(instructions, /"in my style"/i);
  assert.match(instructions, /get_recipe and get_artifact_style.*before generating/i);
  assert.match(instructions, /owner-authored appearance data/i);
  assert.match(instructions, /source truth.*recipe structure.*Safe Static.*sharing/i);
  assert.match(instructions, /declared provenance, not visual fidelity/i);
  assert.match(instructions, /format "presentation" for decks/);
  assert.match(instructions, /preserve its source styling.*do not automatically restyle/);
  assert.match(instructions, /stale styleRef.*user decision.*never silently drop/);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "delete_page",
      "end_current_viewing_sessions",
      "generate_diagram",
      "get_artifact_style",
      "get_page",
      "get_page_sharing",
      "get_recipe",
      "get_template",
      "list_pages",
      "list_templates",
      "preview_artifact_style",
      "preview_template",
      "publish_html",
      "publish_page",
      "publish_presentation",
      "save_template",
      "set_artifact_style",
      "set_page_sharing",
      "unpublish_page",
      "update_page",
    ],
  );

  assert.deepEqual(value(await client.callTool({ name: "list_templates", arguments: {} })), { templates: [], nextCursor: null });
  const templatePreview = value(await client.callTool({ name: "preview_template", arguments: { name: "Board deck", description: "Monthly review", html: "<main>Example</main>" } }));
  assert.equal(templatePreview.draftId, templateId);
  assert.equal(templatePreview.html, undefined);
  const templateSaved = value(await client.callTool({ name: "save_template", arguments: { draftId: templateId } }));
  assert.equal(templateSaved.status, "saved");
  assert.deepEqual(value(await client.callTool({ name: "save_template", arguments: { draftId: templateId } })), templateSaved);
  const templateList = value(await client.callTool({ name: "list_templates", arguments: {} }));
  assert.equal(templateList.templates.length, 1);
  assert.equal(templateList.templates[0].html, undefined);
  const templateMetadata = value(await client.callTool({ name: "get_template", arguments: { templateId } }));
  assert.equal(templateMetadata.html, undefined);
  const templateSource = value(await client.callTool({ name: "get_template", arguments: { templateId, includeHtml: true } }));
  assert.equal(templateSource.html, "<main>Example</main>");
  assert.equal(page, null, "Saving a template must not publish an artifact.");
  assert.deepEqual(artifactStyleProfile, { status: "not_configured", revision: 0 });

  const unconfiguredStyle = value(
    await client.callTool({
      name: "get_artifact_style",
      arguments: { format: "report" },
    }),
  );
  assert.deepEqual(unconfiguredStyle, { status: "not_configured", revision: 0 });

  const stylePreview = value(
    await client.callTool({
      name: "preview_artifact_style",
      arguments: { definition: artifactStyleDefinition },
    }),
  );
  assert.equal(stylePreview.status, "pending");
  assert.equal(stylePreview.baseProfileRevision, 0);
  assert.match(stylePreview.draftId, /^[0-9a-f-]{36}$/);
  assert.match(stylePreview.contentSha256, /^[a-f0-9]{64}$/);
  assert.match(stylePreview.reviewUrl, /\/settings\/style\?draft=/);
  assert.match(stylePreview.canonicalSummary, /asymmetric/i);
  assert.equal("name" in stylePreview.definition, false);
  assert.equal("summary" in stylePreview.definition, false);

  const styleActivationInput = {
    draftId: stylePreview.draftId,
    expectedRevision: stylePreview.baseProfileRevision,
    clientRequestId: "mock-style-activation-1",
  };
  const activatedStyle = value(
    await client.callTool({
      name: "set_artifact_style",
      arguments: styleActivationInput,
    }),
  );
  assert.equal(activatedStyle.status, "configured");
  assert.equal(activatedStyle.revision, 1);
  assert.equal(activatedStyle.contentSha256, stylePreview.contentSha256);
  assert.equal("name" in activatedStyle.definition, false);
  assert.equal("summary" in activatedStyle.definition, false);
  const repeatedActivation = value(
    await client.callTool({
      name: "set_artifact_style",
      arguments: styleActivationInput,
    }),
  );
  assert.deepEqual(repeatedActivation, activatedStyle);

  const configuredStyle = value(
    await client.callTool({
      name: "get_artifact_style",
      arguments: { format: "dashboard" },
    }),
  );
  assert.equal(configuredStyle.status, "configured");
  assert.equal(configuredStyle.styleVersionId, activatedStyle.styleVersionId);
  assert.match(configuredStyle.guidance, /Format: dashboard/);
  assert.equal("name" in configuredStyle.definition, false);
  assert.equal("summary" in configuredStyle.definition, false);
  const activeStyleRef = {
    styleVersionId: configuredStyle.styleVersionId,
    revision: configuredStyle.revision,
    contentSha256: configuredStyle.contentSha256,
  };

  const personalTokenStyleScopeError = {
    code: "insufficient_scope",
    message:
      "This API token does not have styles:read access. Create a replacement token to continue.",
    publicationState: "not_published",
    details: {
      requiredScopes: ["styles:read"],
      reauthorizeUrl: "https://app.example/settings/tokens",
      retryGuidance:
        "Create a replacement personal token with the required scopes, update the agent locally, then revoke the old token.",
    },
  };
  const legacyPublish = errorValue(
    await client.callTool({
      name: "publish_html",
      arguments: {
        title: "Legacy personal token",
        html: "<h1>Styled report</h1>",
        styleRef: activeStyleRef,
      },
    }),
  );
  assert.deepEqual(legacyPublish.error, personalTokenStyleScopeError);
  assert.doesNotMatch(JSON.stringify(legacyPublish), /privateDiagnostic/);

  const legacyControlledPublish = errorValue(
    await client.callTool({
      name: "publish_html",
      arguments: {
        title: "Legacy personal token",
        html: "<h1>Styled private report</h1>",
        sharing: { mode: "private" },
        styleRef: activeStyleRef,
      },
    }),
  );
  assert.deepEqual(
    legacyControlledPublish.error,
    personalTokenStyleScopeError,
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

  const presentationStyle = value(await client.callTool({
    name: "get_artifact_style", arguments: { format: "presentation" },
  }));
  assert.equal(presentationStyle.format, "presentation");
  assert.equal(presentationStyle.definition, undefined);
  assert.equal(presentationStyle.contentSha256, activeStyleRef.contentSha256);
  const presentation = value(
    await client.callTool({
      name: "publish_presentation",
      arguments: {
        title: "Mock deck",
        html: '<main class="share-presentation"></main>',
        styleRef: activeStyleRef,
      },
    }),
  );
  assert.equal(presentation.artifactType, "presentation");
  assert.deepEqual(presentation.declaredStyleRef, activeStyleRef);
  assert.equal(
    presentation.publicUrl,
    "https://app.example/view/p_mock_deck",
  );
  assert.equal(presentation.contentSha256.length, 64);

  const editBase = value(await client.callTool({ name: "get_page", arguments: { pageId: presentation.pageId, includeHtmlSource: true } }));
  assert.deepEqual(editBase.htmlSource, { format: "sanitized-html", html: '<main class="share-presentation"></main>' });
  assert.equal(editBase.version, 1);
  const reviewedHtml = '<main class="share-presentation"><section>Reviewed slide</section></main>';
  const guardedUpdate = value(await client.callTool({ name: "update_page", arguments: { pageId: presentation.pageId, html: reviewedHtml, expectedVersion: editBase.version } }));
  assert.equal(guardedUpdate.version, 2);
  assert.equal(guardedUpdate.publicUrl, presentation.publicUrl);
  const staleUpdate = errorValue(await client.callTool({ name: "update_page", arguments: { pageId: presentation.pageId, html: "<h1>Stale update</h1>", expectedVersion: editBase.version } }));
  assert.equal(staleUpdate.error.code, "page_version_conflict");
  assert.equal(staleUpdate.error.updateState, "not_updated");
  assert.deepEqual(staleUpdate.error.details, { currentVersion: 2 });
  assert.equal(value(await client.callTool({ name: "get_page", arguments: { pageId: presentation.pageId } })).htmlSource, undefined);
  assert.equal(value(await client.callTool({ name: "get_page", arguments: { pageId: presentation.pageId, includeHtmlSource: true } })).htmlSource.html, reviewedHtml);

  const published = value(
    await client.callTool({
      name: "publish_html",
      arguments: {
        title: "Mock report",
        html: "<h1>Mock report</h1>",
        styleRef: activeStyleRef,
      },
    }),
  );
  assert.equal(published.pageId, "p_mock");
  assert.equal(published.version, 1);
  assert.deepEqual(published.declaredStyleRef, activeStyleRef);

  const legacyUpdate = errorValue(
    await client.callTool({
      name: "update_page",
      arguments: {
        pageId: published.pageId,
        title: "Legacy personal token",
        html: "<h1>Styled update</h1>",
        styleRef: activeStyleRef,
      },
    }),
  );
  assert.deepEqual(legacyUpdate.error, {
    code: personalTokenStyleScopeError.code,
    message: personalTokenStyleScopeError.message,
    updateState: "not_updated",
    details: personalTokenStyleScopeError.details,
  });

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
  assert.equal(updated.pageId, published.pageId);
  assert.equal(updated.publicUrl, published.publicUrl);
  assert.notEqual(updated.contentSha256, published.contentSha256);
  assert.equal(updated.version, 2);
  assert.equal(updated.declaredStyleRef, null);

  assert.equal(errorValue(await client.callTool({ name: "get_page", arguments: { pageId: published.pageId, includeHtmlSource: true } })).error.code, "html_source_unsupported");

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
        styleRef: activeStyleRef,
      },
    }),
  );
  assert.equal(controlled.pageId, "p_mock_controlled");
  assert.equal(controlled.sharing.mode, "restricted");
  assert.equal(controlled.sharing.emailDomain, "example.com");
  assert.equal(controlled.sharing.revision, 2);
  assert.deepEqual(controlled.sharing.recipients, ["reader@example.com"]);
  assert.deepEqual(controlled.declaredStyleRef, activeStyleRef);

  tokenActive = false;
  const rejected = await client.callTool({ name: "list_pages", arguments: {} });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content?.[0]?.text ?? "", /invalid/i);
  assert.doesNotMatch(rejected.content?.[0]?.text ?? "", new RegExp(token));

  console.log(
    "Public MCP integration passed: twenty tools, private templates, styles, presentations, sharing parity, recipes, and safe auth failure.",
  );
} finally {
  await client.close().catch(() => undefined);
  await new Promise((resolve, reject) =>
    api.close((error) => (error ? reject(error) : resolve())),
  );
}
