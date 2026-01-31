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
{ 
  url: string;
  usePlaywright?: boolean;  // Optional: use headless browser for JS-rendered pages
}
```

**Response:**
```typescript
interface DiscoverResponse {
  success: true;
  meetName?: string;           // Extracted meet name if found
  platform?: string;           // Detected platform (swimtopia, teamunify, etc.)
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
  error: 'INVALID_URL' | 'BLOCKED_URL' | 'FETCH_FAILED' | 'NO_PDFS_FOUND' | 'PAGE_TOO_LARGE' | 'REQUIRES_JAVASCRIPT';
  message: string;
  hint?: string;  // Helpful suggestion for user
}
```

---

## SSRF Protection

**Critical security consideration.** The crawler fetches arbitrary user-provided URLs, which can be exploited to:
- Access internal services (SSRF attacks)
- Scan internal networks
- Access cloud metadata endpoints (AWS/GCP)

### File: `packages/backend/src/services/urlValidation.ts`

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
  'instance-data',             // Azure metadata
];

const BLOCKED_HOST_PATTERNS = [
  /\.internal$/i,              // *.internal
  /\.local$/i,                 // *.local
  /\.localhost$/i,             // *.localhost
  /\.corp$/i,                  // *.corp
  /\.lan$/i,                   // *.lan
];

export interface UrlValidationResult {
  blocked: boolean;
  reason?: string;
}

export const isBlockedUrl = (urlString: string): UrlValidationResult => {
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
    
    // Block IPv6 private ranges (simplified)
    if (hostname.startsWith('[')) {
      const ipv6 = hostname.slice(1, -1).toLowerCase();
      if (ipv6.startsWith('fc') || ipv6.startsWith('fd') || ipv6.startsWith('fe80')) {
        return { blocked: true, reason: 'Private IPv6 not allowed' };
      }
    }
    
    return { blocked: false };
  } catch {
    return { blocked: true, reason: 'Invalid URL format' };
  }
};

/**
 * Safe fetch with SSRF protection, timeouts, and size limits
 */
export const safeFetch = async (
  url: string,
  options: {
    timeoutMs?: number;
    maxSizeBytes?: number;
    method?: 'GET' | 'HEAD';
  } = {}
): Promise<Response> => {
  const {
    timeoutMs = 10_000,
    maxSizeBytes = 10 * 1024 * 1024, // 10MB
    method = 'GET',
  } = options;

  // Validate URL
  const { blocked, reason } = isBlockedUrl(url);
  if (blocked) {
    throw new Error(reason || 'URL blocked');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        // Mimic a real browser to avoid bot detection
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    // Check response size
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength > maxSizeBytes) {
      throw new Error(`Page too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds limit`);
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

## Crawler Implementation

### File: `packages/backend/src/services/crawler.ts`

```typescript
import * as cheerio from 'cheerio';
import { isBlockedUrl, safeFetch } from './urlValidation';

export interface DiscoveredHeatsheet {
  url: string;
  name: string;
  size?: number;
}

export interface CrawlResult {
  meetName?: string;
  platform?: string;
  heatsheets: DiscoveredHeatsheet[];
}

// Platform detection patterns
const PLATFORMS = {
  swimtopia: {
    urlMatch: /swimtopia\.com/i,
    pdfSelector: 'a[href*="/files/"], a[href$=".pdf"]',
    meetNameSelector: 'h1.meet-name, .meet-header h1, h1',
  },
  teamunify: {
    urlMatch: /teamunify\.com|swimmingrank\.com/i,
    pdfSelector: 'a[href*="document"], a[href$=".pdf"]',
    meetNameSelector: '.meet-name, #meet-title, h1',
  },
  active: {
    urlMatch: /active\.com/i,
    pdfSelector: '.documents a[href$=".pdf"], a[href$=".pdf"]',
    meetNameSelector: 'h1.event-title, h1',
  },
  swimconnection: {
    urlMatch: /swimconnection\.com/i,
    pdfSelector: 'a[href$=".pdf"]',
    meetNameSelector: '.meet-name, h1',
  },
  generic: {
    urlMatch: /.*/,
    pdfSelector: 'a[href$=".pdf"], a[href*=".pdf?"]',
    meetNameSelector: 'h1, title',
  },
};

/**
 * Detect platform from URL
 */
const detectPlatform = (url: string): keyof typeof PLATFORMS => {
  for (const [name, config] of Object.entries(PLATFORMS)) {
    if (name !== 'generic' && config.urlMatch.test(url)) {
      return name as keyof typeof PLATFORMS;
    }
  }
  return 'generic';
};

/**
 * Normalize PDF URL (handle relative paths, query strings, etc.)
 */
