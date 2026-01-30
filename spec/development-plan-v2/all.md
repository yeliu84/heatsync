# HeatSync Development Plan v2 - Multi-PDF Batch Processing

## Overview

Enable users to upload multiple PDF heat sheets at once, with real-time progress tracking, email notifications for long-running jobs, and grouped results display.

**Key Architectural Decisions:**
- **SSE over WebSocket** - Simpler, unidirectional (server→client), auto-reconnect built-in
- **Decoupled processing** - Batch processing runs independently of SSE connection (survives disconnects)
- **In-process job queue** - No external dependencies (no Redis/pg-boss), processing via async workers
- **Batch-based API** - Single endpoint creates batch, SSE streams progress

---

## Phase 1: Database Schema (Backend)

**Goal:** Add tables for batch processing

### New Tables

**`processing_batches`** - Represents a batch request
```sql
CREATE TABLE processing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swimmer_name VARCHAR(255) NOT NULL,
  total_pdfs INTEGER NOT NULL,
  completed_pdfs INTEGER DEFAULT 0,
  failed_pdfs INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending', -- pending|processing|completed|failed|partial|cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,              -- For cleanup (default: 30 days from creation)
  client_ip VARCHAR(45),
  last_event_id INTEGER DEFAULT 0,     -- For SSE reconnection
  -- Phase 5 additions:
  notification_email VARCHAR(255),
  notification_sent_at TIMESTAMPTZ
);
```

**`batch_jobs`** - Individual PDF jobs within a batch
```sql
CREATE TABLE batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  source_type VARCHAR(10) NOT NULL, -- 'file' | 'url'
  source_url TEXT,
  filename VARCHAR(255),
  file_checksum VARCHAR(32),
  status VARCHAR(20) DEFAULT 'pending', -- pending|downloading|processing|completed|failed|cancelled
  stage VARCHAR(30),                   -- queued|downloading|uploading_to_ai|extracting|caching|done
  progress_message TEXT,
  extraction_id UUID REFERENCES extraction_results(id),
  result_code VARCHAR(12),
  error_message TEXT,
  error_code VARCHAR(30),              -- For retry logic: transient|permanent
  retry_count INTEGER DEFAULT 0,
  cached BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

### Files to Modify
- `packages/backend/src/db/schema.ts` - Add Drizzle schema definitions
- `packages/backend/drizzle/` - Generate migration SQL

---

## Phase 2: Backend API & SSE Streaming

**Goal:** Create batch processing endpoints with real-time progress (decoupled from SSE connection)

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch/extract` | POST | Create batch, start processing immediately |
| `/api/batch/:id/stream` | GET | SSE stream for progress updates (reconnectable) |
| `/api/batch/:id` | GET | Polling fallback for batch status |
| `/api/batch/:id/results` | GET | Get merged results from all jobs |
| `/api/batch/:id/cancel` | POST | Cancel batch (stops pending jobs) |
| `/api/batch/:id/retry` | POST | Retry all failed jobs |
| `/api/batch/:id/jobs/:jobId/retry` | POST | Retry specific failed job |

### SSE Event Types
```typescript
type SSEEvent =
  | { type: 'batch_started'; batchId: string; totalJobs: number; eventId: number }
  | { type: 'job_progress'; jobId: string; sequence: number; stage: string; message: string; eventId: number }
  | { type: 'job_completed'; jobId: string; sequence: number; resultCode: string; eventCount: number; cached: boolean; eventId: number }
  | { type: 'job_failed'; jobId: string; sequence: number; errorCode: string; errorMessage: string; retriable: boolean; eventId: number }
  | { type: 'batch_completed'; completedJobs: number; failedJobs: number; results: JobResult[]; eventId: number }
  | { type: 'batch_cancelled'; eventId: number };
```

### SSE Reconnection (Last-Event-ID)

When client reconnects with `Last-Event-ID` header:
1. Server queries events since that ID from batch state
2. Server replays missed events
3. Continues streaming new events

```typescript
// Client
const eventSource = new EventSource(`/api/batch/${id}/stream`);
eventSource.onmessage = (e) => {
  // Browser automatically sends Last-Event-ID on reconnect
};

// Server
app.get('/api/batch/:id/stream', (c) => {
  const lastEventId = parseInt(c.req.header('Last-Event-ID') || '0');
  // Replay events since lastEventId, then stream new ones
});
```

### Processing Flow (Decoupled)

