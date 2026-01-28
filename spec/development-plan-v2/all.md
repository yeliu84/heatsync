# HeatSync Development Plan v2 - Multi-PDF Batch Processing

## Overview

Enable users to upload multiple PDF heat sheets at once, with real-time progress tracking, email notifications for long-running jobs, and grouped results display.

**Key Architectural Decisions:**
- **SSE over WebSocket** - Simpler, unidirectional (server→client), auto-reconnect built-in
- **In-process job queue** - No external dependencies (no Redis/pg-boss), processing within SSE connection
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
  status VARCHAR(20) DEFAULT 'pending', -- pending|processing|completed|failed|partial
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  client_ip VARCHAR(45)
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
  status VARCHAR(20) DEFAULT 'pending', -- pending|downloading|processing|completed|failed
  progress_percent INTEGER DEFAULT 0,
  progress_message TEXT,
  extraction_id UUID REFERENCES extraction_results(id),
  result_code VARCHAR(12),
  error_message TEXT,
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

**Goal:** Create batch processing endpoints with real-time progress

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch/extract` | POST | Create batch, accept multiple PDFs/URLs |
| `/api/batch/:id/stream` | GET | SSE stream for progress updates |
| `/api/batch/:id` | GET | Polling fallback for batch status |
| `/api/batch/:id/results` | GET | Get merged results from all jobs |

### SSE Event Types
```typescript
type SSEEvent =
  | { type: 'batch_started'; batchId: string; totalJobs: number }
  | { type: 'job_progress'; jobId: string; sequence: number; status: string; progressPercent: number }
  | { type: 'job_completed'; jobId: string; resultCode: string; eventCount: number; cached: boolean }
  | { type: 'job_failed'; jobId: string; errorCode: string; errorMessage: string }
  | { type: 'batch_completed'; completedJobs: number; failedJobs: number; results: [...] };
```

### Processing Flow
1. POST `/api/batch/extract` → Create batch + jobs in DB → Return `{ batchId, streamUrl }`
2. Client connects to GET `/api/batch/:id/stream`
3. Server processes jobs sequentially, emits progress events
4. On completion, emit `batch_completed` with all result codes

### Files to Create
- `packages/backend/src/routes/batch.ts` - New route handlers
- `packages/backend/src/services/batchProcessor.ts` - Batch processing logic

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
  meetName?: string,           // Extracted meet name if found
  heatsheets: Array<{
    url: string,               // Direct PDF link
    name: string,              // Inferred name (e.g., "Session 1 - Prelims")
    size?: number,             // File size if available
  }>
}
```

### Crawling Strategy

1. **Fetch page HTML** using native fetch
2. **Extract PDF links** using regex/DOM parsing:
   - Direct `<a href="*.pdf">` links
   - Links containing "heat", "sheet", "psych", "timeline"
   - Links inside specific containers (varies by platform)
3. **Normalize URLs** to absolute paths
4. **Deduplicate** and sort by name
5. **Optional: Follow common patterns** for popular platforms:
   - SwimTopia
   - TeamUnify
   - Active.com
   - Hy-Tek Meet Manager web exports

### Platform-Specific Patterns

| Platform | URL Pattern | PDF Location |
|----------|-------------|--------------|
| SwimTopia | `swimtopia.com/meet/*` | `/files/` directory |
| TeamUnify | `teamunify.com/*/meet/*` | Linked in event pages |
| Active.com | `active.com/event/*` | Documents section |
| Generic | Any URL | Scan all `<a>` tags for `.pdf` |

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
  progress?: number;
  result?: ExtractionResult;
  resultCode?: string;
  error?: string;
}

// Stores
export const queueItems = writable<QueueItem[]>([]);
export const swimmerName = writable<string>('');
export const batchId = writable<string | null>(null);
export const batchStatus = writable<'idle' | 'collecting' | 'processing' | 'completed'>('idle');
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

### UI Flow

**Option A: Meet URL Discovery (Recommended First)**
1. User enters swim meet website URL
2. Click "Find Heat Sheets" → crawl website
3. Show discovered PDFs with checkboxes
4. User selects which to include, enters swimmer name
5. Click "Find Events" → batch processing

**Option B: Manual Entry**
1. User enters swimmer name
2. Add PDFs via URL paste or file upload
3. Click "Find Events in X Heat Sheets"

