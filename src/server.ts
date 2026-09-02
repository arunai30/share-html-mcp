import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { MCP_SERVER_VERSION } from "./version.js";

export interface PageOperations {
  listPages(input?: PageListInput): Promise<Record<string, unknown>>;
  getPage(pageId: string): Promise<Record<string, unknown>>;
  publishPage(input: {
    title?: string;
    html: string;
    sharing?: InitialSharingPolicyInput;
  }): Promise<Record<string, unknown>>;
  publishPresentation(
    input: PresentationPublishInput,
  ): Promise<Record<string, unknown>>;
  updatePage(
    pageId: string,
    input: { title?: string; html: string },
  ): Promise<Record<string, unknown>>;
  publishExistingPage(pageId: string): Promise<Record<string, unknown>>;
  unpublishPage(pageId: string): Promise<Record<string, unknown>>;
  deletePage(pageId: string): Promise<Record<string, unknown>>;
}

export type PresentationPublishInput = {
  title?: string;
  html: string;
  presentation: {
    schemaVersion: 1;
    aspectRatio: "16:9" | "4:3";
  };
  sharing?: InitialSharingPolicyInput;
};

export type RecipeLookupInput = {
  recipeId?: string;
  version?: number;
};

export type PageListInput = {
  query?: string;
  status?: "published" | "unpublished";
  limit?: number;
  cursor?: string;
};

export interface RecipeOperations {
  getRecipe(input: RecipeLookupInput): Promise<Record<string, unknown>>;
}

export interface ShareHtmlOperations
  extends PageOperations,
    RecipeOperations {}

export type SharingPolicyInput =
  | { mode: "private"; expiresAt?: string | null }
  | { mode: "public"; expiresAt?: string | null }
  | {
      mode: "restricted";
      methods: {
        emailDomain?: string | null;
        recipients?: string[];
        password?: { action: "set"; value: string } | { action: "keep" };
      };
      expiresAt?: string | null;
    };

export type InitialSharingPolicyInput =
  | { mode: "private"; expiresAt?: string | null }
  | { mode: "public"; expiresAt?: string | null }
  | {
      mode: "restricted";
      methods: {
        emailDomain?: string | null;
        recipients?: string[];
        password?: { action: "set"; value: string };
      };
      expiresAt?: string | null;
    };

export interface SharingOperations {
  getSharing(pageId: string): Promise<Record<string, unknown>>;
  setSharing(
    pageId: string,
    input: { expectedRevision: number; policy: SharingPolicyInput },
  ): Promise<Record<string, unknown>>;
  endCurrentViewingSessions(
    pageId: string,
    expectedRevision: number,
  ): Promise<Record<string, unknown>>;
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

function toolError(code: string, message: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code, message } }, null, 2),
      },
    ],
  };
}

async function listToolResult(action: () => Promise<Record<string, unknown>>) {
  try {
    return toolResult(await action());
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    const safeCodes = new Set([
      "invalid_page_list_request",
      "invalid_cursor",
      "insufficient_scope",
      "invalid_api_token",
      "request_timeout",
      "network_error",
    ]);
    const code =
      typeof candidate?.code === "string" && safeCodes.has(candidate.code)
        ? candidate.code
        : "internal_error";
    const message =
      code !== "internal_error" && typeof candidate?.message === "string"
        ? candidate.message
        : "The artifact library could not be loaded.";
    return toolError(code, message);
  }
}

const safeSharingErrorCodes = new Set([
  "invalid_sharing_policy",
  "page_not_found",
  "sharing_conflict",
  "insufficient_scope",
]);

async function sharingToolResult(action: () => Promise<Record<string, unknown>>) {
  try {
    return toolResult(await action());
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    const code =
      typeof candidate?.code === "string" && safeSharingErrorCodes.has(candidate.code)
        ? candidate.code
        : "internal_error";
    const message =
      code !== "internal_error" && typeof candidate?.message === "string"
        ? candidate.message
        : "The sharing operation could not be completed.";
    return {
      isError: true as const,
      ...toolResult({ error: { code, message } }),
    };
  }
}