```
1. POST /api/batch/extract
   ├── Validate swimmer name
   ├── Check batch limit (max 15 PDFs)
   ├── Create processing_batches record (status: 'pending')
   ├── For each PDF/URL:
   │   └── Create batch_jobs record (status: 'pending')
   ├── **Start background processing immediately**
   └── Return { batchId, streamUrl }

2. Background processor (runs independently):
   ├── Update batch status → 'processing'
   ├── Increment last_event_id for each event
   │
   ├── For each job (sequential):
   │   ├── Check if batch cancelled → stop if so
   │   ├── Update job stage → 'downloading' (if URL)
   │   ├── Download PDF or read uploaded file
   │   ├── Calculate MD5 checksum
   │   │
   │   ├── Check extraction cache
   │   │   └── If cached → mark completed, continue
   │   │
   │   ├── Update job stage → 'uploading_to_ai'
   │   ├── Upload to OpenAI
   │   │
   │   ├── Update job stage → 'extracting'
   │   ├── Call AI extraction
   │   │
   │   ├── Update job stage → 'caching'
   │   ├── Cache result, create result link
   │   │
   │   ├── On error:
   │   │   ├── Classify error (transient vs permanent)
   │   │   ├── If transient + retry_count < 3 → retry with backoff
   │   │   └── Else mark failed
   │   │
   │   └── Update job → status: 'completed' | 'failed'
   │
   ├── Update batch counters
   ├── Update batch status → 'completed' | 'partial' | 'failed'
   └── Send email notification if registered

3. GET /api/batch/:id/stream (client connects anytime):
   ├── Replay events since Last-Event-ID
   └── Stream new events as they occur
```

### Batch Size Limit

```typescript
const MAX_PDFS_PER_BATCH = 15;

// In /api/batch/extract
const totalPdfs = (files?.length || 0) + (urls?.length || 0);
if (totalPdfs > MAX_PDFS_PER_BATCH) {
  return c.json({
    success: false,
    error: 'BATCH_TOO_LARGE',
    message: `Maximum ${MAX_PDFS_PER_BATCH} PDFs per batch. You submitted ${totalPdfs}.`
  }, 400);
}
```

### Retry Logic with Exponential Backoff

```typescript
const TRANSIENT_ERRORS = ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR', 'AI_OVERLOADED'];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const shouldRetry = (errorCode: string, retryCount: number): boolean => {
  return TRANSIENT_ERRORS.includes(errorCode) && retryCount < MAX_RETRIES;
};

const getRetryDelay = (retryCount: number): number => {
  return BASE_DELAY_MS * Math.pow(2, retryCount); // 1s, 2s, 4s
};
```

### Files to Create
- `packages/backend/src/routes/batch.ts` - New route handlers
- `packages/backend/src/services/batchProcessor.ts` - Batch processing logic
- `packages/backend/src/services/batchWorker.ts` - Background worker

### Files to Modify
- `packages/backend/src/index.ts` - Register batch routes
- `packages/backend/src/services/openai.ts` - Add progress callback support
- `packages/shared/src/types.ts` - Add batch-related types

---

## Phase 3: Meet URL Crawler

**Goal:** Auto-discover heat sheet PDFs from swim meet website URLs

### Use Case
Instead of manually finding and entering each PDF link, user enters the swim meet website URL (e.g., `https://swimconnect.com/meet/12345`) and we crawl it to find all heat sheet PDFs.

### New Endpoint

**POST `/api/discover-heatsheets`**

```typescript
// Request
{ url: string }

// Response
{
  success: true,
  meetName?: string,
  heatsheets: Array<{
    url: string,
    name: string,
    size?: number,
  }>
}
```

### SSRF Protection

```typescript
import { URL } from 'url';

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254', // AWS metadata
];

const isBlockedUrl = (urlString: string): boolean => {
  try {
    const url = new URL(urlString);
    
    // Block non-HTTP(S)
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    
    // Block internal hostnames
    if (BLOCKED_HOSTS.includes(url.hostname)) return true;
    
    // Block private IP ranges
    const ipMatch = url.hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return true;                    // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true;      // 192.168.0.0/16
      if (a === 127) return true;                   // 127.0.0.0/8
    }
    
    return false;
  } catch {
    return true; // Invalid URL
  }
};

// Usage
if (isBlockedUrl(url)) {
  return c.json({ success: false, error: 'BLOCKED_URL', message: 'URL not allowed' }, 400);
}
```

### Fetch Limits

