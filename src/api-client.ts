export class ShareHtmlApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
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
  html: string;
  presentation: {
    schemaVersion: 1;
    aspectRatio: "16:9" | "4:3";
  };
  sharing?: InitialSharingPolicyInput;
};

type RequestOptions = {
  authenticated?: boolean;
  readOnlyRetryHint?: string;
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

function requestTimeoutError(readOnlyRetryHint?: string) {
  if (readOnlyRetryHint) {
    return new ShareHtmlApiError(
      "request_timeout",
      `The share/artifacts request timed out. ${readOnlyRetryHint}`,
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

function readApiError(body: unknown) {
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
  return { code, message };
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
        throw requestTimeoutError(options.readOnlyRetryHint);
      }

      throw new ShareHtmlApiError(
        "network_error",
        "Could not reach the share/artifacts API. Check the connection and try again.",
      );
    }

    let body: unknown = null;
    try {
      body = JSON.parse(await readBoundedResponseText(response));
    } catch (error) {
      if (error instanceof ShareHtmlApiError) throw error;
      if (isTimeoutError(error)) {
        throw requestTimeoutError(options.readOnlyRetryHint);
      }
      body = null;
    }

    if (!response.ok) {
      const apiError = readApiError(body);
      const isSafeClientError = response.status >= 400 && response.status < 500;
      const isSafeControlledPublishFailure =
        response.status === 500 && apiError?.code === "controlled_publish_failed";
      const safeMessage =
        (isSafeClientError || isSafeControlledPublishFailure) && apiError?.message
          ? safeClientMessage(apiError.message, this.token)
          : `The share/artifacts API is unavailable (HTTP ${response.status}).`;

      throw new ShareHtmlApiError(
        isSafeClientError || isSafeControlledPublishFailure
          ? (apiError?.code ?? "http_error")
          : "http_error",
        safeMessage,
        response.status,
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

  async getPage(pageId: string) {
    return withArtifactDefaults(
      await this.request(`/pages/${encodeURIComponent(pageId)}`),
    ) as Record<string, unknown>;
  }

  async publishPage(input: {
    title?: string;
    html: string;
    sharing?: InitialSharingPolicyInput;
  }) {
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
    try {
      return await this.request("/presentations", {
        method: "POST",
        body: JSON.stringify(input),
      });
    } catch (error) {
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

  updatePage(pageId: string, input: { title?: string; html: string }) {
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

}
