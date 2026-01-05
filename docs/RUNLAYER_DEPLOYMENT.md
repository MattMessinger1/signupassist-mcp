# Deploying SignupAssist MCP behind Runlayer (optional)

This document is a **deployment + integration note** for running SignupAssist’s MCP server behind Runlayer’s enterprise “trust layer” (catalog, governance, observability) as described on [`runlayer.com/about`](https://www.runlayer.com/about).

## Supported topology

### Option A (recommended): Runlayer catalog + direct connect

- Runlayer is used to **approve/catalog** the server, but MCP clients connect **directly** to SignupAssist.
- **No changes** required to SignupAssist.

### Option B: Runlayer as a reverse proxy / gateway

- MCP clients connect to a **Runlayer-hosted URL**, which proxies to SignupAssist.
- SignupAssist must see correct forwarded headers so its OAuth metadata points back to the **proxy URL**.
  - We already use `x-forwarded-host` + `x-forwarded-proto` when constructing `baseUrl` (`mcp_server/index.ts`).
- The proxy must support **streaming SSE** (no buffering) for `/sse`.

## What the MCP server must expose (SignupAssist already does)

### MCP SSE transport

- `GET|POST|HEAD /sse`
  - `GET /sse` unauthenticated returns **401** with `WWW-Authenticate` pointing to this server’s `/oauth/authorize` + `/oauth/token`.
  - `POST /sse` supports **finite JSON-RPC responses** for discovery (`initialize`, `tools/list`) and `tools/call` (so clients don’t accidentally fall into a long-lived SSE stream).
- `POST /sse/messages` (and compatibility alias `POST /messages`)

### OAuth + OIDC discovery (same-origin proxy-friendly)

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration`
- `GET /.well-known/jwks.json`
- OAuth proxy endpoints:
  - `GET /oauth/authorize` (redirects to Auth0)
  - `POST /oauth/token` (forwards token exchange to Auth0)

These exist specifically so clients (including ChatGPT) can do OAuth discovery while requiring all URLs to share the same root domain.

## Authentication expectations

- **Primary**: OAuth access tokens issued by Auth0 (forwarded in `Authorization: Bearer …`).
- **Ops/scripts**: `MCP_ACCESS_TOKEN` (service token path) is accepted on protected endpoints.

If Runlayer is acting as a gateway, it must forward the `Authorization` header unchanged unless you explicitly move to a “Runlayer-issued JWT” model (not implemented today).

## Tool visibility expectations

- Default posture: `tools/list` returns **public tools only** (today: typically just `signupassist.chat`).
- If an enterprise MCP client needs to see more tools, set `MCP_LISTTOOLS_INCLUDE_PRIVATE=true` (see `mcp_server/index.ts`).

## Audit + compliance expectations (what we log)

SignupAssist maintains an audit trail for consequential actions:

- DB table: `audit_events`
- Stored:
  - `tool`, `decision`, timing (`started_at`, `finished_at`)
  - `args_hash` / `result_hash` (SHA-256)
  - `args_json` is **PII-redacted** (e.g., delegate/participant data becomes `"[REDACTED]"`)

Runlayer can provide a second layer of audit/observability at the MCP gateway level; we treat that as additive.

## Hardening knobs to consider in a gateway deployment

These are implemented in `mcp_server/index.ts` and can be tuned via env vars:

- **Rate limiting**:
  - `RATE_LIMIT_ENABLED` (default: on in `NODE_ENV=production`)
  - `RATE_LIMIT_WINDOW_MS` (default: `60000`)
  - `RATE_LIMIT_TOOLS_MAX` (default: `240`/window)
  - `RATE_LIMIT_MESSAGES_MAX` (default: `600`/window)
  - `RATE_LIMIT_SSE_MAX` (default: `240`/window)
  - `RATE_LIMIT_OAUTH_TOKEN_MAX` (default: `2000`/window)
  - `SSE_MAX_ACTIVE` (default: `5` concurrent connections per token/IP)
- **Body size caps (413 on overflow)**:
  - `MAX_TOOLS_CALL_BODY_BYTES` (default: `262144`)
  - `MAX_MESSAGES_BODY_BYTES` (default: `262144`)
  - `MAX_OAUTH_TOKEN_BODY_BYTES` (default: `65536`)

## Proxy verification checklist (quick curl tests)

Assuming the proxy URL is `https://mcp.example.com`:

- OAuth discovery:
  - `GET https://mcp.example.com/.well-known/oauth-protected-resource`
  - `GET https://mcp.example.com/.well-known/oauth-authorization-server`
  - `GET https://mcp.example.com/.well-known/jwks.json`
- SSE streaming:
  - `GET https://mcp.example.com/sse` with `Accept: text/event-stream` (should stream when authenticated; should 401 unauthenticated with `WWW-Authenticate`)
- Finite JSON POST behavior (no accidental long-lived stream):
  - `POST https://mcp.example.com/sse` with JSON-RPC `initialize`
  - `POST https://mcp.example.com/sse` with JSON-RPC `tools/list`
  - `POST https://mcp.example.com/sse` with JSON-RPC `tools/call`

## What changes would we need?

For “Option A” (catalog + direct connect): **none**.

For “Option B” (Runlayer reverse proxy): usually **none**, as long as:

- The proxy forwards `Authorization`, `x-forwarded-host`, and `x-forwarded-proto`.
- The proxy supports **SSE pass-through** (no buffering/timeouts that break long-lived streams).

If Runlayer requires upstream services to accept a Runlayer-issued identity token instead of Auth0, we’d add a small auth adapter layer in `mcp_server/middleware/auth0.ts` (accepting a second issuer and mapping identity → `user_id`).