```typescript
const CRAWL_TIMEOUT_MS = 10000;
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10MB

const response = await fetch(url, {
  headers: { 'User-Agent': 'HeatSync/2.0 (https://heatsync.now)' },
  signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS),
  redirect: 'follow',
});

const contentLength = parseInt(response.headers.get('content-length') || '0');
if (contentLength > MAX_RESPONSE_SIZE) {
  throw new Error('Page too large');
}
```

### Files to Create
- `packages/backend/src/routes/discover.ts` - Crawler endpoint
- `packages/backend/src/services/crawler.ts` - HTML parsing logic

### Files to Modify
- `packages/backend/src/index.ts` - Register discover route

---

## Phase 4: Frontend Multi-Upload UI

**Goal:** Allow users to queue multiple heat sheets (via meet URL, direct URLs, or file upload)

### New Store: `packages/webapp/src/lib/stores/batch.ts`

```typescript
interface QueueItem {
  id: string;
  source: { type: 'file'; file: File } | { type: 'url'; url: string };
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  stage?: string;
  result?: ExtractionResult;
  resultCode?: string;
  error?: string;
  retriable?: boolean;
}

// Stores
export const queueItems = writable<QueueItem[]>([]);
export const swimmerName = writable<string>('');
export const batchId = writable<string | null>(null);
export const batchStatus = writable<'idle' | 'collecting' | 'processing' | 'completed'>('idle');
export const lastEventId = writable<number>(0);
```

### SSE Client with Reconnection

```typescript
const connectToStream = (id: string): void => {
  const lastId = get(lastEventId);
  const url = `/api/batch/${id}/stream`;
  
  const eventSource = new EventSource(url);
  
  // Browser automatically sends Last-Event-ID on reconnect
  eventSource.addEventListener('job_progress', (e) => {
    const data = JSON.parse(e.data);
    lastEventId.set(data.eventId);
    updateJobProgress(data);
  });

  eventSource.onerror = () => {
    // EventSource auto-reconnects with Last-Event-ID
    console.log('SSE reconnecting...');
  };
};
```

### New Components

| Component | Purpose |
|-----------|---------|
| `MultiHeatSheetForm.svelte` | Main form with queue management |
| `MeetUrlInput.svelte` | Enter meet website URL, discover PDFs |
| `DiscoveredHeatsheets.svelte` | Show found PDFs, select which to include |
| `HeatSheetQueue.svelte` | Display queued items with add/remove |
| `QueueItem.svelte` | Individual item with status indicator |
| `ProgressPanel.svelte` | Overall progress + per-item status |
| `RetryButton.svelte` | Retry failed jobs |

### Files to Create
- `packages/webapp/src/lib/stores/batch.ts`
- `packages/webapp/src/lib/components/v2/MultiHeatSheetForm.svelte`
- `packages/webapp/src/lib/components/v2/HeatSheetQueue.svelte`
- `packages/webapp/src/lib/components/v2/ProgressPanel.svelte`
- `packages/webapp/src/lib/services/batchClient.ts` - SSE client

---

## Phase 5: Email Notification System

**Goal:** Notify users when long-running batches complete

### UX Flow
1. Processing starts
2. After **first job completes OR 15 seconds elapsed**, email prompt appears
3. User can enter email or dismiss
4. On submit, email is stored with batch
5. When batch completes, send email with results link

### Email Prompt Timing

```typescript
// In ProgressPanel.svelte
let showPrompt = false;
let promptTimer: number;

$effect(() => {
  if ($batchStatus === 'processing') {
    // Show after 15 seconds OR first job completion, whichever is first
    promptTimer = setTimeout(() => {
      showPrompt = true;
    }, 15000);
  }
  return () => clearTimeout(promptTimer);
});

// Also show when first job completes (if > 5 seconds elapsed)
$effect(() => {
  const completed = $queueItems.filter(i => i.status === 'completed').length;
  const elapsed = Date.now() - processingStartTime;
  if (completed === 1 && elapsed > 5000) {
    showPrompt = true;
  }
});
```

### New Endpoint
- `POST /api/batch/:id/notify` - Register email for notification

### Email Service: Resend
- Simple API, 100 free emails/day
- No complex setup required

### Files to Create
- `packages/backend/src/services/email.ts` - Email sending service
- `packages/webapp/src/lib/components/v2/EmailPrompt.svelte`

---

## Phase 6: Grouped Results Display

**Goal:** Display results organized by session/heat sheet

### New Route: `/batch/:id`

Shows all extraction results from a batch, grouped by source PDF.