**Both Options:**
4. **Processing**: SSE connection opens, show progress
5. **Results**: Navigate to grouped results view

### UI Mockup - Meet URL Discovery
```
┌─────────────────────────────────────────────────────────────┐
│  Enter Meet Website URL                                     │
│  ┌───────────────────────────────────────────┐ [Find PDFs]  │
│  │ https://swimtopia.com/meets/winter-2026   │              │
│  └───────────────────────────────────────────┘              │
│                                                             │
│  Found 4 Heat Sheets:                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ [✓] Session 1 - Friday Prelims (2.3 MB)             │   │
│  │ [✓] Session 2 - Friday Finals (1.8 MB)              │   │
│  │ [✓] Session 3 - Saturday Prelims (2.5 MB)           │   │
│  │ [✓] Session 4 - Saturday Finals (1.9 MB)            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Swimmer: [John Smith                           ]           │
│                                                             │
│            [Find Events in 4 Heat Sheets]                   │
└─────────────────────────────────────────────────────────────┘
```

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
2. After 4 seconds, email prompt appears below progress
3. User can enter email or dismiss
4. On submit, email is stored with batch
5. When batch completes, send email with results link

### New Endpoint
- `POST /api/batch/:id/notify` - Register email for notification

### Database Addition
Add to `processing_batches`:
```sql
notification_email VARCHAR(255),
notification_sent_at TIMESTAMPTZ
```

### Email Service Options (Recommend: Resend)
- Simple API, good free tier (100 emails/day)
- No complex setup required
- Alternative: SendGrid, AWS SES

### Files to Create
- `packages/backend/src/services/email.ts` - Email sending service
- `packages/webapp/src/lib/components/v2/EmailPrompt.svelte`

---

## Phase 6: Grouped Results Display

**Goal:** Display results organized by session/heat sheet

### New Route: `/batch/:id/results`

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

24 events selected
[Export All to Calendar]  [Export Selected]
```

### Files to Create
- `packages/webapp/src/routes/batch/[id]/+page.svelte` - Batch results page
- `packages/webapp/src/lib/components/v2/GroupedResults.svelte`
- `packages/webapp/src/lib/components/v2/SessionGroup.svelte`

---

## Critical Files Summary

### Backend
| File | Action |
|------|--------|
| `packages/backend/src/db/schema.ts` | ADD batch tables |
| `packages/backend/src/routes/batch.ts` | CREATE batch processing routes |
| `packages/backend/src/routes/discover.ts` | CREATE meet URL crawler route |
| `packages/backend/src/services/batchProcessor.ts` | CREATE batch processing logic |
| `packages/backend/src/services/crawler.ts` | CREATE HTML parsing/PDF discovery |
| `packages/backend/src/services/email.ts` | CREATE email service (Resend) |
| `packages/backend/src/services/openai.ts` | MODIFY add progress callbacks |
| `packages/backend/src/routes/extract.ts` | DELETE (deprecated) |
| `packages/backend/src/routes/extractUrl.ts` | DELETE (deprecated) |
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
  Integration testing
  Migrate from old endpoints
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

---

## Verification Plan

1. **Batch Creation**: Upload 3 PDFs → verify batch + 3 jobs created in DB
2. **SSE Streaming**: Open stream → verify progress events received
3. **Parallel Requests**: Two users submit batches → verify independent processing
4. **Cache Integration**: Submit same PDF twice → verify second is cached
5. **Email Notification**: Enter email → wait for completion → verify email received
6. **Grouped Results**: 3 PDFs → verify results grouped by source
7. **Error Handling**: Submit invalid URL → verify graceful failure, other jobs continue
8. **Mobile**: Test full flow on mobile device

---

## Environment Variables (New)

```bash
# Email notifications (Resend)
RESEND_API_KEY=re_...
NOTIFICATION_FROM_EMAIL=noreply@heatsync.now
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Max PDFs per batch | **No limit** | Trust users, rely on rate limiting |
| Email provider | **Resend** | Simple API, 100 free emails/day |
| API compatibility | **Deprecate old endpoints** | Simpler codebase, batch API handles single PDF too |

### Migration Note
The batch API will replace `/api/extract` and `/api/extractUrl`. A batch with 1 PDF is equivalent to the old single-PDF flow. Existing result links (`/result/:code`) will continue to work.
