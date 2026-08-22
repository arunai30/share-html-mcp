import assert from "node:assert/strict";

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
  async listPages() {
    calls.push(["listPages"]);
    return { pages: [] };
  },
  async getPage(pageId) {
    calls.push(["getPage", pageId]);
    return { pageId };
  },
  async publishPage(input) {
    calls.push(["publishPage", input]);
    return { pageId: "p_new" };
  },
  async updatePage(pageId, input) {
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
  "list_pages",
  "publish_html",
  "publish_page",
  "unpublish_page",
  "update_page",
]);
assert.deepEqual(calls, [], "registration must not execute page operations");

await registered.get("list_pages").handler({});
await registered.get("get_page").handler({ pageId: "p_one" });
await registered
  .get("publish_html")
  .handler({ title: "Report", html: "<h1>Report</h1>" });
await registered
  .get("update_page")
  .handler({ pageId: "p_one", html: "<h1>Updated</h1>" });
await registered.get("publish_page").handler({ pageId: "p_one" });
await registered.get("unpublish_page").handler({ pageId: "p_one" });
await registered.get("delete_page").handler({ pageId: "p_one" });

assert.deepEqual(calls, [
  ["listPages"],
  ["getPage", "p_one"],
  ["publishPage", { title: "Report", html: "<h1>Report</h1>" }],
  ["updatePage", "p_one", { title: undefined, html: "<h1>Updated</h1>" }],
  ["publishExistingPage", "p_one"],
  ["unpublishPage", "p_one"],
  ["deletePage", "p_one"],
]);

for (const { config } of registered.values()) {
  assert.equal(typeof config.inputSchema?.safeParse, "function");
}

console.log("MCP contract passed: seven side-effect-free structural tool bindings.");
