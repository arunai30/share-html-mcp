export type PageSourceErrorCode =
  | "invalid_request"
  | "html_source_unsupported"
  | "source_too_large"
  | "source_handoff_unsupported"
  | "page_version_conflict";

export class PageSourceError extends Error {
  readonly status: number;

  constructor(
    public readonly code: PageSourceErrorCode,
    message: string,
    public readonly details?: { currentVersion: number },
  ) {
    super(message);
    this.name = "PageSourceError";
    this.status = code === "invalid_request" ? 400
      : code === "source_too_large" ? 413
      : code === "page_version_conflict" ? 409 : 422;
  }
}

/** Validate the complete handoff; never truncate source into an unsafe edit base. */
export function assertSourceResponseFits(
  value: Record<string, unknown>,
  maxHtmlBytes = 1_000_000,
): void {
  const source = value.htmlSource;
  if (!source || typeof source !== "object" || Array.isArray(source)
    || !("format" in source) || source.format !== "sanitized-html"
    || !("html" in source) || typeof source.html !== "string") {
    throw new PageSourceError(
      "source_handoff_unsupported",
      "This server did not return complete sanitized HTML source. Upgrade the server, or use your original local file or the manual editor.",
    );
  }

  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  // MCP repeats the data in structuredContent and escaped pretty-printed text.
  const mcpResult = {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
  if (bytes(source.html) > maxHtmlBytes
    || bytes(JSON.stringify(value)) > 2_000_000
    || bytes(JSON.stringify(mcpResult)) > 2_000_000) {
    throw new PageSourceError(
      "source_too_large",
      "The complete source is too large for a safe handoff. Use your original local file or the manual editor; no source was truncated.",
    );
  }
}
