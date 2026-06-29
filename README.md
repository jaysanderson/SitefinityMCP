# Sitefinity MCP Server

A **zero-dependency** [Model Context Protocol](https://modelcontextprotocol.io)
server that lets AI clients **read and query content** from a [Progress
Sitefinity CMS](https://www.progress.com/sitefinity-cms) instance through its
REST (OData) Web Services API.

The tool surface is **generated from the live service**: at startup the server
fetches the OData `$metadata`, parses every entity set and its fields, and bakes
the discovered type names into the tools. Point it at any Sitefinity site and it
adapts to that site's content model.

- **No npm dependencies** — runs on plain Node.js (built-ins only). Nothing to install.
- **Two transports** — Streamable HTTP (for hosting) and stdio (for local clients).
- **Read-only** — every tool issues `GET` requests.
- **Live web explorer** — the same server hosts an interactive UI that exercises every tool.

Default target: `https://sta.eftm2.cloud.sitefinity.com/api/default/`
Live deployment:
- Web explorer: **https://sitefinity-mcp-eftm2.fly.dev/**
- MCP endpoint: **https://sitefinity-mcp-eftm2.fly.dev/mcp**

## Web explorer

Open the deployment root in a browser for a single-page app (served from
[`public/`](public/) by the same Node process) that showcases the whole server:

- **Dashboard** — live capability cards generated from `tools/list`, plus stats.
- **Assistant** *(optional)* — ask in plain English; Claude answers by calling
  the MCP tools live (enable with `ANTHROPIC_API_KEY`).
- **Content Library** — all discovered content types; click one for its full
  field schema, expandable relations, and a live sample of items.
- **Query Builder** — compose OData queries (filter/select/orderby/paging/expand).
- **Search** — free-text `contains()` search rendered as cards.
- **Tool Playground** — auto-generated forms for *every* tool, built from each
  tool's input schema, with the exact JSON-RPC request/response shown.
- **Wire log** — a drawer streaming every JSON-RPC message on the wire.

No build step — it's vanilla HTML/CSS/JS.

## Tools

All tool input schemas include a `type` enum populated from the live service
(39 content types on the default target, including custom dynamic types like
`corporatefooditems`, `testimonials`, `people`).

| Tool | What it does | Sitefinity API |
|---|---|---|
| `sitefinity_list_content_types` | List every content type with its fields & relations | service `$metadata` |
| `sitefinity_describe_type` | Full field + navigation list for one type | `$metadata` |
| `sitefinity_query_items` | Query a collection (filter/select/orderby/paging/expand/count) | `GET /{type}` |
| `sitefinity_get_item` | Fetch one item by GUID | `GET /{type}(id)` |
| `sitefinity_search_items` | Free-text `contains()` search across fields | `GET /{type}?$filter=` |
| `sitefinity_count_items` | Count items matching a filter | `GET /{type}/$count` |
| `sitefinity_get_related` | Related items via a navigation field | `GET /{type}(id)/{field}` |
| `sitefinity_get_metadata` | Entity-set names (+ raw XML) | `GET /$metadata` |
| `sitefinity_raw_get` | Arbitrary OData GET escape hatch | `GET /{path}` |

### OData query support

`$filter` supports `eq`, `ne`, `gt`, `lt`, `ge`, `le`, `and`, `or`, `not`,
`contains()`, `startswith()`, `endswith()`. Sitefinity params `sf_culture`,
`sf_site`, `sf_provider` are exposed as the `culture`, `site`, `provider` args.

## Configuration

All via environment variables (see [.env.example](.env.example)).

| Variable | Default | Notes |
|---|---|---|
| `SITEFINITY_BASE_URL` | `https://sta.eftm2.cloud.sitefinity.com` | Site origin |
| `SITEFINITY_SERVICE_NAME` | `default` | OData service name |
| `SITEFINITY_AUTH_MODE` | `anonymous` | `anonymous` or `password` |
| `SITEFINITY_USERNAME` / `SITEFINITY_PASSWORD` | — | Required when `password` |
| `SITEFINITY_CLIENT_ID` / `SITEFINITY_CLIENT_SECRET` | `sitefinity` / — | OAuth client |
| `SITEFINITY_DEFAULT_CULTURE` / `SITEFINITY_SITE_ID` | — | Applied to every request |
| `MCP_TRANSPORT` | `http` | `http` or `stdio` |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | HTTP transport bind |
| `ANTHROPIC_API_KEY` | — | Enables the AI Assistant (server-side secret) |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | Model for the Assistant |

### AI Assistant

The optional Assistant turns natural-language questions into live MCP tool calls
(Claude runs an agentic tool-use loop over this server's own tools). It's
off until you provide a key. The key is a **server-side secret** — it never
appears in the repo or reaches the browser; `/api/info` only exposes an
`aiEnabled` boolean. On Fly:

```bash
fly secrets set ANTHROPIC_API_KEY=sk-ant-...   # auto-restarts the app
```

**Auth.** Public content is anonymous. For protected content set
`SITEFINITY_AUTH_MODE=password`; the server runs the OAuth2 password grant
against `{baseUrl}/sitefinity/oauth/token` and caches/refreshes the token.

## Run locally

No install step — there are no dependencies.

```bash
# HTTP transport (default)
node src/index.js
# → POST JSON-RPC to http://localhost:8080/mcp

# stdio transport (for local MCP clients)
MCP_TRANSPORT=stdio node src/index.js
```

Smoke test the HTTP transport:

```bash
curl -s http://localhost:8080/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Use with an MCP client

### Hosted (HTTP)

Point any Streamable-HTTP MCP client at the deployed endpoint:

```
https://sitefinity-mcp-eftm2.fly.dev/mcp
```

### Local (stdio) — e.g. Claude Desktop

```json
{
  "mcpServers": {
    "sitefinity": {
      "command": "node",
      "args": ["/absolute/path/to/SitefinityMCP/src/index.js"],
      "env": { "MCP_TRANSPORT": "stdio" }
    }
  }
}
```

Then ask: *"List the Sitefinity content types"*, *"Find news items containing
'meal', newest first"*, *"How many newsitems are there?"*.

## Deploy to Fly.io

```bash
fly launch --no-deploy   # or use the committed fly.toml
fly deploy
```

The [Dockerfile](Dockerfile) copies the source and runs `node src/index.js` —
no build or install step. Health checks hit `/health`.

## HTTP endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Web explorer UI |
| POST | `/mcp` | JSON-RPC 2.0 MCP messages |
| POST | `/api/chat` | AI assistant (when `ANTHROPIC_API_KEY` is set) |
| GET | `/health` | Liveness probe |
| GET | `/api/info` | Server info (JSON, incl. `aiEnabled`) |

## Project layout

```
src/
  config.js      Environment-driven configuration
  odata.js       OData query-string builder + filter helpers
  metadata.js    Dependency-free $metadata (CSDL/XML) parser
  sitefinity.js  REST client (auth, requests, live introspection)
  tools.js       MCP tools, generated from the live schema
  mcp.js         JSON-RPC 2.0 protocol handler
  http.js        Streamable HTTP transport (+ serves the web UI + /api/chat)
  static.js      Path-traversal-safe static file handler
  stdio.js       stdio transport
  anthropic.js   Zero-dep Anthropic client + agentic tool-use loop
  chat.js        AI assistant handler (bridges MCP tools to Claude)
  index.js       Entry point
public/
  index.html     Web explorer markup
  styles.css     Web explorer styles
  app.js         Web explorer logic (vanilla ES module)
Dockerfile       Container image (no install step)
fly.toml         Fly.io deployment config
```

## License

MIT
