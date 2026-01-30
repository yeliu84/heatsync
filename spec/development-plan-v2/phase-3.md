# Phase 3: Meet URL Crawler

**Goal:** Auto-discover heat sheet PDFs from swim meet website URLs

**Status:** Pending

**Depends on:** None (can run in parallel with Phase 2)

---

## Use Case

Instead of manually finding and entering each PDF link, user enters the swim meet website URL (e.g., `https://swimtopia.com/meet/winter-2026`) and we crawl it to find all heat sheet PDFs.

**Benefits:**
- Dramatically better UX - one URL instead of 4-8 PDF links
- Reduces copy-paste errors
- Shows all available sessions at once

---

## New Endpoint

### POST `/api/discover-heatsheets`

**Request:**
```typescript
{ url: string }
```

**Response:**
```typescript
interface DiscoverResponse {
  success: true;
  meetName?: string;           // Extracted meet name if found
  heatsheets: Array<{
    url: string;               // Direct PDF link
    name: string;              // Inferred name (e.g., "Session 1 - Prelims")
    size?: number;             // File size if HEAD request succeeds
  }>;
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'INVALID_URL' | 'BLOCKED_URL' | 'FETCH_FAILED' | 'NO_PDFS_FOUND' | 'PAGE_TOO_LARGE';
  message: string;
}
```

---

## SSRF Protection

**Critical security consideration.** The crawler fetches arbitrary user-provided URLs, which can be exploited to:
- Access internal services (SSRF attacks)
- Scan internal networks
- Access cloud metadata endpoints (AWS/GCP)

### URL Validation

```typescript
import { URL } from 'url';

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',
  'metadata.google.com',
  '169.254.169.254',           // AWS/GCP metadata
  '169.254.170.2',             // AWS ECS metadata
];

const BLOCKED_HOST_PATTERNS = [
  /\.internal$/i,              // *.internal
  /\.local$/i,                 // *.local
  /\.localhost$/i,             // *.localhost
];

export const isBlockedUrl = (urlString: string): { blocked: boolean; reason?: string } => {
  try {
    const url = new URL(urlString);
    
    // Block non-HTTP(S) protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { blocked: true, reason: 'Only HTTP/HTTPS URLs allowed' };
    }
    
    // Block explicit internal hostnames
    const hostname = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname)) {
      return { blocked: true, reason: 'Internal hostname not allowed' };
    }
    
    // Block pattern-based hostnames
    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        return { blocked: true, reason: 'Internal hostname not allowed' };
      }
    }
    
    // Block private IP ranges
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b, c, d] = ipMatch.map(Number);
      
      // 10.0.0.0/8
      if (a === 10) return { blocked: true, reason: 'Private IP not allowed' };
      
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return { blocked: true, reason: 'Private IP not allowed' };
      
      // 192.168.0.0/16
      if (a === 192 && b === 168) return { blocked: true, reason: 'Private IP not allowed' };
      
      // 127.0.0.0/8
      if (a === 127) return { blocked: true, reason: 'Loopback IP not allowed' };
      
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return { blocked: true, reason: 'Link-local IP not allowed' };
      
      // 0.0.0.0/8
      if (a === 0) return { blocked: true, reason: 'Invalid IP' };
    }
    
    return { blocked: false };
  } catch {
    return { blocked: true, reason: 'Invalid URL format' };
  }
};
```

---

## Fetch Limits

Prevent resource exhaustion from large pages or slow servers:

```typescript
const CRAWL_TIMEOUT_MS = 10000;        // 10 second timeout
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB max page size
const MAX_REDIRECTS = 5;

export const safeFetch = async (url: string): Promise<Response> => {
  // Validate URL first
  const { blocked, reason } = isBlockedUrl(url);
  if (blocked) {
    throw new Error(reason || 'URL blocked');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'HeatSync/2.0 (https://heatsync.now; swim meet heat sheet finder)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    // Check response size
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength > MAX_RESPONSE_SIZE) {
      throw new Error(`Page too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit`);
    }

    // Verify final URL after redirects isn't blocked
    const finalUrl = response.url;
    const { blocked: finalBlocked, reason: finalReason } = isBlockedUrl(finalUrl);
    if (finalBlocked) {
      throw new Error(`Redirect to blocked URL: ${finalReason}`);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};
```

