# splitwise-mcp

A production-style **Model Context Protocol** server that lets any MCP client (Claude, ChatGPT, Cursor, Zed, …) read and manage a real Splitwise account in natural language:

> "what do I owe Alex this month?"
> "add ₹196 for groceries, split evenly with the roommates"
> "settle up with Priya"

It is a full OAuth 2.1 Authorization Server that delegates user login to Splitwise — no hardcoded API keys, safe to host for multiple users.

## Why

Splitwise has a great data model but a clunky app for the things I do most often: logging an expense mid-conversation, or asking a question about who owes what. An LLM with direct Splitwise access turns both into a single sentence.

It's also a good excuse to build a real MCP server end-to-end — real OAuth dance, real persistence, real caching — rather than the usual demo that stuffs an API key in `.env`.

## What it does

- **18 MCP tools** covering Splitwise's full surface: users, friends, groups, expenses (with equal-split or per-user share math), comments, notifications, currencies, categories.
- **Per-user OAuth** — each MCP client signs in through Splitwise; the server never sees the user's password and never stores long-lived API secrets.
- **Response cache with explicit invalidation** — friends/groups/user/metadata endpoints are cached in Redis (5 min – 24 h) and automatically invalidated when the server performs a mutation. Every cached tool exposes a `force_refresh: true` flag so the LLM can bypass the cache on demand. Expenses/comments/notifications are deliberately never cached.
- **Resume-safe sessions** — 30-day bearer tokens so re-auth isn't required every hour.
- **Fail-fast boot** — pings Redis on startup and exits with an actionable error if anything's misconfigured.

## Stack

- **Runtime**: [Bun](https://bun.sh) 1.3 (native HTTP server, built-in Redis client, built-in SHA-256 hasher, zero transpile step)
- **Language**: TypeScript, strict mode
- **MCP**: [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) streamable HTTP transport
- **Auth**: hand-rolled OAuth 2.1 Authorization Server (RFC 6749 + MCP's Protected Resource Metadata), with Splitwise as the upstream identity provider
- **Persistence**: Redis via `Bun.redis` for OAuth codes/tokens + response cache (everything TTL'd via `SETEX` so Redis evicts for us)
- **Validation**: Zod schemas on every tool input
- **Process manager**: pm2 in fork mode
- **Tests**: `bun test` with read-only + opt-in write integration tests against real Splitwise

## Architecture

```
MCP client                         Our server                   Splitwise
    │  /authorize ───────────────────► │                            │
    │                                  │  /oauth/authorize ────────► │
    │                                  │                        user logs in
    │                                  │  ◄──────────── /auth/callback?code=sw
    │                                  │  POST /oauth/token ─────► │
    │                                  │  ◄────────── splitwise access_token
    │ ◄─── redirect_uri?code=ours ───  │
    │  POST /token ─────────────────► │  (mint bearer, store in Redis, 30d)
    │ ◄──────── { access_token } ───  │
    │                                  │
    │  POST /mcp (Bearer ours) ──────► │  verify bearer → Splitwise token
    │                                  │  route tool call → cache/API
    │ ◄──────────── result ─────────  │
```

Per-user cache scoping is done by SHA-256'ing the bearer into a 16-char prefix (`cache:u:<hash>:…`), so users of a multi-tenant deployment never see each other's cached data.

### Repo layout

```
oauth-mcp.ts               HTTP routing + boot (Bun.serve)
src/
  config.ts                env + TTL constants
  redis.ts                 Bun.redis helpers + PING-on-boot
  cache.ts                 per-user keyed cache (get/set/del)
  logger.ts                step-numbered structured logs
  http.ts                  json/html/randomToken helpers
  oauth/
    routes.ts              /authorize, /auth/splitwise/callback, /token, discovery docs
    store.ts               pending auths / codes / bearers in Redis (SETEX-based TTL)
    bearer.ts              Authorization header → AccessToken
    pages.ts               landing + demo callback pages
  splitwise/
    client.ts              typed REST wrapper + cache + invalidate-on-mutation
    oauth.ts               Splitwise authorize URL + token exchange
  mcp/
    session.ts             /mcp router + in-memory transport map
    server.ts              per-session McpServer factory
    tools/                 one file per domain (friends, groups, expenses, …)
tests/
  client.read.test.ts      read-only integration tests
  client.write.test.ts     opt-in mutating tests
```

## Run locally

```bash
bun install
brew services start redis    # or `redis-server` / `systemctl start redis`
cp .env.example .env         # then fill in SPLITWISE_CLIENT_ID/SECRET from https://secure.splitwise.com/apps
bun run dev
```

Point your MCP client at `http://localhost:3000/mcp`.

## Deploy (pm2)

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup              # follow printed command to enable auto-start on reboot
pm2 logs splitwise-mcp
```

The ecosystem file pins `instances: 1` because the MCP session map holds live streaming transports that can't be shared across workers. Horizontal scaling would need sticky sessions (or re-initialising on each replica).

For a public URL, set `BASE_URL=https://your.domain` in `.env` and register `https://your.domain/auth/splitwise/callback` as the Splitwise app's callback URL.

## Tests

```bash
# read-only, hits the real Splitwise API — needs a bearer in .env
SPLITWISE_TEST_TOKEN=... bun test tests/client.read.test.ts

# mutating (creates and deletes a test group on your account)
SPLITWISE_TEST_WRITE=1 bun run test:write
```
