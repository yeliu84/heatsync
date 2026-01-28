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
  error: 'INVALID_URL' | 'FETCH_FAILED' | 'NO_PDFS_FOUND';
  message: string;
}
```

---

## Crawling Strategy

### Step 1: Fetch Page HTML
```typescript
const response = await fetch(url, {
  headers: {
    'User-Agent': 'HeatSync/2.0 (https://heatsync.now)',
  },
});
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
      const head = await fetch(pdf.url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
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
  // 1. Fetch HTML
  const response = await fetch(url, {
    headers: { 'User-Agent': 'HeatSync/2.0' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // 2. Detect platform
  const platform = detectPlatform(url);

  // 3. Extract meet name
  const meetName = extractMeetName($, platform);

  // 4. Extract PDF links
  const pdfLinks = extractPdfLinks($, url, platform);

  // 5. Infer names from link text/context
  const heatsheets = pdfLinks.map(link => ({
    url: link.url,
    name: inferName(link) || 'Heat Sheet',
  }));

  // 6. Enrich with file sizes (optional)
  const enriched = await enrichWithSizes(heatsheets);

  return { meetName, heatsheets: enriched };
};
```

### File: `packages/backend/src/routes/discover.ts`

```typescript
import { Hono } from 'hono';
import { discoverHeatsheets } from '@heatsync/backend/services/crawler';

export const discoverRoutes = new Hono();

discoverRoutes.post('/discover-heatsheets', async (c) => {
  const { url } = await c.req.json();

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return c.json({ success: false, error: 'INVALID_URL', message: 'URL must be HTTP or HTTPS' }, 400);
    }
  } catch {
    return c.json({ success: false, error: 'INVALID_URL', message: 'Invalid URL format' }, 400);
  }

  try {
    const result = await discoverHeatsheets(url);

    if (result.heatsheets.length === 0) {
      return c.json({ success: false, error: 'NO_PDFS_FOUND', message: 'No heat sheet PDFs found on this page' }, 404);
    }

    return c.json({ success: true, ...result });
  } catch (error) {
    return c.json({ success: false, error: 'FETCH_FAILED', message: error.message }, 500);
  }
});
```

---

## Platform-Specific Notes

### SwimTopia
- PDFs usually in `/files/` directory
- Meet name in `.meet-header` or `h1`
- Session info often in link text

### TeamUnify
- PDFs linked from event pages
- May need to follow links to find PDFs
- Meet name in page title or header

### Active.com
- PDFs in "Documents" section
- Often has advertisements mixed in
- May require scrolling/pagination

### Generic Sites
- Scan all `<a>` tags for `.pdf` links
- Filter by keywords: heat, sheet, psych, timeline, program

---

## Tasks

- [ ] Add `cheerio` dependency: `bun add cheerio`
- [ ] Create `packages/backend/src/services/crawler.ts`
- [ ] Create `packages/backend/src/routes/discover.ts`
- [ ] Register discover route in `packages/backend/src/index.ts`
- [ ] Add types to `packages/shared/src/types.ts`
- [ ] Test with real swim meet URLs

---

## Files to Create

| File | Description |
|------|-------------|
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
# Test with SwimTopia
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

# Test with invalid URL
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "not-a-url"}'

# Expected: { "success": false, "error": "INVALID_URL" }
```

---

## Edge Cases

1. **No PDFs found**: Return empty array with helpful message
2. **Page requires JavaScript**: May not work with static fetch (document limitation)
3. **PDFs behind authentication**: Will fail to access
4. **Rate limiting**: Implement delay between requests if crawling multiple pages
5. **Large pages**: Set response size limits

---

## Next Phase

→ [Phase 4: Frontend Multi-Upload UI](./phase-4.md)