---

## Crawling Strategy

### Step 1: Fetch Page HTML
```typescript
const response = await safeFetch(url);
if (!response.ok) {
  throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
}
const html = await response.text();
```

### Step 2: Extract PDF Links

**Primary patterns (high confidence):**
```typescript
// Direct PDF links
/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>/gi

// Links with heat sheet keywords
/heat|sheet|psych|timeline|program|schedule/i
```

**Link text patterns:**
```typescript
// Common naming patterns
/session\s*\d/i
/day\s*\d/i
/prelims?|finals?/i
/morning|afternoon|evening/i
/friday|saturday|sunday/i
```

### Step 3: Platform-Specific Patterns

```typescript
const PLATFORM_PATTERNS = {
  swimtopia: {
    urlMatch: /swimtopia\.com/i,
    pdfSelector: 'a[href*="/files/"]',
    meetNameSelector: 'h1.meet-name, .meet-header h1',
  },
  teamunify: {
    urlMatch: /teamunify\.com/i,
    pdfSelector: 'a[href*="document"], a[href$=".pdf"]',
    meetNameSelector: '.meet-name, #meet-title',
  },
  active: {
    urlMatch: /active\.com/i,
    pdfSelector: '.documents a[href$=".pdf"]',
    meetNameSelector: 'h1.event-title',
  },
  generic: {
    urlMatch: /.*/,
    pdfSelector: 'a[href$=".pdf"]',
    meetNameSelector: 'h1, title',
  },
};
```

### Step 4: Normalize and Deduplicate

```typescript
const normalizeUrl = (href: string, baseUrl: string): string => {
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return new URL(href, baseUrl).href;
  return new URL(href, baseUrl).href;
};

// Deduplicate by URL
const uniquePdfs = [...new Map(pdfs.map(p => [p.url, p])).values()];
```

### Step 5: Enrich with Metadata

```typescript
// Optional: Get file sizes via HEAD requests (parallel, with timeout)
const enriched = await Promise.all(
  pdfs.map(async (pdf) => {
    try {
      // Validate PDF URL too
      const { blocked } = isBlockedUrl(pdf.url);
      if (blocked) return pdf;

      const head = await fetch(pdf.url, { 
        method: 'HEAD', 
        signal: AbortSignal.timeout(3000) 
      });
      const size = parseInt(head.headers.get('content-length') || '0');
      return { ...pdf, size };
    } catch {
      return pdf; // Skip size if HEAD fails
    }
  })
);
```

---

## Implementation

### File: `packages/backend/src/services/crawler.ts`

```typescript
import * as cheerio from 'cheerio';
import { isBlockedUrl, safeFetch } from './urlValidation';

interface DiscoveredHeatsheet {
  url: string;
  name: string;
  size?: number;
}

interface CrawlResult {
  meetName?: string;
  heatsheets: DiscoveredHeatsheet[];
}

export const discoverHeatsheets = async (url: string): Promise<CrawlResult> => {
  // 1. Validate URL
  const { blocked, reason } = isBlockedUrl(url);
  if (blocked) {
    throw new Error(reason || 'URL not allowed');
  }

  // 2. Fetch HTML
  const response = await safeFetch(url);
  const html = await response.text();
  const $ = cheerio.load(html);

  // 3. Detect platform
  const platform = detectPlatform(url);

  // 4. Extract meet name
  const meetName = extractMeetName($, platform);

  // 5. Extract PDF links
  const pdfLinks = extractPdfLinks($, url, platform);

  // 6. Filter out any blocked URLs in the results
  const safePdfLinks = pdfLinks.filter(link => !isBlockedUrl(link.url).blocked);

  // 7. Infer names from link text/context
  const heatsheets = safePdfLinks.map(link => ({
    url: link.url,
    name: inferName(link) || 'Heat Sheet',
  }));

  // 8. Enrich with file sizes (optional)
  const enriched = await enrichWithSizes(heatsheets);

  return { meetName, heatsheets: enriched };
};
```

