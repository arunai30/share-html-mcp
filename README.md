# share/artifacts MCP server

Publish agent-created HTML artifacts and receive a shareable URL. The npm
package remains `@aiformasses/mcp-server` for compatibility.

## Preferred: connect your agent

Give your agent the public
[setup page](https://shareartifacts.dev/connect). Agents supporting
remote MCP, browser authorization, and CIMD or DCR can configure the hosted connection
at `https://shareartifacts.dev/api/mcp` without installing this package or
creating a permanent token.

## Personal-token fallback

Use this package when your MCP client does not support the hosted OAuth flow.
It requires Node.js 20.19 or newer and `npx`:

```bash
node --version
npx --version
```

Use **Connect a background agent** in
[token settings](https://shareartifacts.dev/settings/tokens). Create a
personal access token and insert it directly into the local configuration.
share/artifacts cannot display the token again.

### Codex

Add the server to `~/.codex/config.toml`, then restart only the `share-html` MCP
entry from Codex settings. The first start downloads the pinned package through
`npx`. The `share-html` entry name is a stable compatibility identifier; it does
not change the share/artifacts product name.

```toml
[mcp_servers."share-html"]
command = "npx"
args = ["-y", "@aiformasses/mcp-server@0.2.0"]

[mcp_servers."share-html".env]
SHARE_HTML_API_BASE_URL = "https://shareartifacts.dev/api/v1"
SHARE_HTML_API_TOKEN = "PASTE_TOKEN_HERE"
```

### Standard MCP JSON

```json
{
  "mcpServers": {
    "share-html": {
      "command": "npx",
      "args": ["-y", "@aiformasses/mcp-server@0.2.0"],
      "env": {
        "SHARE_HTML_API_BASE_URL": "https://shareartifacts.dev/api/v1",
        "SHARE_HTML_API_TOKEN": "PASTE_TOKEN_HERE"
      }
    }
  }
}
```

Replace `PASTE_TOKEN_HERE` locally. Treat `SHARE_HTML_API_TOKEN` like a
password. Do not commit it, paste it into agent chat, include it in a URL or
HTML, or send it to anyone. If it is lost or exposed, revoke the token and
create another.

## Tools

The repository version exposes `get_recipe`, `publish_html`,
`publish_presentation`, `update_page`, `get_page`, `list_pages`, `publish_page`,
`unpublish_page`, and `delete_page`.
Call `get_recipe` without arguments to discover the first-party catalog; pass a
`recipeId` and optional integer `version` for the complete reviewed recipe.

For slides, decks, pitch decks, talks, lessons, and keynote-style requests, call
`get_recipe` with `recipeId: "presentation-deck"` before authoring, then use
`publish_presentation`. The agent owns the cumulative narrative, concise copy,
accessible HTML/CSS, responsive and print behavior, and visual inspection of
every slide. share/artifacts owns sanitization, post-sanitization structural
validation, persistence, access control, CSP, and presentation controls. A
successful presentation publish returns the canonical
`/view/{publicId}` viewer URL plus a content hash for reconciliation.

Visual QA is an iterative rendering task, not a markup check. When browser or
rendering tools are available, inspect the actual rendered pixels of every
slide at the declared desktop canvas, a narrow viewport, and print size. Check
for clipped content, unintended overflow or overlap, crushed glyphs or words,
unsafe edge placement, footer/counter collisions, weak contrast, and incorrect
image cropping. Fix the source HTML/CSS, re-render every affected slide, and
repeat until the complete deck passes; re-render every slide after changing
shared CSS, layout rules, or design tokens. Intentional decorative bleed is
allowed when it does not obscure meaningful content. DOM measurements and a
single overview screenshot are not sufficient. If rendering is unavailable,
tell the user that visual QA was not completed rather than claiming
verification; publishing may proceed with that disclosure.

`publish_presentation` defaults to schema version 1 and a 16:9 stage; 4:3 is
also supported:

```json
{
  "title": "Q4 strategy",
  "html": "<!doctype html><html>...</html>",
  "presentation": { "schemaVersion": 1, "aspectRatio": "16:9" },
  "sharing": { "mode": "public" }
}
```

The deck HTML must contain exactly one `main.share-presentation` whose direct
children are sequential `section.share-slide` elements (`slide-1` through
`slide-N`). Each slide must use `aria-labelledby` to reference a unique heading
inside that slide. Invalid decks are not published, and invalid updates preserve
the previous version.

`list_pages` returns 25 artifact metadata records by default, never their HTML.
Use `query` for a case-insensitive title or page-ID search, `status` for
`published` or `unpublished`, and `limit` for up to 100 results. When
`pageInfo.nextCursor` is present, pass it back as `cursor` with the same
filters:

```json
{
  "query": "launch report",
  "status": "published",
  "limit": 25,
  "cursor": "CURSOR_FROM_THE_PREVIOUS_RESULT"
}
```

The response distinguishes `resultCount`, `matchingCount`, and
`totalLibraryCount`, so agents can search or traverse hundreds of artifacts
without loading the complete library.

`publish_html` accepts optional `sharing`, so the artifact is protected before
its URL becomes available. Omit `sharing` for owner-only private access. Public
access must be explicit. Examples:

```json
{
  "html": "<!doctype html><html>...</html>",
  "sharing": { "mode": "public" }
}
```

```json
{
  "html": "<!doctype html><html>...</html>",
  "sharing": {
    "mode": "restricted",
    "methods": {
      "emailDomain": "example.com",
      "recipients": ["reader@partner.example"],
      "password": {
        "action": "set",
        "value": "at-least-10-characters"
      }
    },
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }
}
```

Restricted methods are OR alternatives: a verified exact-domain identity, a
verified exact recipient, or the password can independently open the artifact.
Initial password publishing requires `action: "set"`; later updates may use
`action: "keep"`. A successful controlled publish returns its effective
sharing mode and revision with the page URL.

It also exposes controlled-sharing tools: `get_page_sharing`,
`set_page_sharing`, and `end_current_viewing_sessions`. Read the latest sharing
revision before changing access. Pages can be private to their owner, public to
anyone with the link, or restricted by any combination of one exact email
domain, exact verified email recipients, and a password.

The installation examples are pinned to the current `0.2.0` release.
Hosted and local workspace builds use the repository contract as soon as their
app build is deployed. The stdio fallback receives new tools only after a
separately authorized npm package release.

The share/artifacts API sanitizes every document. JavaScript, forms, embeds, and
external network calls are removed or blocked before a page is published.

`SHARE_HTML_*`, `share-html`, and the `ShareHtml*` TypeScript exports remain
stable compatibility identifiers so existing client configurations and code do
not break.

## Troubleshooting

- `npx: command not found`: install Node.js 20.19 or newer, then reopen your
  terminal or MCP client.
- `invalid_api_token`: replace a revoked or incorrect personal access token.
- Publish timeout: inspect recent pages by title and creation time before
  retrying. The operation may have completed, and retrying can create a private
  duplicate.
- Recipe request timeout: `get_recipe` is read-only and safe to retry.
- Connection failure: confirm the API URL uses HTTPS and that your network can
  reach `shareartifacts.dev`.

Source and issues: [arunai30/share-html-mcp](https://github.com/arunai30/share-html-mcp)
