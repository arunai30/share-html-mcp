#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { ShareHtmlApiClient } from "./api-client.js";
import { createShareHtmlServer } from "./server.js";

const token = process.env.SHARE_HTML_API_TOKEN;
const baseUrl = process.env.SHARE_HTML_API_BASE_URL?.replace(/\/+$/, "");

if (!token || !baseUrl) {
  console.error(
    "SHARE_HTML_API_BASE_URL and SHARE_HTML_API_TOKEN are required.",
  );
  process.exit(1);
}

const client = new ShareHtmlApiClient(baseUrl, token);
const server = createShareHtmlServer(client, client);
const transport = new StdioServerTransport();
await server.connect(transport);
