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
  if (!tokenActive || request.headers.authorization !== `Bearer ${token}`) {
    sendJson(response, 401, {
      error: { code: "invalid_api_token", message: "The API token is invalid." },
    });
    return;
  }

  const url = new URL(request.url, "http://127.0.0.1");
  const pageMatch = url.pathname.match(/^\/api\/v1\/pages\/([^/]+)$/);
  const actionMatch = url.pathname.match(
    /^\/api\/v1\/pages\/([^/]+)\/(publish|unpublish)$/,
  );

  if (request.method === "GET" && url.pathname === "/api/v1/pages") {
    sendJson(response, 200, { pages: page ? [page] : [] });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/v1/pages") {
    const input = await readJson(request);
    page = {
      pageId: "p_mock",
      title: input.title ?? null,
      status: "published",
      version: 1,
      publicUrl: "https://pages.example/p/p_mock",
    };
    sendJson(response, 201, page);
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
    page = {
      ...page,
      status: actionMatch[2] === "publish" ? "published" : "unpublished",
    };
    sendJson(response, 200, page);
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
      "get_page",
      "list_pages",
      "publish_html",
      "publish_page",
      "unpublish_page",
      "update_page",
    ],
  );

  const published = value(
    await client.callTool({
      name: "publish_html",
      arguments: { title: "Mock report", html: "<h1>Mock report</h1>" },
    }),
  );
  assert.equal(published.pageId, "p_mock");
  assert.equal(published.version, 1);

  const listed = value(await client.callTool({ name: "list_pages", arguments: {} }));
  assert.equal(listed.pages.length, 1);
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

  assert.equal(
    value(
      await client.callTool({
        name: "delete_page",
        arguments: { pageId: published.pageId },
      }),
    ).ok,
    true,
  );

  tokenActive = false;
  const rejected = await client.callTool({ name: "list_pages", arguments: {} });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content?.[0]?.text ?? "", /invalid/i);
  assert.doesNotMatch(rejected.content?.[0]?.text ?? "", new RegExp(token));

  console.log("Public MCP integration passed: seven tools and safe auth failure.");
} finally {
  await client.close().catch(() => undefined);
  await new Promise((resolve, reject) =>
    api.close((error) => (error ? reject(error) : resolve())),
  );
}
