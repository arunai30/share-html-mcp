import type { GenerateDiagramInput } from "./server.js";
import type { PublicFontsInput } from "./fonts.js";
import type {
  GetTemplateInput,
  ListTemplatesInput,
  PreviewTemplateInput,
  SaveTemplateInput,
} from "./artifact-template.js";
import { PageSourceError, assertSourceResponseFits } from "./source-handoff.js";
import type {
  ArtifactStyleRef,
  GetArtifactStyleInput,
  PreviewArtifactStyleInput,
  SetArtifactStyleInput,
} from "./artifact-style.js";

export type ShareHtmlApiErrorDetails = {
  requiredScopes?: string[];
  reauthorizeUrl?: string;
  currentRevision?: number;
  currentVersion?: number;
  retryAfterSeconds?: number;
  limit?: number;
  retryGuidance?: string;
  retryWithIdenticalArguments?: boolean;
};

export class ShareHtmlApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: ShareHtmlApiErrorDetails,
  ) {
    super(message);
    this.name = "ShareHtmlApiError";
  }
}

export type ShareHtmlApiClientOptions = {
  timeoutMs?: number;
};

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

export type PageListInput = {
  query?: string;
  status?: "published" | "unpublished";
  limit?: number;
  cursor?: string;
};

export type PresentationPublishInput = {
  title?: string;
  fonts?: PublicFontsInput;
  html: string;
  presentation: {
    schemaVersion: 1;
    aspectRatio: "16:9" | "4:3";
  };
  sharing?: InitialSharingPolicyInput;
  styleRef?: ArtifactStyleRef;
};

type RequestOptions = {
  authenticated?: boolean;
  readOnlyRetryHint?: string;
  retryDetails?: ShareHtmlApiErrorDetails;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_API_RESPONSE_BYTES = 2_500_000;
const recipeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function withArtifactDefaults(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.artifactType !== undefined) return record;
  return {
    artifactType: "document",
    artifactSchemaVersion: 1,
    artifactMetadata: {},
    ...record,
  };
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function requestTimeoutError(
  readOnlyRetryHint?: string,
  details?: ShareHtmlApiErrorDetails,
) {
  if (readOnlyRetryHint) {
    return new ShareHtmlApiError(
      "request_timeout",
      `The share/artifacts request timed out. ${readOnlyRetryHint}`,
      undefined,
      details,
    );
  }

  return new ShareHtmlApiError(
    "request_timeout",
    "The share/artifacts request timed out. The operation may have completed; inspect recent pages by title and creation time before retrying to avoid a duplicate.",
  );
}

function safeClientMessage(message: string, token: string) {
  return message
    .replaceAll(token, "[redacted]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, 500);
}

function readSafeApiErrorDetails(
  value: unknown,
  token: string,
): ShareHtmlApiErrorDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const details: ShareHtmlApiErrorDetails = {};

  if (typeof source.currentVersion === "number"
    && Number.isSafeInteger(source.currentVersion) && source.currentVersion > 0) {
    details.currentVersion = source.currentVersion;
  }

  if (
    Array.isArray(source.requiredScopes) &&
    source.requiredScopes.length <= 10 &&
    source.requiredScopes.every(
      (scope) =>
        scope === "styles:read" || scope === "styles:write",
    )
  ) {
    details.requiredScopes = [...source.requiredScopes] as string[];
  }

  if (
    typeof source.reauthorizeUrl === "string" &&
    !source.reauthorizeUrl.includes(token)
  ) {
    const candidate = source.reauthorizeUrl;
    let isSafeUrl = candidate.startsWith("/") && !candidate.startsWith("//");
    try {
      const parsed = new URL(candidate);
      const isLoopback =
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "[::1]";
      isSafeUrl =
        !parsed.username &&
        !parsed.password &&
        (parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && isLoopback));
    } catch {
      // A same-origin path is already handled above.
    }
    if (
      isSafeUrl &&
      candidate.length <= 2_048 &&
      !/[\u0000-\u001f\u007f-\u009f]/.test(candidate)
    ) {
      details.reauthorizeUrl = candidate;
    }
  }

  if (
    typeof source.currentRevision === "number" &&
    Number.isSafeInteger(source.currentRevision) &&
    source.currentRevision >= 0
  ) {
    details.currentRevision = source.currentRevision;
  }

  if (
    typeof source.retryAfterSeconds === "number" &&
    Number.isSafeInteger(source.retryAfterSeconds) &&
    source.retryAfterSeconds > 0 &&
    source.retryAfterSeconds <= 86_400
  ) {
    details.retryAfterSeconds = source.retryAfterSeconds;
  }

  if (
    typeof source.limit === "number" &&
    Number.isSafeInteger(source.limit) &&
    source.limit > 0 &&
    source.limit <= 10_000
  ) {
    details.limit = source.limit;
  }

  const retryGuidance =
    typeof source.retryGuidance === "string"
      ? source.retryGuidance
      : typeof source.recovery === "string"
        ? source.recovery
        : null;
  if (retryGuidance) {
    details.retryGuidance = safeClientMessage(retryGuidance, token);
  }
  if (typeof source.retryWithIdenticalArguments === "boolean") {
    details.retryWithIdenticalArguments = source.retryWithIdenticalArguments;
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

function readApiError(body: unknown, token: string) {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = body.error;
  if (!error || typeof error !== "object") return null;

  const code =
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "http_error";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : null;
  const detailsSource =
    "details" in error && error.details && typeof error.details === "object"
      ? error.details
      : error;
  return {
    code,
    message,
    details: readSafeApiErrorDetails(detailsSource, token),
  };
}

async function readBoundedResponseText(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > MAX_API_RESPONSE_BYTES
  ) {
    throw new ShareHtmlApiError(
      "invalid_response",
      "The share/artifacts API response was too large.",
      response.status,
    );
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > MAX_API_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ShareHtmlApiError(
          "invalid_response",
          "The share/artifacts API response was too large.",
          response.status,
        );
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export function normalizeApiBaseUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("SHARE_HTML_API_BASE_URL must be a valid URL.");
  }

  const isLoopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error(
      "SHARE_HTML_API_BASE_URL must use HTTPS, except for loopback development.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "SHARE_HTML_API_BASE_URL cannot include credentials, query parameters, or a fragment.",
    );
  }

  return url.toString().replace(/\/+$/, "");
}

