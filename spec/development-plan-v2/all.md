# HeatSync Development Plan v2 - Multi-PDF Batch Processing

## Overview

Enable users to upload multiple PDF heat sheets at once, with real-time progress tracking, email notifications for long-running jobs, and grouped results display.

**Key Architectural Decisions:**
- **SSE over WebSocket** - Simpler, unidirectional (server→client), auto-reconnect built-in
- **Decoupled processing** - Batch processing runs independently of SSE connection (survives disconnects)
- **Postgres-backed job queue** - Jobs stored in DB, polling worker with `FOR UPDATE SKIP LOCKED` (survives restarts, no Redis needed)
- **Batch-based API** - Single endpoint creates batch, SSE streams progress
- **S3-compatible storage** - Uploaded files stored in Supabase Storage (survives restarts, works on serverless)
- **Global concurrency control** - Limit concurrent AI calls across all batches (DB-based counting)

---

## Phase 1: Database Schema (Backend)

**Goal:** Add tables for batch processing

### New Tables

**`processing_batches`** - Represents a batch request
```sql
CREATE TABLE processing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swimmer_name_normalized VARCHAR(255) NOT NULL,  -- lowercase for matching
  swimmer_name_display VARCHAR(255) NOT NULL,     -- original case for display
  total_pdfs INTEGER NOT NULL,
  completed_pdfs INTEGER DEFAULT 0,
  failed_pdfs INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending', -- pending|processing|completed|failed|partial|cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,              -- For cleanup (default: 30 days from creation)
  processing_timeout_at TIMESTAMPTZ,   -- For stuck batch detection
  worker_heartbeat TIMESTAMPTZ,        -- Last worker activity
  client_ip VARCHAR(45),
  user_agent TEXT,
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
  temp_file_path TEXT,              -- Path to temp file (for uploads)
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

### Key Implementation Details

1. **S3-Compatible Storage:** Uploaded files stored in Supabase Storage (works on serverless/ephemeral)
2. **Polling Worker:** Background worker polls `batch_jobs` table every 2s using `FOR UPDATE SKIP LOCKED`
3. **Global Concurrency:** Max 10 concurrent AI calls, enforced by counting active jobs in DB
4. **SSE Broadcasting:** In-memory EventEmitter for real-time updates
5. **Restart Resilience:** Jobs + files persist — server restart resumes pending work automatically

### Files to Create
- `packages/backend/src/routes/batch.ts` - Batch API routes
- `packages/backend/src/services/jobWorker.ts` - Postgres polling worker
- `packages/backend/src/services/fileStorage.ts` - S3-compatible storage (Supabase)
- `packages/backend/src/services/concurrency.ts` - DB-based concurrency control
- `packages/backend/src/services/eventBroadcast.ts` - SSE event broadcasting

### Files to Modify
- `packages/backend/src/index.ts` - Register batch routes, orphan recovery on startup
- `packages/backend/src/services/openai.ts` - Add progress callback support
- `packages/shared/src/types.ts` - Add batch-related types

---

## Phase 3: Meet URL Discovery (GPT-Powered)

**Goal:** Auto-discover heat sheet PDFs from swim meet website URLs using GPT

### New Endpoint

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/discover-heatsheets` | POST | Fetch page, use GPT to extract PDF URLs |

### Key Implementation Details

1. **GPT-Powered Extraction:** Use gpt-4o-mini to analyze HTML and find PDF links
2. **No Custom Parsing:** Works with any swim meet platform without per-site logic
3. **SSRF Protection:** Block private IPs, internal hostnames, metadata endpoints
4. **Low Cost:** ~$0.005 per discovery call

### Files to Create
- `packages/backend/src/routes/discover.ts` - Discovery endpoint
- `packages/backend/src/services/pdfDiscovery.ts` - GPT-powered extraction
- `packages/backend/src/services/urlValidation.ts` - SSRF protection