async function publishToolResult(action: () => Promise<Record<string, unknown>>) {
  try {
    return toolResult(await action());
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    const sourceCode = typeof candidate?.code === "string" ? candidate.code : null;
    const safeCodes = new Set([
      "invalid_html",
      "invalid_presentation",
      "invalid_sharing_policy",
      "insufficient_scope",
      "invalid_api_token",
      "controlled_publish_failed",
      "unsupported_controlled_publishing",
      "unsupported_presentation_publishing",
      "PLAN_QUOTA_EXCEEDED",
      "RATE_LIMITED",
      "page_not_found",
      "page_taken_down",
    ]);
    const definitelyNotPublished = Boolean(sourceCode && safeCodes.has(sourceCode));
    const code = definitelyNotPublished
      ? sourceCode!
      : "publication_state_unknown";
    const safeMessage =
      (sourceCode === "request_timeout" || definitelyNotPublished) &&
      typeof candidate?.message === "string"
        ? candidate.message
        : "The publish result is uncertain. Inspect recent pages before retrying to avoid a duplicate.";

    return {
      isError: true as const,
      ...toolResult({
        error: {
          code,
          message: safeMessage,
          publicationState: definitelyNotPublished ? "not_published" : "unknown",
        },
      }),
    };
  }
}

async function updateToolResult(action: () => Promise<Record<string, unknown>>) {
  try {
    return toolResult(await action());
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    const sourceCode = typeof candidate?.code === "string" ? candidate.code : null;
    const safeCodes = new Set([
      "invalid_html",
      "invalid_presentation",
      "page_not_found",
      "insufficient_scope",
      "invalid_api_token",
      "PLAN_QUOTA_EXCEEDED",
      "RATE_LIMITED",
    ]);
    const definitelyNotUpdated = Boolean(sourceCode && safeCodes.has(sourceCode));
    const code = definitelyNotUpdated ? sourceCode! : "update_state_unknown";
    const message =
      (sourceCode === "request_timeout" || definitelyNotUpdated) &&
      typeof candidate?.message === "string"
        ? candidate.message
        : "The update result is uncertain. Get the artifact and compare its contentSha256 before retrying.";

    return {
      isError: true as const,
      ...toolResult({
        error: {
          code,
          message,
          updateState: definitelyNotUpdated ? "not_updated" : "unknown",
        },
      }),
    };
  }
}