### UI Design
```
Events for John Smith
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▼ Session 1 - Morning Heats (session1.pdf)
  ├── Jan 15 at Aquatic Center
  ├── [✓] Event 5: 100 Free - Heat 3, Lane 4
  └── [✓] Event 12: 50 Back - Heat 2, Lane 5

▼ Session 2 - Afternoon (from URL)
  └── ... 6 events

⚠️ Session 3 - Failed (session3.pdf)
  └── [Retry] Rate limit exceeded

24 events selected
[Export All to Calendar]  [Export Selected]
```

### Files to Create
- `packages/webapp/src/routes/batch/[id]/+page.svelte` - Batch results page
- `packages/webapp/src/lib/components/v2/GroupedResults.svelte`
- `packages/webapp/src/lib/components/v2/SessionGroup.svelte`

---

## Phase 7: Cleanup & Polish

**Goal:** Database maintenance, final integration, migration from old endpoints

### Database Cleanup Cron

Add cleanup for expired batches (runs daily via cron or on-demand):

```typescript
// packages/backend/src/services/cleanup.ts

const BATCH_TTL_DAYS = 30;

export const cleanupExpiredBatches = async (): Promise<number> => {
  const db = getDb();
  
  const result = await db
    .delete(processingBatches)
    .where(
      lt(processingBatches.createdAt, new Date(Date.now() - BATCH_TTL_DAYS * 24 * 60 * 60 * 1000))
    )
    .returning({ id: processingBatches.id });
  
  console.log(`Cleaned up ${result.length} expired batches`);
  return result.length;
};
```

### Cleanup Endpoint (Admin)

```typescript
// GET /api/admin/cleanup (protected, internal only)
adminRoutes.get('/cleanup', async (c) => {
  const deleted = await cleanupExpiredBatches();
  return c.json({ success: true, deletedBatches: deleted });
});
```

### Scheduled Cleanup (Cloudflare Worker)

Add to the existing Cloudflare Worker cron:

```typescript
// In packages/cloudflare-worker/src/index.ts
async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  // Keep-alive ping
  await fetch(`https://${TARGET_HOST}/api/health`, { method: 'HEAD' });
  
  // Daily cleanup (run at specific hour only)
  const hour = new Date().getUTCHours();
  if (hour === 3) { // 3 AM UTC
    await fetch(`https://${TARGET_HOST}/api/admin/cleanup`, {
      headers: { 'X-Admin-Key': env.ADMIN_KEY }
    });
  }
}
```

### Analytics Events

Add tracking for v2 features:

```typescript
// packages/webapp/src/lib/utils/analytics.ts
export const trackBatchStarted = (pdfCount: number, source: 'meet_url' | 'manual') => {
  track('batch_started', { pdfCount, source });
};

export const trackCrawlerUsed = (success: boolean, pdfsFound: number) => {
  track('crawler_used', { success, pdfsFound });
};

export const trackEmailRequested = () => {
  track('email_notification_requested');
};

export const trackRetryClicked = (jobCount: number) => {
  track('retry_clicked', { jobCount });
};
```

### Migration: Deprecate Old Endpoints

After v2 is stable:

1. Add deprecation headers to old endpoints:
```typescript
app.post('/api/extract', async (c) => {
  c.header('X-Deprecated', 'Use /api/batch/extract instead');
  // ... existing logic
});
```

2. Update frontend to use batch API exclusively
3. Monitor usage of old endpoints
4. Remove old endpoints in v2.1

### Tasks

- [ ] Create `packages/backend/src/services/cleanup.ts`
- [ ] Add cleanup endpoint (admin-protected)
- [ ] Update Cloudflare Worker for scheduled cleanup
- [ ] Add analytics events for v2 features
- [ ] Integration testing: full flow
- [ ] Mobile testing
- [ ] Add deprecation headers to old endpoints
- [ ] Update user-facing help/FAQ

---

## Critical Files Summary

### Backend
| File | Action |
|------|--------|
| `packages/backend/src/db/schema.ts` | ADD batch tables |
| `packages/backend/src/routes/batch.ts` | CREATE batch processing routes |
| `packages/backend/src/routes/discover.ts` | CREATE meet URL crawler route |
| `packages/backend/src/services/batchProcessor.ts` | CREATE batch processing logic |
| `packages/backend/src/services/batchWorker.ts` | CREATE background worker |
| `packages/backend/src/services/crawler.ts` | CREATE HTML parsing/PDF discovery |
| `packages/backend/src/services/email.ts` | CREATE email service (Resend) |
| `packages/backend/src/services/cleanup.ts` | CREATE cleanup service |
| `packages/backend/src/services/openai.ts` | MODIFY add progress callbacks |
| `packages/backend/src/index.ts` | MODIFY register new routes |

### Frontend
| File | Action |
|------|--------|
| `packages/webapp/src/lib/stores/batch.ts` | CREATE queue stores |
| `packages/webapp/src/lib/services/batchClient.ts` | CREATE SSE client |
| `packages/webapp/src/lib/components/v2/MultiHeatSheetForm.svelte` | CREATE main form |
| `packages/webapp/src/lib/components/v2/MeetUrlInput.svelte` | CREATE URL crawler UI |
| `packages/webapp/src/lib/components/v2/DiscoveredHeatsheets.svelte` | CREATE PDF selection |
| `packages/webapp/src/lib/components/v2/HeatSheetQueue.svelte` | CREATE queue display |
| `packages/webapp/src/lib/components/v2/ProgressPanel.svelte` | CREATE progress UI |
| `packages/webapp/src/lib/components/v2/GroupedResults.svelte` | CREATE results display |
| `packages/webapp/src/routes/batch/[id]/+page.svelte` | CREATE batch results page |
| `packages/webapp/src/routes/+page.svelte` | MODIFY use new form |
| `packages/shared/src/types.ts` | MODIFY add batch/crawler types |

---

## Parallel Workstreams

Work can be parallelized across frontend and backend:

```
Week 1:
  Backend:  Phase 1 (DB Schema) + Phase 2 (Batch API/SSE)
  Frontend: Phase 4 (UI structure, stores, SSE client)