export class ShareHtmlApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string,
    private readonly token: string,
    options: ShareHtmlApiClientOptions = {},
  ) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    if (!token.trim()) throw new Error("SHARE_HTML_API_TOKEN is required.");

    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive number.");
    }
  }

  private async request(
    path: string,
    init?: RequestInit,
    options: RequestOptions = {},
  ) {
    const authenticated = options.authenticated ?? true;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(authenticated
            ? { authorization: `Bearer ${this.token}` }
            : {}),
          "content-type": "application/json",
          ...init?.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw requestTimeoutError(
          options.readOnlyRetryHint,
          options.retryDetails,
        );
      }

      throw new ShareHtmlApiError(
        "network_error",
        options.readOnlyRetryHint
          ? `Could not reach the share/artifacts API. ${options.readOnlyRetryHint}`
          : "Could not reach the share/artifacts API. Check the connection and try again.",
        undefined,
        options.retryDetails,
      );
    }

    let body: unknown = null;
    try {
      body = JSON.parse(await readBoundedResponseText(response));
    } catch (error) {
      if (error instanceof ShareHtmlApiError) throw error;
      if (isTimeoutError(error)) {
        throw requestTimeoutError(
          options.readOnlyRetryHint,
          options.retryDetails,
        );
      }
      body = null;
    }

    if (!response.ok) {
      const apiError = readApiError(body, this.token);
      const isSafeClientError = response.status >= 400 && response.status < 500;
      const isSafeControlledPublishFailure =
        response.status === 500 && apiError?.code === "controlled_publish_failed";
      const isSafeArtifactStyleIntegrityFailure =
        response.status === 500 &&
        apiError?.code === "artifact_style_persistence_integrity";
      const isSafeFontProviderFailure =
        (response.status === 502 || response.status === 503) && apiError?.code === "font_unavailable";
      const isSafeApiError =
        isSafeClientError ||
        isSafeControlledPublishFailure ||
        isSafeArtifactStyleIntegrityFailure ||
        isSafeFontProviderFailure;
      const safeMessage =
        isSafeApiError && apiError?.message
          ? safeClientMessage(apiError.message, this.token)
          : `The share/artifacts API is unavailable (HTTP ${response.status}).`;

      throw new ShareHtmlApiError(
        isSafeApiError
          ? (apiError?.code ?? "http_error")
          : "http_error",
        safeMessage,
        response.status,
        apiError?.details,
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ShareHtmlApiError(
        "invalid_response",
        "The share/artifacts API returned an invalid response.",
        response.status,
      );
    }

    return body as Record<string, unknown>;
  }

  async listPages(input: PageListInput = {}) {
    const query = new URLSearchParams();
    if (input.query !== undefined) query.set("query", input.query);
    if (input.status !== undefined) query.set("status", input.status);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    const suffix = query.size ? `?${query}` : "";
    const result = await this.request(`/pages${suffix}`, undefined, {
      readOnlyRetryHint: "It is safe to retry list_pages.",
    });
    return {
      ...result,
      pages: Array.isArray(result.pages)
        ? result.pages.map(withArtifactDefaults)
        : result.pages,
    };
  }

  getRecipe(input: { recipeId?: string; version?: number } = {}) {
    if (input.recipeId === undefined) {
      const query =
        input.version === undefined ? "" : `?version=${input.version}`;
      return this.request(`/recipes${query}`, undefined, {
        authenticated: false,
        readOnlyRetryHint: "It is safe to retry get_recipe.",
      });
    }

    if (
      input.recipeId.length === 0 ||
      input.recipeId.length > 80 ||
      !recipeIdPattern.test(input.recipeId)
    ) {
      return Promise.reject(
        new ShareHtmlApiError(
          "invalid_recipe_request",
          "recipeId must be a kebab-case identifier of at most 80 characters.",
          400,
        ),
      );
    }

    const query =
      input.version === undefined ? "" : `?version=${input.version}`;
    return this.request(
      `/recipes/${encodeURIComponent(input.recipeId)}${query}`,
      undefined,
      {
        authenticated: false,
        readOnlyRetryHint: "It is safe to retry get_recipe.",
      },
    );
  }

  async getPage(pageId: string, options?: { includeDiagramSource?: boolean; includeHtmlSource?: boolean }) {
    const query = new URLSearchParams();
    if (options?.includeDiagramSource) query.set("includeDiagramSource", "true");
    if (options?.includeHtmlSource) query.set("includeHtmlSource", "true");
    let response: Record<string, unknown>;
    try {
      response = await this.request(`/pages/${encodeURIComponent(pageId)}${query.size ? `?${query}` : ""}`);
    } catch (error) {
      if (options?.includeHtmlSource && error instanceof ShareHtmlApiError
        && error.code === "invalid_response" && error.message === "The share/artifacts API response was too large.") {
        throw new PageSourceError("source_too_large", "The complete source is too large for a safe handoff. Use your original local file or the manual editor; no source was truncated.");
      }
      throw error;
    }
    const value = withArtifactDefaults(response) as Record<string, unknown>;
    if (options?.includeHtmlSource) assertSourceResponseFits(value);
    return value;
  }

  generateDiagram(input: GenerateDiagramInput) {
    return this.request("/diagrams", {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      readOnlyRetryHint: "Retry generate_diagram only with the identical clientRequestId and arguments.",
      retryDetails: { retryWithIdenticalArguments: true },
    });
  }

  private async requireFontCapability() {
    let capability: Record<string, unknown>;
    try {
      capability = await this.request("/fonts", { method: "GET" }, {
        readOnlyRetryHint: "No publish or update was sent; it is safe to retry the font capability check.",
      });
    } catch (error) {
      if (error instanceof ShareHtmlApiError) {
        if (error.status === 404 || error.status === 405 || error.code === "invalid_response") {
          throw new ShareHtmlApiError(
            "unsupported_fonts",
            "This server does not confirm support for fonts. No publish or update was sent. Update the server before retrying; do not remove fonts automatically.",
            error.status,
          );
        }
        if (error.code === "invalid_api_token" || error.code === "insufficient_scope") throw error;
      }
      throw new ShareHtmlApiError(
        "font_capability_unavailable",
        "Font support could not be checked. No publish or update was sent. Check the connection and retry; do not remove fonts automatically.",
        error instanceof ShareHtmlApiError ? error.status : undefined,
      );
    }
    if (capability.schemaVersion !== 1 || capability.provider !== "google-fonts") {
      throw new ShareHtmlApiError(
        "unsupported_fonts",
        "This server does not confirm the supported font contract. No publish or update was sent. Update the server before retrying; do not remove fonts automatically.",
      );
    }
  }

  async publishPage(input: {
    title?: string;
    html?: string;
    generationId?: string;
    fonts?: PublicFontsInput;
    sharing?: InitialSharingPolicyInput;
    styleRef?: ArtifactStyleRef;
  }) {
    if (input.fonts !== undefined) await this.requireFontCapability();
    const controlled = input.sharing !== undefined;
    try {
      return await this.request(controlled ? "/pages/controlled" : "/pages", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (error) {
      if (
        controlled &&
        error instanceof ShareHtmlApiError &&
        (error.status === 404 || error.status === 405)
      ) {
        throw new ShareHtmlApiError(
          "unsupported_controlled_publishing",
          "This share/artifacts server does not support controlled publishing. Nothing was published; update the server before retrying.",
          404,
        );
      }
      throw error;
    }
  }

  async publishPresentation(input: PresentationPublishInput) {
    if (input.fonts !== undefined) await this.requireFontCapability();
    try {
      return await this.request("/presentations", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (error) {
      if (
        input.styleRef !== undefined &&
        error instanceof ShareHtmlApiError &&
        error.status === 400 && error.code === "invalid_request"
      ) {
        throw new ShareHtmlApiError(
          "unsupported_presentation_style_request",
          "The server rejected this presentation style request. Nothing was published. Check the request; this capability may need a server update. Do not remove styleRef or fall back to generic HTML publishing automatically.",
          error.status,
        );
      }
      if (
        error instanceof ShareHtmlApiError &&
        (error.status === 404 || error.status === 405)
      ) {
        throw new ShareHtmlApiError(
          "unsupported_presentation_publishing",
          "This ShareHTML server does not support presentation publishing. Nothing was published; update the server before retrying.",
          error.status,
        );
      }
      throw error;
    }
  }

  async updatePage(
    pageId: string,
    input: { title?: string; html?: string; generationId?: string; expectedVersion?: number; styleRef?: ArtifactStyleRef; fonts?: PublicFontsInput },
  ) {
    if (input.fonts !== undefined) await this.requireFontCapability();
    return this.request(
      `/pages/${encodeURIComponent(pageId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
      {
        readOnlyRetryHint:
          "Use get_page and compare contentSha256 before retrying the update.",
      },
    );
  }

  unpublishPage(pageId: string) {
    return this.request(`/pages/${encodeURIComponent(pageId)}/unpublish`, {
      method: "POST",
    });
  }

  publishExistingPage(pageId: string) {
    return this.request(`/pages/${encodeURIComponent(pageId)}/publish`, {
      method: "POST",
    });
  }

  deletePage(pageId: string) {
    return this.request(`/pages/${encodeURIComponent(pageId)}`, {
      method: "DELETE",
    });
  }

  getSharing(pageId: string) {
    return this.request(`/pages/${encodeURIComponent(pageId)}/sharing`);
  }

  setSharing(
    pageId: string,
    input: { expectedRevision: number; policy: SharingPolicyInput },
  ) {
    return this.request(`/pages/${encodeURIComponent(pageId)}/sharing`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  endCurrentViewingSessions(pageId: string, expectedRevision: number) {
    return this.request(`/pages/${encodeURIComponent(pageId)}/sharing/sessions`, {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision }),
    });
  }

  async previewArtifactStyle(input: PreviewArtifactStyleInput) {
    try {
      return await this.request(
        "/artifact-style/preview",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
        {
          readOnlyRetryHint:
            "Nothing was activated. You may request another preview; any earlier private draft will expire automatically.",
        },
      );
    } catch (error) {
      if (
        error instanceof ShareHtmlApiError &&
        (error.status === 404 || error.status === 405)
      ) {
        throw new ShareHtmlApiError(
          "unsupported_artifact_styles",
          "This share/artifacts server does not support artifact style previews. Nothing was activated; upgrade the server and reconnect before trying again.",
          error.status,
        );
      }
      throw error;
    }
  }

  async setArtifactStyle(input: SetArtifactStyleInput) {
    const retryGuidance =
      "Retry set_artifact_style only with the identical draftId, expectedRevision, and clientRequestId.";
    try {
      return await this.request(
        "/artifact-style/activate",
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
        {
          readOnlyRetryHint: retryGuidance,
          retryDetails: {
            retryGuidance,
            retryWithIdenticalArguments: true,
          },
        },
      );
    } catch (error) {
      if (
        error instanceof ShareHtmlApiError &&
        (error.status === 405 ||
          (error.status === 404 &&
            error.code !== "artifact_style_draft_not_found"))
      ) {
        throw new ShareHtmlApiError(
          "unsupported_artifact_styles",
          "This share/artifacts server does not support artifact style activation. Nothing was activated; upgrade the server and reconnect before trying again.",
          error.status,
        );
      }
      throw error;
    }
  }

  listTemplates(input: ListTemplatesInput = {}) {
    const query = new URLSearchParams();
    if (input.query !== undefined) query.set("query", input.query);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.cursor !== undefined) query.set("cursor", input.cursor);
    return this.request(`/templates${query.size ? `?${query}` : ""}`, undefined, {
      readOnlyRetryHint: "It is safe to retry list_templates.",
    });
  }

  getTemplate(input: GetTemplateInput) {
    const query = input.includeHtml === true ? "?includeHtml=true" : "";
    return this.request(`/templates/${encodeURIComponent(input.templateId)}${query}`, undefined, {
      readOnlyRetryHint: "It is safe to retry get_template.",
    });
  }

  previewTemplate(input: PreviewTemplateInput) {
    return this.request("/templates/preview", {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      readOnlyRetryHint: "A preview draft may already exist. Retrying creates another private draft and does not save or publish it.",
    });
  }

  saveTemplate(input: SaveTemplateInput) {
    return this.request("/templates/save", {
      method: "POST",
      body: JSON.stringify(input),
    }, {
      readOnlyRetryHint: "It is safe to retry save_template with the identical draftId.",
      retryDetails: { retryWithIdenticalArguments: true },
    });
  }

  async getArtifactStyle(input: GetArtifactStyleInput) {
    try {
      return await this.request(
        `/artifact-style?format=${encodeURIComponent(input.format)}`,
        undefined,
        {
          readOnlyRetryHint: "It is safe to retry get_artifact_style.",
        },
      );
    } catch (error) {
      if (
        input.format === "presentation" &&
        error instanceof ShareHtmlApiError &&
        error.status === 400 && error.code === "invalid_artifact_style"
      ) {
        throw new ShareHtmlApiError(
          "unsupported_presentation_style_request",
          "The server rejected the presentation style request. Check the request; this capability may need a server update. The saved style is unchanged.",
          error.status,
        );
      }
      if (
        error instanceof ShareHtmlApiError &&
        (error.status === 404 || error.status === 405)
      ) {
        throw new ShareHtmlApiError(
          "unsupported_artifact_styles",
          "This share/artifacts server does not support artifact styles. Upgrade the server and reconnect your agent to grant style access.",
          error.status,
        );
      }
      throw error;
    }
  }

}