const normalizePdfUrl = (href: string, baseUrl: string): string | null => {
  try {
    let url: URL;
    
    if (href.startsWith('http://') || href.startsWith('https://')) {
      url = new URL(href);
    } else if (href.startsWith('//')) {
      url = new URL(`https:${href}`);
    } else {
      url = new URL(href, baseUrl);
    }
    
    // Remove fragments
    url.hash = '';
    
    // Validate the resulting URL
    if (isBlockedUrl(url.href).blocked) {
      return null;
    }
    
    return url.href;
  } catch {
    return null;
  }
};

/**
 * Infer a readable name from link context
 */
const inferName = (
  $: cheerio.CheerioAPI,
  link: cheerio.Element,
  href: string
): string => {
  // Try link text first
  const linkText = $(link).text().trim();
  if (linkText && linkText.length > 2 && linkText.length < 100) {
    return linkText;
  }
  
  // Try title attribute
  const title = $(link).attr('title');
  if (title) {
    return title;
  }
  
  // Try parent context
  const parentText = $(link).parent().text().trim();
  if (parentText && parentText.length > 2 && parentText.length < 100) {
    return parentText;
  }
  
  // Fall back to filename
  const filename = href.split('/').pop()?.split('?')[0] || 'Heat Sheet';
  return filename.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ');
};

/**
 * Check if a link looks like a heat sheet (not a random PDF)
 */
const isLikelyHeatSheet = (href: string, text: string): boolean => {
  const combined = `${href} ${text}`.toLowerCase();
  
  const heatSheetPatterns = [
    /heat/i,
    /sheet/i,
    /psych/i,
    /timeline/i,
    /program/i,
    /session/i,
    /prelim/i,
    /final/i,
    /schedule/i,
    /entries/i,
  ];
  
  const excludePatterns = [
    /waiver/i,
    /registration/i,
    /application/i,
    /flyer/i,
    /map/i,
    /hotel/i,
    /parking/i,
    /volunteer/i,
  ];
  
  // Exclude non-heat-sheet PDFs
  if (excludePatterns.some(p => p.test(combined))) {
    return false;
  }
  
  // Include if matches heat sheet patterns
  if (heatSheetPatterns.some(p => p.test(combined))) {
    return true;
  }
  
  // Include generic PDFs (might be heat sheets)
  return true;
};

/**
 * Get file sizes for PDFs via HEAD requests
 */
const enrichWithSizes = async (
  heatsheets: DiscoveredHeatsheet[]
): Promise<DiscoveredHeatsheet[]> => {
  const results = await Promise.allSettled(
    heatsheets.map(async (sheet) => {
      try {
        const response = await safeFetch(sheet.url, {
          method: 'HEAD',
          timeoutMs: 3000,
        });
        const size = parseInt(response.headers.get('content-length') || '0');
        return { ...sheet, size };
      } catch {
        return sheet;
      }
    })
  );
  
  return results.map((r, i) => 
    r.status === 'fulfilled' ? r.value : heatsheets[i]
  );
};

/**
 * Discover heat sheets from a meet URL
 */
export const discoverHeatsheets = async (url: string): Promise<CrawlResult> => {
  // 1. Validate URL
  const { blocked, reason } = isBlockedUrl(url);
  if (blocked) {
    throw new Error(reason || 'URL not allowed');
  }

  // 2. Detect platform
  const platform = detectPlatform(url);
  const config = PLATFORMS[platform];
  console.log(`[Crawler] Platform detected: ${platform}`);

  // 3. Fetch HTML
  const response = await safeFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }
  
  const html = await response.text();
  
  // 4. Check for JavaScript-heavy pages
  if (html.includes('__NEXT_DATA__') || html.includes('window.__INITIAL_STATE__')) {
    console.log('[Crawler] Page appears to use JavaScript rendering');
    // Could add Playwright fallback here
  }
  
  const $ = cheerio.load(html);

  // 5. Extract meet name
  let meetName: string | undefined;
  const meetNameEl = $(config.meetNameSelector).first();
  if (meetNameEl.length) {
    meetName = meetNameEl.text().trim();
    if (meetName.length > 200) meetName = meetName.slice(0, 200);
  }

  // 6. Extract PDF links
  const pdfLinks: { url: string; name: string }[] = [];
  const seenUrls = new Set<string>();
  
  $(config.pdfSelector).each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    
    const normalizedUrl = normalizePdfUrl(href, url);
    if (!normalizedUrl) return;
    
    // Deduplicate
    if (seenUrls.has(normalizedUrl)) return;
    seenUrls.add(normalizedUrl);
    
    const name = inferName($, el, href);
    
    // Filter to likely heat sheets
    if (!isLikelyHeatSheet(normalizedUrl, name)) {
      console.log(`[Crawler] Skipping non-heat-sheet: ${name}`);
      return;
    }
    
    pdfLinks.push({ url: normalizedUrl, name });
  });

  console.log(`[Crawler] Found ${pdfLinks.length} PDF link(s)`);

  // 7. Enrich with file sizes
  const heatsheets = await enrichWithSizes(pdfLinks);

  return { meetName, platform, heatsheets };
};