### File: `packages/backend/src/services/urlValidation.ts`

Contains `isBlockedUrl()` and `safeFetch()` from above.

### File: `packages/backend/src/routes/discover.ts`

```typescript
import { Hono } from 'hono';
import { discoverHeatsheets } from '@heatsync/backend/services/crawler';
import { isBlockedUrl } from '@heatsync/backend/services/urlValidation';

export const discoverRoutes = new Hono();

discoverRoutes.post('/discover-heatsheets', async (c) => {
  const { url } = await c.req.json();

  // Validate URL format
  if (!url || typeof url !== 'string') {
    return c.json({ success: false, error: 'INVALID_URL', message: 'URL is required' }, 400);
  }

  // Check for blocked URLs
  const { blocked, reason } = isBlockedUrl(url);
  if (blocked) {
    return c.json({ success: false, error: 'BLOCKED_URL', message: reason || 'URL not allowed' }, 400);
  }

  try {
    const result = await discoverHeatsheets(url);

    if (result.heatsheets.length === 0) {
      return c.json({ 
        success: false, 
        error: 'NO_PDFS_FOUND', 
        message: 'No heat sheet PDFs found on this page. Try a different URL or add PDFs manually.' 
      }, 404);
    }

    return c.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    if (message.includes('timeout') || message.includes('abort')) {
      return c.json({ success: false, error: 'FETCH_FAILED', message: 'Request timed out. The page took too long to load.' }, 504);
    }
    if (message.includes('too large')) {
      return c.json({ success: false, error: 'PAGE_TOO_LARGE', message }, 413);
    }
    
    return c.json({ success: false, error: 'FETCH_FAILED', message }, 500);
  }
});
```

---

## Tasks

- [ ] Add `cheerio` dependency: `bun add cheerio`
- [ ] Create `packages/backend/src/services/urlValidation.ts`
- [ ] Create `packages/backend/src/services/crawler.ts`
- [ ] Create `packages/backend/src/routes/discover.ts`
- [ ] Register discover route in `packages/backend/src/index.ts`
- [ ] Add types to `packages/shared/src/types.ts`
- [ ] Test SSRF protection with internal URLs
- [ ] Test with real swim meet URLs

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/services/urlValidation.ts` | URL validation and SSRF protection |
| `packages/backend/src/services/crawler.ts` | HTML parsing and PDF discovery logic |
| `packages/backend/src/routes/discover.ts` | API endpoint handler |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/index.ts` | Register `/api/discover-heatsheets` route |
| `packages/shared/src/types.ts` | Add `DiscoverResponse` type |
| `package.json` | Add `cheerio` dependency |

---

## Verification

```bash
# Test with valid URL
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "https://swimtopia.com/example-meet"}'

# Expected response:
{
  "success": true,
  "meetName": "Winter Championships 2026",
  "heatsheets": [
    { "url": "https://...", "name": "Session 1 - Friday Prelims", "size": 2456789 },
    { "url": "https://...", "name": "Session 2 - Friday Finals", "size": 1834567 }
  ]
}

# Test SSRF protection - should be blocked
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:8080"}'
# Expected: { "success": false, "error": "BLOCKED_URL" }

curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "http://169.254.169.254/latest/meta-data/"}'
# Expected: { "success": false, "error": "BLOCKED_URL" }

curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "http://192.168.1.1"}'
# Expected: { "success": false, "error": "BLOCKED_URL" }

# Test with invalid URL
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "not-a-url"}'
# Expected: { "success": false, "error": "INVALID_URL" }
```

---

## Edge Cases

1. **No PDFs found**: Return helpful message suggesting manual entry
2. **Page requires JavaScript**: May not work with static fetch (document limitation)
3. **PDFs behind authentication**: Will fail to access - suggest manual entry
4. **Large pages**: Reject with clear error message
5. **Redirect to internal URL**: Block after redirect validation
6. **IPv6 addresses**: Handle both IPv4 and IPv6

---

## Next Phase

→ [Phase 4: Frontend Multi-Upload UI](./phase-4.md)
