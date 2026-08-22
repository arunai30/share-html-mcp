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

const DEFAULT_TIMEOUT_MS = 30_000;

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function requestTimeoutError() {
  return new ShareHtmlApiError(
    "request_timeout",
    "The share/html request timed out. The operation may have completed; use list_pages or get_page before retrying.",
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
    /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : "http_error";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : null;
  return { code, message };
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

  private async request(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          ...init?.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (isTimeoutError(error)) throw requestTimeoutError();

      throw new ShareHtmlApiError(
        "network_error",
        "Could not reach the share/html API. Check the connection and try again.",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (isTimeoutError(error)) throw requestTimeoutError();
      body = null;
    }

    if (!response.ok) {
      const apiError = readApiError(body);
      const isSafeClientError = response.status >= 400 && response.status < 500;
      const safeMessage =
        isSafeClientError && apiError?.message
          ? safeClientMessage(apiError.message, this.token)
          : `The share/html API is unavailable (HTTP ${response.status}).`;

      throw new ShareHtmlApiError(
        isSafeClientError ? (apiError?.code ?? "http_error") : "http_error",
        safeMessage,
        response.status,
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ShareHtmlApiError(
        "invalid_response",
        "The share/html API returned an invalid response.",
        response.status,
      );
    }

    return body as Record<string, unknown>;
  }

  listPages() {
    return this.request("/pages");
  }

  getPage(pageId: string) {
    return this.request(`/pages/${encodeURIComponent(pageId)}`);
  }

  publishPage(input: { title?: string; html: string }) {
    return this.request("/pages", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updatePage(pageId: string, input: { title?: string; html: string }) {
    return this.request(`/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
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
}