/**
 * Discover heat sheets using Playwright (for JS-rendered pages)
 * This is optional and requires Playwright to be installed
 */
export const discoverHeatsheetsWithPlaywright = async (url: string): Promise<CrawlResult> => {
  // Lazy import to avoid bundling Playwright when not used
  const { chromium } = await import('playwright');
  
  const browser = await chromium.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(url, { 
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    
    const html = await page.content();
    await browser.close();
    
    // Parse with cheerio (same logic as above)
    const $ = cheerio.load(html);
    // ... same extraction logic
    
    return { meetName: undefined, platform: 'playwright', heatsheets: [] };
  } finally {
    await browser.close();
  }
};
```

---

## Route Handler

### File: `packages/backend/src/routes/discover.ts`

```typescript
import { Hono } from 'hono';
import { discoverHeatsheets, discoverHeatsheetsWithPlaywright } from '@heatsync/backend/services/crawler';
import { isBlockedUrl } from '@heatsync/backend/services/urlValidation';

export const discoverRoutes = new Hono();

discoverRoutes.post('/discover-heatsheets', async (c) => {
  const body = await c.req.json();
  const { url, usePlaywright = false } = body;

  // Validate URL presence
  if (!url || typeof url !== 'string') {
    return c.json({ 
      success: false, 
      error: 'INVALID_URL', 
      message: 'URL is required',
      hint: 'Enter the URL of the swim meet website',
    }, 400);
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return c.json({ 
      success: false, 
      error: 'INVALID_URL', 
      message: 'Invalid URL format',
      hint: 'Make sure the URL starts with http:// or https://',
    }, 400);
  }

  // Check for blocked URLs
  const { blocked, reason } = isBlockedUrl(url);
  if (blocked) {
    return c.json({ 
      success: false, 
      error: 'BLOCKED_URL', 
      message: reason || 'URL not allowed',
    }, 400);
  }

  try {
    const usePlaywrightEnabled = usePlaywright && process.env.USE_PLAYWRIGHT_CRAWLER === 'true';
    
    const result = usePlaywrightEnabled
      ? await discoverHeatsheetsWithPlaywright(url)
      : await discoverHeatsheets(url);

    if (result.heatsheets.length === 0) {
      return c.json({ 
        success: false, 
        error: 'NO_PDFS_FOUND', 
        message: 'No heat sheet PDFs found on this page.',
        hint: 'Try the direct link to the heat sheets page, or add PDF URLs manually.',
      }, 404);
    }

    return c.json({ 
      success: true, 
      meetName: result.meetName,
      platform: result.platform,
      heatsheets: result.heatsheets,
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Discover] Error crawling ${url}:`, message);
    
    if (message.includes('timeout') || message.includes('abort')) {
      return c.json({ 
        success: false, 
        error: 'FETCH_FAILED', 
        message: 'Request timed out. The page took too long to load.',
        hint: 'The website might be slow or blocking automated requests.',
      }, 504);
    }
    
    if (message.includes('too large')) {
      return c.json({ 
        success: false, 
        error: 'PAGE_TOO_LARGE', 
        message,
        hint: 'Try a more specific page with just the heat sheet links.',
      }, 413);
    }
    
    return c.json({ 
      success: false, 
      error: 'FETCH_FAILED', 
      message,
      hint: 'Check the URL and try again, or add PDF URLs manually.',
    }, 500);
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
- [ ] Test with real swim meet URLs (SwimTopia, TeamUnify)
- [ ] Test with JavaScript-heavy pages
- [ ] Consider adding Playwright for JS rendering (optional)

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
# Test with valid swim meet URL
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.swimtopia.com/meets/winter-championships"}'

# Expected response:
{
  "success": true,
  "meetName": "Winter Championships 2026",
  "platform": "swimtopia",
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

# Test with page that has no PDFs
curl -X POST http://localhost:3001/api/discover-heatsheets \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# Expected: { "success": false, "error": "NO_PDFS_FOUND", "hint": "..." }
```

---

## Known Limitations

1. **JavaScript-rendered pages**: Cheerio can't execute JavaScript. Pages that load content dynamically won't work without Playwright.
   - **Mitigation**: Add optional Playwright mode, document limitation clearly

2. **Authentication-required pages**: Can't access PDFs behind login.
   - **Mitigation**: Clear error message suggesting manual entry

3. **Bot detection**: Some sites block automated requests.
   - **Mitigation**: Use realistic browser headers, consider rotating user agents

4. **Rate limiting**: Some sites may rate limit requests.
   - **Mitigation**: Cache results, implement backoff

---

## Future Improvements

1. **Playwright integration**: Add optional headless browser for JS-heavy sites
2. **Platform-specific scrapers**: More refined extraction for common platforms
3. **Caching**: Cache discovered PDFs for a short period
4. **Session cookie support**: Allow user to provide cookies for authenticated pages

---

## Next Phase

→ [Phase 4: Frontend Multi-Upload UI](./phase-4.md)
