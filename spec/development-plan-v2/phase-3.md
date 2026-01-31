# Phase 3: Meet URL Discovery (GPT-Powered)

**Goal:** Auto-discover heat sheet PDFs from swim meet website URLs using GPT

**Status:** Pending

**Depends on:** None (can run in parallel with Phase 2)

---

## Overview

Instead of building a custom HTML parser/crawler, we use GPT to analyze the page content and extract PDF URLs. This approach is:

- **Simpler** — No need to handle different swim meet platforms (SwimTopia, TeamUnify, etc.)
- **More robust** — GPT understands context and can find PDFs even with varied page structures
- **Maintainable** — No brittle CSS selectors or regex patterns to update

---

## How It Works

1. User enters meet website URL
2. Backend fetches the HTML content
3. GPT analyzes the HTML and extracts:
   - Heat sheet PDF URLs
   - Session names (if identifiable)
   - Meet name
4. Return structured list to frontend

---

## New Endpoint

### POST `/api/discover-heatsheets`

**Request:**
```typescript
{ 
  url: string;  // Meet website URL
}
```

**Response:**
```typescript
interface DiscoverResponse {
  success: true;
  meetName?: string;
  heatsheets: Array<{
    url: string;      // Direct PDF link
    name: string;     // Session name (e.g., "Session 1 - Prelims")
  }>;
}
```

**Error Response:**
```typescript
{
  success: false;
  error: 'INVALID_URL' | 'BLOCKED_URL' | 'FETCH_FAILED' | 'NO_PDFS_FOUND';
  message: string;
}
```

---

## Implementation

### File: `packages/backend/src/routes/discover.ts`

```typescript
import { Hono } from 'hono';
import { isBlockedUrl } from '../services/urlValidation';
import { discoverHeatsheets } from '../services/pdfDiscovery';

export const discoverRoutes = new Hono();

discoverRoutes.post('/discover-heatsheets', async (c) => {
  const { url } = await c.req.json<{ url: string }>();

  // Basic validation
  if (!url || typeof url !== 'string') {
    return c.json({ success: false, error: 'INVALID_URL', message: 'URL is required' }, 400);
  }

  // SSRF protection - block internal URLs
  const validation = isBlockedUrl(url);
  if (validation.blocked) {
    return c.json({ success: false, error: 'BLOCKED_URL', message: validation.reason }, 400);
  }

  try {
    const result = await discoverHeatsheets(url);
    
    if (result.heatsheets.length === 0) {
      return c.json({ 
        success: false, 
        error: 'NO_PDFS_FOUND', 
        message: 'No heat sheet PDFs found on this page. Try entering PDF URLs directly.' 
      }, 404);
    }

    return c.json({
      success: true,
      meetName: result.meetName,
      heatsheets: result.heatsheets,
    });
  } catch (error) {
    console.error('[Discover] Failed:', error);
    return c.json({ 
      success: false, 
      error: 'FETCH_FAILED', 
      message: 'Failed to fetch the page. Check the URL and try again.' 
    }, 500);
  }
});
```

### File: `packages/backend/src/services/pdfDiscovery.ts`

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FETCH_TIMEOUT_MS = 15000;
const MAX_HTML_LENGTH = 100000; // ~100KB of HTML

interface DiscoveryResult {
  meetName?: string;
  heatsheets: Array<{
    url: string;
    name: string;
  }>;
}

/**
 * Fetch page HTML and use GPT to extract heat sheet PDF URLs
 */
export const discoverHeatsheets = async (pageUrl: string): Promise<DiscoveryResult> => {
  // Fetch the page
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; HeatSync/2.0; +https://heatsync.now)',
      'Accept': 'text/html',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch page: ${response.status}`);
  }

  let html = await response.text();
  
  // Truncate if too long (save tokens)
  if (html.length > MAX_HTML_LENGTH) {
    html = html.slice(0, MAX_HTML_LENGTH) + '\n<!-- truncated -->';
  }

  // Use GPT to extract PDFs
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a helpful assistant that extracts heat sheet PDF URLs from swim meet web pages.

Analyze the HTML and find all links to heat sheet PDFs. Heat sheets are PDF documents containing swim event schedules with heats, lanes, and times.

Look for:
- Links with .pdf extension
- Links containing words like "heat", "sheet", "psych", "timeline", "session", "prelim", "final"
- Links in sections about "documents", "downloads", "heat sheets", "meet info"

Return JSON in this exact format:
{
  "meetName": "Name of the swim meet (if found)",
  "heatsheets": [
    { "url": "https://example.com/session1.pdf", "name": "Session 1 - Prelims" },
    { "url": "https://example.com/session2.pdf", "name": "Session 2 - Finals" }
  ]
}

Rules:
- Return absolute URLs (resolve relative URLs against the page URL)
- If you can't determine a session name, use the filename or "Heat Sheet N"
- Exclude non-heat-sheet PDFs (entry forms, meet info, etc.) if distinguishable
- Return empty heatsheets array if no PDFs found
- meetName can be null if not found`
      },
      {
        role: 'user',
        content: `Page URL: ${pageUrl}\n\nHTML content:\n${html}`
      }
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from GPT');
  }

  try {
    const result = JSON.parse(content) as DiscoveryResult;
    
    // Validate and resolve URLs
    const baseUrl = new URL(pageUrl);
    result.heatsheets = result.heatsheets
      .map(hs => ({
        ...hs,
        url: resolveUrl(hs.url, baseUrl),
      }))
      .filter(hs => isValidPdfUrl(hs.url));

    return result;
  } catch (e) {
    console.error('[Discovery] Failed to parse GPT response:', content);
    throw new Error('Failed to parse discovery results');
  }
};

