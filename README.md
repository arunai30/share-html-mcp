# @share-html/mcp-server

Publish safe static HTML pages from an MCP agent and receive a shareable URL.

## Preferred: hosted OAuth

Codex users can connect without installing this package or creating a permanent
token:

```bash
npx -y @openai/codex@0.149.0 mcp add share-html --url https://share-html-app-alpha.vercel.app/api/mcp --oauth-client-registration cimd
```

The browser authorization flow grants access to your share/html account. Open
the [connection page](https://share-html-app-alpha.vercel.app/connect) for the
latest verified setup.

## Personal-token fallback

Use this package when your MCP client does not support the hosted OAuth flow.
It requires Node.js 20.19 or newer and `npx`:

```bash
node --version
npx --version
```

Create a personal-token connection on the
[connection page](https://share-html-app-alpha.vercel.app/connect). Copy the
configuration when it appears; share/html cannot display the token again. The
token remains active until you revoke that connection.

### Codex

Add the server to `~/.codex/config.toml`, then restart only the share-html MCP
server from Codex settings. The first start downloads the pinned package through
`npx`.

```toml
[mcp_servers."share-html"]
command = "npx"
args = ["-y", "@share-html/mcp-server@0.1.0"]

[mcp_servers."share-html".env]
SHARE_HTML_API_BASE_URL = "https://share-html-app-alpha.vercel.app/api/v1"
SHARE_HTML_API_TOKEN = "shp_..."
```

### Standard MCP JSON

```json
{
  "mcpServers": {
    "share-html": {
      "command": "npx",
      "args": ["-y", "@share-html/mcp-server@0.1.0"],
      "env": {
        "SHARE_HTML_API_BASE_URL": "https://share-html-app-alpha.vercel.app/api/v1",
        "SHARE_HTML_API_TOKEN": "shp_..."
      }
    }
  }
}
```

Treat `SHARE_HTML_API_TOKEN` like a password. Do not commit it, paste it into
HTML, or send it to anyone. If it is lost or exposed, revoke the connection at
the connection page and create another.

## Tools

The server exposes `publish_html`, `update_page`, `get_page`, `list_pages`,
`publish_page`, `unpublish_page`, and `delete_page`.

The share/html API sanitizes every document. JavaScript, forms, embeds, and
external network calls are removed or blocked before a page is published.

## Troubleshooting

- `npx: command not found`: install Node.js 20.19 or newer, then reopen your
  terminal or MCP client.
- `invalid_api_token`: replace a revoked or incorrect token with a newly created
  personal-token connection.
- Request timeout: a mutation may have completed. Use `list_pages` or `get_page`
  before asking the agent to retry it.
- Connection failure: confirm the API URL uses HTTPS and that your network can
  reach `share-html-app-alpha.vercel.app`.

Source and issues: [arunai30/share-html-mcp](https://github.com/arunai30/share-html-mcp)