### Files to Modify
- `packages/backend/src/index.ts` - Register discover route

---

## Phase 4: Frontend Multi-Upload UI

**Goal:** Allow users to queue multiple heat sheets (via meet URL, direct URLs, or file upload)

### Key Implementation Details

1. **Multi-file Drag & Drop:** Accept multiple PDF files
2. **Queue Management:** Add, remove, reorder items
3. **SSE with Reconnection:** Handle offline/reconnection gracefully
4. **URL Validation:** Client-side validation before discovery
5. **Progress Tracking:** Per-job and overall progress

### Files to Create
- `packages/webapp/src/lib/stores/batch.ts`
- `packages/webapp/src/lib/services/batchClient.ts` - SSE client with reconnection
- `packages/webapp/src/lib/components/v2/MultiHeatSheetForm.svelte`
- `packages/webapp/src/lib/components/v2/HeatSheetQueue.svelte`
- `packages/webapp/src/lib/components/v2/ProgressPanel.svelte`

---

## Phase 5: Email Notification System

**Goal:** Notify users when long-running batches complete

### Key Implementation Details

1. **Atomic Send:** Prevent duplicate emails with atomic DB update
2. **Privacy Compliant:** Include privacy policy link, explain why received
3. **Email Validation:** Use zod for proper validation
4. **Prompt Timing:** Show after 15s or first job completion

### Files to Create
- `packages/backend/src/services/email.ts` - Email sending service (Resend)
- `packages/webapp/src/lib/components/v2/EmailPrompt.svelte`

---

## Phase 6: Grouped Results Display

**Goal:** Display results organized by session/heat sheet

### Key Implementation Details

1. **Event Deduplication:** Detect same event across sources
2. **Empty Source Handling:** Don't show sources with zero events
3. **Deep Linking:** Support `#session-N` hash links
4. **Smart Filenames:** Different names for single vs multi-source exports

### Files to Create
- `packages/webapp/src/routes/batch/[id]/+page.svelte` - Batch results page
- `packages/webapp/src/lib/components/v2/GroupedResults.svelte`
- `packages/webapp/src/lib/components/v2/SessionGroup.svelte`

---

## Phase 7: Cleanup & Polish

**Goal:** Database maintenance, final integration, migration from old endpoints

### Key Implementation Details

1. **Batch Cleanup:** Delete expired batches (30 days)
2. **Temp File Cleanup:** Remove orphaned temp files
3. **Worker Health:** Heartbeat tracking, stuck batch detection
4. **Analytics:** Track error types, batch metrics
5. **Rollback Plan:** Keep v1 endpoints working, feature flags

### Files to Create
- `packages/backend/src/services/cleanup.ts`
- `packages/backend/src/routes/admin.ts`

---

## Critical Files Summary

### Backend
| File | Action |
|------|--------|
| `packages/backend/src/db/schema.ts` | ADD batch tables |
| `packages/backend/src/routes/batch.ts` | CREATE batch processing routes |
| `packages/backend/src/routes/discover.ts` | CREATE meet URL crawler route |
| `packages/backend/src/routes/admin.ts` | CREATE admin endpoints |
| `packages/backend/src/services/jobWorker.ts` | CREATE Postgres polling worker |
| `packages/backend/src/services/fileStorage.ts` | CREATE S3-compatible storage |
| `packages/backend/src/services/pdfDiscovery.ts` | CREATE GPT-powered PDF extraction |
| `packages/backend/src/services/urlValidation.ts` | CREATE SSRF protection |
| `packages/backend/src/services/email.ts` | CREATE email service (Resend) |
| `packages/backend/src/services/cleanup.ts` | CREATE cleanup service |
| `packages/backend/src/services/openai.ts` | MODIFY add progress callbacks |
| `packages/backend/src/index.ts` | MODIFY register new routes, orphan recovery |

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
| `packages/webapp/src/lib/components/v2/EmailPrompt.svelte` | CREATE email prompt |
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
2. **Temp file service** (Phase 2 prereq) - blocks async file handling
3. **Batch API + SSE** (Phase 2) - core functionality
4. **Frontend stores + SSE client** (Phase 4 partial) - enables testing
5. **Meet URL crawler** (Phase 3) - can run parallel with frontend
6. **Full frontend UI** (Phase 4) - depends on API
7. **Email notifications** (Phase 5) - independent, can be last
8. **Grouped results** (Phase 6) - final polish
9. **Cleanup & migration** (Phase 7) - after stable