/**
 * Resolve relative URL to absolute
 */
const resolveUrl = (url: string, base: URL): string => {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
};

/**
 * Basic validation that URL looks like a PDF
 */
const isValidPdfUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};
```

### File: `packages/backend/src/services/urlValidation.ts`

```typescript
/**
 * Basic SSRF protection - block internal/private URLs
 */

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',  // Cloud metadata
];

const BLOCKED_PATTERNS = [
  /^10\./,            // 10.x.x.x
  /^172\.(1[6-9]|2\d|3[01])\./,  // 172.16-31.x.x
  /^192\.168\./,      // 192.168.x.x
  /\.internal$/i,
  /\.local$/i,
];

export interface UrlValidationResult {
  blocked: boolean;
  reason?: string;
}

export const isBlockedUrl = (urlString: string): UrlValidationResult => {
  try {
    const url = new URL(urlString);
    
    // Check protocol
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { blocked: true, reason: 'Only HTTP/HTTPS URLs allowed' };
    }

    // Check hostname
    const hostname = url.hostname.toLowerCase();
    
    if (BLOCKED_HOSTS.includes(hostname)) {
      return { blocked: true, reason: 'Internal URLs not allowed' };
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(hostname)) {
        return { blocked: true, reason: 'Private network URLs not allowed' };
      }
    }

    return { blocked: false };
  } catch {
    return { blocked: true, reason: 'Invalid URL format' };
  }
};
```

---

## Cost Considerations

Using `gpt-4o-mini` keeps costs low:
- Input: ~$0.15 per 1M tokens
- Output: ~$0.60 per 1M tokens
- Typical page: 20-50K tokens input, 500 tokens output
- **Cost per discovery: ~$0.003-0.008** (less than 1 cent)

---

## Tasks

- [ ] Create `packages/backend/src/routes/discover.ts`
- [ ] Create `packages/backend/src/services/pdfDiscovery.ts`
- [ ] Create `packages/backend/src/services/urlValidation.ts`
- [ ] Register discover routes in `packages/backend/src/index.ts`
- [ ] Test with various swim meet platforms (SwimTopia, TeamUnify, Active.com)
- [ ] Test SSRF protection
- [ ] Add rate limiting (optional)

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/routes/discover.ts` | Discovery endpoint |
| `packages/backend/src/services/pdfDiscovery.ts` | GPT-powered PDF extraction |
| `packages/backend/src/services/urlValidation.ts` | SSRF protection |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/index.ts` | Register discover routes |

---

## Verification

```bash
# Test with SwimTopia meet page
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.swimtopia.com/some-meet"}'

# Expected response:
{
  "success": true,
  "meetName": "Winter Championships 2026",
  "heatsheets": [
    { "url": "https://..../session1.pdf", "name": "Session 1 - Friday Prelims" },
    { "url": "https://..../session2.pdf", "name": "Session 2 - Friday Finals" }
  ]
}

# Test SSRF protection
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "http://169.254.169.254/latest/meta-data/"}'

# Expected: 400 with BLOCKED_URL error
```

---

## Design Notes

### Why GPT instead of custom crawler?

| Approach | Pros | Cons |
|----------|------|------|
| Custom crawler | No API cost, faster | Brittle, needs per-platform logic, maintenance burden |
| GPT extraction | Handles any page structure, self-adapts | API cost (~$0.005/call), slightly slower |

For a side project with moderate traffic, GPT extraction wins on simplicity and maintainability.

### Future: Caching

If the same meet URL is requested multiple times, we could cache the discovery results in DB for 1 hour to reduce API calls.

---

## Next Phase

→ [Phase 4: Frontend Multi-Upload UI](./phase-4.md)
