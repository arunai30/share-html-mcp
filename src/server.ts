import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { MCP_SERVER_VERSION } from "./version.js";

export interface PageOperations {
  listPages(): Promise<Record<string, unknown>>;
  getPage(pageId: string): Promise<Record<string, unknown>>;
  publishPage(input: {
    title?: string;
    html: string;
  }): Promise<Record<string, unknown>>;
  updatePage(
    pageId: string,
    input: { title?: string; html: string },
  ): Promise<Record<string, unknown>>;
  publishExistingPage(pageId: string): Promise<Record<string, unknown>>;
  unpublishPage(pageId: string): Promise<Record<string, unknown>>;
  deletePage(pageId: string): Promise<Record<string, unknown>>;
}

function toolResult(value: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  };
}

export function registerShareHtmlTools(
  server: McpServer,
  operations: PageOperations,
) {
  server.registerTool(
    "publish_html",
    {
      title: "Publish static HTML",
      description:
        "Publish a complete static HTML document and return its shareable URL.",
      inputSchema: z.object({
        title: z.string().max(120).optional(),
        html: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => toolResult(await operations.publishPage(input)),
  );

  server.registerTool(
    "update_page",
    {
      title: "Update a published page",
      description:
        "Replace a page with new static HTML while preserving its shareable URL.",
      inputSchema: z.object({
        pageId: z.string().min(1),
        title: z.string().max(120).optional(),
        html: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ pageId, title, html }) =>
      toolResult(await operations.updatePage(pageId, { title, html })),
  );

  server.registerTool(
    "get_page",
    {
      title: "Get page details",
      description: "Get the current status, version, and URL for one page.",
      inputSchema: z.object({
        pageId: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ pageId }) => toolResult(await operations.getPage(pageId)),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description: "List the current user's non-deleted published artifacts.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => toolResult(await operations.listPages()),
  );

  server.registerTool(
    "publish_page",
    {
      title: "Republish a page",
      description: "Bring an unpublished page back online at its existing URL.",
      inputSchema: z.object({
        pageId: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ pageId }) =>
      toolResult(await operations.publishExistingPage(pageId)),
  );

  server.registerTool(
    "unpublish_page",
    {
      title: "Unpublish a page",
      description:
        "Take a page offline without deleting it or changing its shareable URL.",
      inputSchema: z.object({
        pageId: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ pageId }) => toolResult(await operations.unpublishPage(pageId)),
  );

  server.registerTool(
    "delete_page",
    {
      title: "Delete a page",
      description: "Permanently remove a page from the user's artifact library.",
      inputSchema: z.object({
        pageId: z.string().min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ pageId }) => toolResult(await operations.deletePage(pageId)),
  );
}

export function createShareHtmlServer(operations: PageOperations) {
  const server = new McpServer(
    {
      name: "share-html",
      version: MCP_SERVER_VERSION,
    },
    {
      instructions:
        "Use publish_html to turn complete static HTML documents into shareable URLs. JavaScript, forms, embeds, and network calls are removed for safety.",
    },
  );

  registerShareHtmlTools(server, operations);

  return server;
}