Week 2:
  Backend:  Phase 3 (Meet URL Crawler)
  Frontend: Phase 4 (Meet URL UI, queue management)

Week 3:
  Backend:  Phase 5 (Email notifications via Resend)
  Frontend: Phase 6 (Grouped Results display)

Week 4:
  Phase 7: Cleanup, analytics, integration testing
  Migration from old endpoints
  Deploy
```

### Implementation Order (Critical Path)

1. **Database schema** (Phase 1) - blocks everything
2. **Batch API + SSE** (Phase 2) - core functionality
3. **Frontend stores + SSE client** (Phase 4 partial) - enables testing
4. **Meet URL crawler** (Phase 3) - can run parallel with frontend
5. **Full frontend UI** (Phase 4) - depends on API
6. **Email notifications** (Phase 5) - independent, can be last
7. **Grouped results** (Phase 6) - final polish
8. **Cleanup & migration** (Phase 7) - after stable

---

## Verification Plan

1. **Batch Creation**: Upload 3 PDFs → verify batch + 3 jobs created in DB
2. **SSE Streaming**: Open stream → verify progress events received
3. **SSE Reconnection**: Disconnect → reconnect → verify missed events replayed
4. **Background Processing**: Close browser → reopen → verify processing continued
5. **Batch Limit**: Submit 20 PDFs → verify rejected with clear message
6. **Retry**: Failed job → click retry → verify re-processes
7. **Cancel**: Mid-processing → cancel → verify remaining jobs stopped
8. **Cache Integration**: Submit same PDF twice → verify second is cached
9. **SSRF Protection**: Submit internal URL → verify blocked
10. **Email Notification**: Enter email → wait for completion → verify email received
11. **Grouped Results**: 3 PDFs → verify results grouped by source
12. **Cleanup**: Create old batch → run cleanup → verify deleted
13. **Mobile**: Test full flow on mobile device

---

## Environment Variables (New)

```bash
# Email notifications (Resend)
RESEND_API_KEY=re_...
NOTIFICATION_FROM_EMAIL=noreply@heatsync.now

# Admin (for cleanup endpoint)
ADMIN_KEY=your_secret_admin_key

# Limits
MAX_PDFS_PER_BATCH=15
BATCH_TTL_DAYS=30
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Max PDFs per batch | **15** | Balance usability vs cost/abuse |
| Email provider | **Resend** | Simple API, 100 free emails/day |
| SSE vs polling | **SSE with polling fallback** | Real-time updates, graceful degradation |
| Processing model | **Decoupled background worker** | Survives client disconnects |
| Retry strategy | **3 retries with exponential backoff** | Handle transient failures gracefully |
| Batch TTL | **30 days** | Balance storage vs user convenience |

### Migration Note
The batch API will replace `/api/extract` and `/api/extractUrl`. A batch with 1 PDF is equivalent to the old single-PDF flow. Existing result links (`/result/:code`) will continue to work.
