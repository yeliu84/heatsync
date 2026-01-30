# Cloudflare Worker: Proxy + Keep-Alive

**Date:** 2026-01-28
**Status:** Approved

## Problem

The HeatSync production site (heatsync.ai-builders.space) goes into deep sleep after 5 minutes of inactivity on Koyeb. This causes:
- Slow cold-start times for first visitors
- Occasional 404 errors due to proxy/service desync

## Solution

Create a Cloudflare Worker that:
1. Proxies requests from `heatsync.now` to `heatsync.ai-builders.space` (replacing dashboard config)
2. Pings the backend every 4 minutes via cron trigger to prevent sleep

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Worker                       │
│                  (heatsync-worker)                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐          ┌──────────────────────┐     │
│  │ fetch event  │          │ scheduled event      │     │
│  │ (HTTP req)   │          │ (cron: */4 * * * *)  │     │
│  └──────┬───────┘          └──────────┬───────────┘     │
│         │                             │                  │
│         ▼                             ▼                  │
│  ┌──────────────┐          ┌──────────────────────┐     │
│  │    Proxy     │          │    Keep-alive ping   │     │
│  │  to backend  │          │    to backend        │     │
│  └──────────────┘          └──────────────────────┘     │
│                                                          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────┐
            │  heatsync.ai-builders   │
            │       .space            │
            └─────────────────────────┘
```

## Project Structure

```
packages/cloudflare-worker/
├── src/
│   └── index.ts          # Worker entry point
├── wrangler.toml         # Cloudflare configuration
├── package.json          # Dependencies
└── tsconfig.json         # TypeScript config
```

## Implementation

### src/index.ts

```typescript
const TARGET_HOST = "heatsync.ai-builders.space";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, `https://${TARGET_HOST}`);

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
    });

    const response = await fetch(modifiedRequest);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const response = await fetch(`https://${TARGET_HOST}/`, {
      method: "HEAD",
    });

    console.log(`Keep-alive ping: ${response.status} at ${new Date().toISOString()}`);
  },
};
```

### wrangler.toml

```toml
name = "heatsync-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

routes = [
  { pattern = "heatsync.now", custom_domain = true }
]

[triggers]
crons = ["*/4 * * * *"]
```

## Deployment

### Manual
```bash
cd packages/cloudflare-worker
npx wrangler deploy
```

### CI/CD (GitHub Actions)
Auto-deploys on push to main when worker files change.

Requires `CLOUDFLARE_API_TOKEN` secret in GitHub repository settings.

## Setup Requirements

1. Add `CLOUDFLARE_API_TOKEN` to GitHub repository secrets
2. First deploy must be manual to configure custom domain binding
3. Remove old worker from Cloudflare dashboard after new one is verified
