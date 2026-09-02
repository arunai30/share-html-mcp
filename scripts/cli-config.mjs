import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  normalizeApiBaseUrl,
  ShareHtmlApiClient,
  ShareHtmlApiError,
} from "../dist/api-client.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secret = "shp_test_secret_that_must_not_be_logged";
const result = spawnSync(process.execPath, [path.join(packageRoot, "dist/index.js")], {
  encoding: "utf8",
  env: { ...process.env, SHARE_HTML_API_TOKEN: secret },
});

assert.equal(result.status, 1);
assert.match(
  result.stderr,
  /SHARE_HTML_API_BASE_URL and SHARE_HTML_API_TOKEN are required/,
);
assert.doesNotMatch(result.stderr, new RegExp(secret));

for (const invalidUrl of [
  "not-a-url",
  "http://api.example.com/api/v1",
  "ftp://api.example.com/api/v1",
  "https://user:password@api.example.com/api/v1",
  "https://api.example.com/api/v1?token=value",
  "https://api.example.com/api/v1#fragment",
]) {
  assert.throws(() => normalizeApiBaseUrl(invalidUrl));
}

for (const validUrl of [
  "https://api.example.com/api/v1",
  "http://127.0.0.1:3003/api/v1",
  "http://localhost:3003/api/v1",
  "http://[::1]:3003/api/v1",
]) {
  assert.doesNotThrow(() => new ShareHtmlApiClient(validUrl, secret));
}

assert.throws(
  () => new ShareHtmlApiClient("https://api.example.com/api/v1", "   "),
  /SHARE_HTML_API_TOKEN/,
);
assert.throws(
  () =>
    new ShareHtmlApiClient("https://api.example.com/api/v1", secret, {
      timeoutMs: 0,
    }),
  /timeoutMs/,
);

const fixture = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/success/pages") {
    response.end(JSON.stringify({ pages: [], pageInfo: { nextCursor: null } }));
    return;
  }
  if (
    request.url ===
    "/success/pages?query=Launch&status=unpublished&limit=40&cursor=next-page"
  ) {
    response.end(
      JSON.stringify({ pages: [], pageInfo: { nextCursor: "final-page" } }),
    );
    return;
  }
  if (request.url === "/success/recipes") {
    assert.equal(request.headers.authorization, undefined);
    response.end(
      JSON.stringify({ kind: "recipe_catalog", schemaVersion: 1, recipes: [] }),
    );
    return;
  }
  if (request.url === "/success/recipes/animated-meme?version=1") {
    assert.equal(request.headers.authorization, undefined);
    response.end(
      JSON.stringify({
        kind: "recipe",
        schemaVersion: 1,
        recipeId: "animated-meme",
        version: 1,
      }),
    );
    return;
  }
  if (request.url === "/success/recipes?version=1") {
    assert.equal(request.headers.authorization, undefined);
    response.statusCode = 400;
    response.end(
      JSON.stringify({
        error: {
          code: "invalid_recipe_request",
          message: "version requires a recipeId.",
        },
      }),
    );
    return;
  }
  if (request.url === "/client-error/pages") {
    response.statusCode = 401;
    response.end(
      JSON.stringify({
        error: {
          code: "invalid_api_token",
          message: `\u001b[31mThe token ${secret} is invalid.\u001b[0m`,
        },
      }),
    );
    return;
  }
  if (request.url === "/server-error/pages") {
    response.statusCode = 500;
    response.end(
      JSON.stringify({
        error: {
          code: "database_failure",
          message: `Private diagnostic containing ${secret}`,
        },
      }),
    );
    return;
  }
  if (request.url === "/invalid/pages") {
    response.statusCode = 200;
    response.end("not-json");
    return;
  }
  if (request.url === "/scalar/pages") {
    response.end(JSON.stringify(42));
    return;
  }
  if (request.url === "/timeout/pages") {
    setTimeout(() => response.end(JSON.stringify({ pages: [] })), 100);
    return;
  }
  if (request.url === "/body-timeout/pages") {
    response.write('{"pages":');
    setTimeout(() => response.end("[]}"), 100);
    return;
  }
  if (request.url === "/recipe-timeout/recipes") {
    setTimeout(
      () =>
        response.end(
          JSON.stringify({
            kind: "recipe_catalog",
            schemaVersion: 1,
            recipes: [],
          }),
        ),
      100,
    );
    return;
  }
  if (request.url === "/oversized/recipes") {
    response.setHeader("content-length", "2500001");
    response.end("{}");
    return;
  }
  if (request.url === "/chunked-oversized/recipes") {
    response.write(" ".repeat(1_300_000));
    response.end(" ".repeat(1_300_000));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: { code: "not_found" } }));
});

