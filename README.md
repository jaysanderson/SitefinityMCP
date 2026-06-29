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

Default target: `https://sta.eftm2.cloud.sitefinity.com/api/default/`
Live deployment: **https://sitefinity-mcp-eftm2.fly.dev/mcp**

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
| POST | `/mcp` | JSON-RPC 2.0 MCP messages |
| GET | `/health` | Liveness probe |
| GET | `/` | Info page |

## Project layout

```
src/
  config.js      Environment-driven configuration
  odata.js       OData query-string builder + filter helpers
  metadata.js    Dependency-free $metadata (CSDL/XML) parser
  sitefinity.js  REST client (auth, requests, live introspection)
  tools.js       MCP tools, generated from the live schema
  mcp.js         JSON-RPC 2.0 protocol handler
  http.js        Streamable HTTP transport
  stdio.js       stdio transport
  index.js       Entry point
Dockerfile       Container image (no install step)
fly.toml         Fly.io deployment config
```

## License

MIT