export function registerShareHtmlTools(
  server: McpServer,
  operations: ShareHtmlOperations,
) {
  const expiry = z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .describe("Optional future ISO 8601 time when access ends; null removes expiry.");
  const initialSharingPolicy = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("private"), expiresAt: expiry }).strict(),
    z.object({ mode: z.literal("public"), expiresAt: expiry }).strict(),
    z.object({
      mode: z.literal("restricted"),
      methods: z.object({
        emailDomain: z.string().max(1_000).nullable().optional(),
        recipients: z.array(z.string().email()).max(100).optional(),
        password: z.object({
          action: z.literal("set"),
          value: z.string().min(10).max(128),
        }).strict().optional(),
      }).strict().refine(
        (methods) => Boolean(methods.emailDomain) || Boolean(methods.recipients?.length) || Boolean(methods.password),
        "Choose at least one restricted access method.",
      ),
      expiresAt: expiry,
    }).strict(),
  ]);

  server.registerTool(
    "get_recipe",
    {
      title: "Get a first-party artifact recipe",
      description:
        "List first-party share/artifacts recipes, or get one reviewed prompt and static HTML starter by recipeId. Omit recipeId to discover the catalog.",
      inputSchema: z
        .object({
          recipeId: z
            .string()
            .min(1)
            .max(80)
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .optional(),
          version: z.number().int().positive().safe().optional(),
        })
        .refine((input) => input.recipeId || input.version === undefined, {
          message: "version requires a recipeId.",
          path: ["version"],
        }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => toolResult(await operations.getRecipe(input)),
  );

  server.registerTool(
    "publish_html",
    {
      title: "Publish static HTML",
      description:
        "Publish a complete static HTML document and return its stable URL. Omitted sharing is private to the owner. Explicitly choose public or combine domain, specific-email, and password access with an optional expiration.",
      inputSchema: z.object({
        title: z
          .string()
          .max(120)
          .optional()
          .describe(
            "A distinctive title that will make this artifact easy to find later.",
          ),
        html: z.string().min(1),
        sharing: initialSharingPolicy
          .optional()
          .describe("Optional access policy. Omit it to publish privately."),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => publishToolResult(() => operations.publishPage(input)),
  );

  server.registerTool(
    "publish_presentation",
    {
      title: "Publish an HTML-native presentation",
      description:
        "Create slides, a slide deck, pitch deck, talk, lesson, or keynote as a first-class HTML presentation. First call get_recipe with recipeId \"presentation-deck\". Structural validation and DOM checks alone are not visual QA. When browser or rendering tools are available, render and inspect the actual rendered pixels of every slide at the declared desktop canvas, a narrow viewport, and print size; fix the source HTML/CSS and re-render affected slides until the full deck passes before publishing, re-rendering every slide after shared CSS changes. If rendering is unavailable, tell the user that visual QA was not completed; publishing may proceed with that disclosure. ShareHTML sanitizes and validates the deck, persists it, applies access controls and CSP, and returns its presentation viewer URL.",
      inputSchema: z.object({
        title: z
          .string()
          .max(120)
          .optional()
          .describe("A distinctive deck title that will be easy to find later."),
        html: z
          .string()
          .min(1)
          .describe(
            "One complete static HTML document following the presentation-deck recipe.",
          ),
        presentation: z
          .object({
            schemaVersion: z.literal(1).default(1),
            aspectRatio: z.enum(["16:9", "4:3"]).default("16:9"),
          })
          .strict()
          .default({ schemaVersion: 1, aspectRatio: "16:9" }),
        sharing: initialSharingPolicy
          .optional()
          .describe("Optional access policy. Omit it to publish privately."),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) =>
      publishToolResult(() => operations.publishPresentation(input)),
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
      updateToolResult(() => operations.updatePage(pageId, { title, html })),
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
      title: "Find artifacts",
      description:
        "Search and page through the current user's published, offline, and platform-taken-down artifacts by title or page ID. Follow nextCursor to continue through large libraries.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .max(120)
          .optional()
          .describe("Optional case-insensitive title or page ID search."),
        status: z
          .enum(["published", "unpublished"])
          .optional()
          .describe(
            "Optional lifecycle filter. unpublished artifacts are shown as Offline in the dashboard.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Number of artifacts to return, from 1 to 100; defaults to 25."),
        cursor: z
          .string()
          .min(1)
          .max(1024)
          .optional()
          .describe(
            "Opaque nextCursor or previousCursor from an earlier list_pages result.",
          ),
      }).strict(),
      outputSchema: z.object({
        pages: z.array(
          z.object({
            artifactType: z.enum(["document", "presentation"]),
            artifactSchemaVersion: z.literal(1),
            artifactMetadata: z.union([
              z.object({}).strict(),
              z.object({
                aspectRatio: z.enum(["16:9", "4:3"]),
                slideCount: z.number().int().min(1).max(100),
              }).strict(),
            ]),
            pageId: z.string(),
            title: z.string(),
            status: z.enum(["published", "unpublished", "taken_down"]),
            publicUrl: z.string().url(),
            createdAt: z.string().datetime({ offset: true }),
            updatedAt: z.string().datetime({ offset: true }),
          }).strict(),
        ),
        pageInfo: z.object({
          limit: z.number().int().min(1).max(100),
          resultCount: z.number().int().nonnegative(),
          matchingCount: z.number().int().nonnegative(),
          totalLibraryCount: z.number().int().nonnegative(),
          nextCursor: z.string().nullable(),
          previousCursor: z.string().nullable(),
        }).strict(),
      }).strict(),
      annotations: {
        readOnlyHint: true,
      },
    },
    async (input) => listToolResult(() => operations.listPages(input)),
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
      publishToolResult(() => operations.publishExistingPage(pageId)),
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

export function registerSharingTools(
  server: McpServer,
  operations: SharingOperations,
) {
  const expiry = z.string().datetime({ offset: true }).nullable().optional();
  const policy = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("private"), expiresAt: expiry }).strict(),
    z.object({ mode: z.literal("public"), expiresAt: expiry }).strict(),
    z.object({
      mode: z.literal("restricted"),
      methods: z.object({
        emailDomain: z.string().max(1_000).nullable().optional(),
        recipients: z.array(z.string().email()).max(100).optional(),
        password: z.discriminatedUnion("action", [
          z.object({ action: z.literal("set"), value: z.string().min(10).max(128) }).strict(),
          z.object({ action: z.literal("keep") }).strict(),
        ]).optional(),
      }).strict().refine(
        (methods) => Boolean(methods.emailDomain) || Boolean(methods.recipients?.length) || Boolean(methods.password),
        "Choose at least one restricted access method.",
      ),
      expiresAt: expiry,
    }).strict(),
  ]);

  server.registerTool(
    "get_page_sharing",
    {
      title: "Get page sharing",
      description: "Get who can open a page and when access expires.",
      inputSchema: z.object({ pageId: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    ({ pageId }) => sharingToolResult(() => operations.getSharing(pageId)),
  );

  server.registerTool(
    "set_page_sharing",
    {
      title: "Set page sharing",
      description:
        "Choose owner-only, public, or restricted access. Restricted methods are OR alternatives. Use the revision returned by get_page_sharing.",
      inputSchema: z.object({
        pageId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
        policy,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    ({ pageId, expectedRevision, policy }) =>
      sharingToolResult(() =>
        operations.setSharing(pageId, { expectedRevision, policy }),
      ),
  );

  server.registerTool(
    "end_current_viewing_sessions",
    {
      title: "End current viewing sessions",
      description:
        "Invalidate current private viewing sessions. People who are still authorized can open the page again.",
      inputSchema: z.object({
        pageId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    ({ pageId, expectedRevision }) =>
      sharingToolResult(() =>
        operations.endCurrentViewingSessions(pageId, expectedRevision),
      ),
  );

}

export function createShareHtmlServer(
  operations: ShareHtmlOperations,
  sharingOperations?: SharingOperations,
) {
  const server = new McpServer(
    {
      name: "share-html",
      version: MCP_SERVER_VERSION,
    },
    {
      instructions:
        "Use get_recipe to discover ShareHTML-authored creation guidance. For slides, decks, pitch decks, talks, lessons, and keynotes, call get_recipe with recipeId \"presentation-deck\", then use publish_presentation. The agent owns the narrative, concise copy, accessible HTML/CSS, responsive and print behavior, and iterative visual QA of every slide. Structural validation and DOM checks alone do not establish visual correctness: when rendering tools are available, inspect the actual rendered pixels of every slide, fix defects, and re-render affected slides until the full deck passes at desktop, narrow, and print sizes; re-render every slide after shared CSS changes. If rendering tools are unavailable, explicitly state that visual QA was not completed; publishing may proceed with that disclosure. ShareHTML owns sanitization, structural validation, persistence, access control, CSP, and the viewer. For other artifacts, use publish_html. JavaScript, forms, embeds, and network calls are removed for safety.",
    },
  );

  registerShareHtmlTools(server, operations);
  if (sharingOperations) registerSharingTools(server, sharingOperations);

  return server;
}