await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const address = fixture.address();
assert.ok(address && typeof address === "object");
const fixtureOrigin = `http://127.0.0.1:${address.port}`;

try {
  assert.deepEqual(
    await new ShareHtmlApiClient(`${fixtureOrigin}/success`, secret).listPages(),
    { pages: [], pageInfo: { nextCursor: null } },
  );
  assert.deepEqual(
    await new ShareHtmlApiClient(`${fixtureOrigin}/success`, secret).listPages({
      query: "Launch",
      status: "unpublished",
      limit: 40,
      cursor: "next-page",
    }),
    { pages: [], pageInfo: { nextCursor: "final-page" } },
  );
  assert.deepEqual(
    await new ShareHtmlApiClient(`${fixtureOrigin}/success`, secret).getRecipe({}),
    { kind: "recipe_catalog", schemaVersion: 1, recipes: [] },
  );
  assert.deepEqual(
    await new ShareHtmlApiClient(`${fixtureOrigin}/success`, secret).getRecipe({
      recipeId: "animated-meme",
      version: 1,
    }),
    {
      kind: "recipe",
      schemaVersion: 1,
      recipeId: "animated-meme",
      version: 1,
    },
  );
  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/success`, secret).getRecipe({
      version: 1,
    }),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_recipe_request");
      assert.equal(error.status, 400);
      assert.match(error.message, /requires a recipeId/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/client-error`, secret).listPages(),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_api_token");
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(error.message, /\u001b/);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/server-error`, secret).listPages(),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "http_error");
      assert.equal(error.status, 500);
      assert.match(error.message, /share\/artifacts API is unavailable/);
      assert.doesNotMatch(error.message, /diagnostic|database|shp_/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/invalid`, secret).listPages(),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_response");
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/scalar`, secret).listPages(),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_response");
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/timeout`, secret, {
      timeoutMs: 10,
    }).listPages(),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "request_timeout");
      assert.match(error.message, /share\/artifacts request timed out/);
      assert.match(error.message, /safe to retry list_pages/i);
      assert.doesNotMatch(error.message, /may have completed/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/body-timeout`, secret, {
      timeoutMs: 10,
    }).listPages(),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "request_timeout");
      assert.match(error.message, /safe to retry list_pages/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/recipe-timeout`, secret, {
      timeoutMs: 10,
    }).getRecipe({}),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "request_timeout");
      assert.match(error.message, /safe to retry get_recipe/i);
      assert.doesNotMatch(error.message, /may have completed/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/oversized`, secret).getRecipe({}),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_response");
      assert.match(error.message, /too large/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/chunked-oversized`, secret).getRecipe(
      {},
    ),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_response");
      assert.match(error.message, /too large/i);
      return true;
    },
  );

  await assert.rejects(
    new ShareHtmlApiClient(`${fixtureOrigin}/success`, secret).getRecipe({
      recipeId: "",
    }),
    (error) => {
      assert.ok(error instanceof ShareHtmlApiError);
      assert.equal(error.code, "invalid_recipe_request");
      assert.equal(error.status, 400);
      return true;
    },
  );
} finally {
  await new Promise((resolve, reject) =>
    fixture.close((error) => (error ? reject(error) : resolve())),
  );
}

await assert.rejects(
  new ShareHtmlApiClient(`${fixtureOrigin}/offline`, secret, {
    timeoutMs: 100,
  }).listPages(),
  (error) => {
    assert.ok(error instanceof ShareHtmlApiError);
    assert.equal(error.code, "network_error");
    assert.match(error.message, /share\/artifacts API/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  },
);

console.log(
  "MCP CLI check passed: configuration, HTTPS, timeout, redaction, and safe API errors.",
);