---

## Verification Plan

1. **Batch Creation**: Upload 3 PDFs → verify batch + 3 jobs created in DB
2. **File Persistence**: Create batch → verify temp files exist → process → verify cleanup
3. **SSE Streaming**: Open stream → verify progress events received
4. **SSE Reconnection**: Disconnect → reconnect → verify missed events replayed
5. **Background Processing**: Close browser → reopen → verify processing continued
6. **Concurrency Limit**: Submit 20 PDFs across 2 batches → verify max 10 concurrent AI calls
7. **Batch Limit**: Submit 16 PDFs → verify rejected with clear message
8. **Worker Recovery**: Kill worker mid-batch → restart server → verify batch resumes
9. **Retry**: Failed job → click retry → verify re-processes
10. **Cancel**: Mid-processing → cancel → verify remaining jobs stopped
11. **Cache Integration**: Submit same PDF twice → verify second is cached
12. **SSRF Protection**: Submit internal URL → verify blocked
13. **Email Notification**: Enter email → wait for completion → verify email received (no duplicates)
14. **Grouped Results**: 3 PDFs → verify results grouped by source
15. **Event Deduplication**: Same event in 2 sources → verify flagged/handled
16. **Cleanup**: Create old batch → run cleanup → verify deleted + temp files removed
17. **Mobile**: Test full flow on mobile device
18. **Offline**: Go offline mid-processing → come online → verify reconnection

---

## Environment Variables (New)

```bash
# Email notifications (Resend)
RESEND_API_KEY=re_...
NOTIFICATION_FROM_EMAIL=noreply@heatsync.now
BASE_URL=https://heatsync.now

# Admin (for cleanup endpoint)
ADMIN_KEY=your_secret_admin_key

# Limits
MAX_PDFS_PER_BATCH=15
BATCH_TTL_DAYS=30
CONCURRENT_JOBS_PER_BATCH=3
MAX_CONCURRENT_AI_CALLS=10

# Temp files
TEMP_FILE_DIR=/tmp/heatsync

# Optional: Playwright for JS-rendered pages
USE_PLAYWRIGHT_CRAWLER=false
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Max PDFs per batch | **15** | Balance usability vs cost/abuse |
| Concurrent jobs per batch | **3** | Faster completion without overwhelming AI |
| Max concurrent AI calls (global) | **10** | Prevent API rate limits across all users |
| Email provider | **Resend** | Simple API, 100 free emails/day |
| SSE vs polling | **SSE with polling fallback** | Real-time updates, graceful degradation |
| Processing model | **Decoupled background worker** | Survives client disconnects |
| File storage | **Temp files on disk** | Required for async processing |
| Retry strategy | **3 retries with exponential backoff** | Handle transient failures gracefully |
| Batch TTL | **30 days** | Balance storage vs user convenience |
| Worker recovery | **On startup orphan detection** | Handle crashes gracefully |

### Migration Note
The batch API will replace `/api/extract` and `/api/extractUrl`. A batch with 1 PDF is equivalent to the old single-PDF flow. Existing result links (`/result/:code`) will continue to work.

### Rollback Plan
If v2 has critical issues:
1. Feature flag `ENABLE_BATCH_API=false` disables new endpoints
2. Old endpoints remain functional (not removed, just deprecated)
3. Frontend can switch back to v1 form via feature detection
