# Phase 2: Backend API & SSE Streaming

**Goal:** Create batch processing endpoints with real-time progress

**Status:** Pending

**Depends on:** Phase 1 (Database Schema)

---

## New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch/extract` | POST | Create batch, accept multiple PDFs/URLs |
| `/api/batch/:id/stream` | GET | SSE stream for progress updates |
| `/api/batch/:id` | GET | Polling fallback for batch status |
| `/api/batch/:id/results` | GET | Get merged results from all jobs |

---

## API Specifications

### POST `/api/batch/extract`

Create a new batch processing request.

**Request (multipart/form-data):**
```typescript
interface BatchExtractRequest {
  swimmer: string;          // Swimmer name (required)
  pdfs?: File[];            // Direct file uploads (optional)
  urls?: string;            // JSON array of URLs (optional)
}
```

**Response:**
```typescript
interface BatchExtractResponse {
  success: true;
  batchId: string;          // UUID for tracking
  totalJobs: number;
  streamUrl: string;        // "/api/batch/{batchId}/stream"
}
```

### GET `/api/batch/:id/stream`

SSE stream for real-time progress updates.

**SSE Event Types:**
```typescript
// Batch started
{ type: 'batch_started'; batchId: string; totalJobs: number; swimmerName: string }

// Job progress update
{ type: 'job_progress'; jobId: string; sequence: number; status: string; progressPercent: number; progressMessage: string }

// Job completed successfully
{ type: 'job_completed'; jobId: string; sequence: number; resultCode: string; eventCount: number; meetName: string; cached: boolean }

// Job failed
{ type: 'job_failed'; jobId: string; sequence: number; errorCode: string; errorMessage: string }

// All jobs done
{ type: 'batch_completed'; completedJobs: number; failedJobs: number; totalEvents: number; results: JobResult[] }
```

### GET `/api/batch/:id`

Polling fallback for batch status (for clients that can't use SSE).

**Response:**
```typescript
interface BatchStatusResponse {
  success: true;
  batch: {
    id: string;
    swimmerName: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  jobs: Array<{
    id: string;
    sequence: number;
    filename: string | null;
    status: string;
    progressPercent: number;
    resultCode: string | null;
    error: string | null;
  }>;
}
```

### GET `/api/batch/:id/results`

Get merged results from all completed jobs.

**Response:**
```typescript
interface BatchResultsResponse {
  success: true;
  swimmerName: string;
  totalEvents: number;
  sources: Array<{
    sequence: number;
    filename: string | null;
    meetName: string;
    sessionDate: string;
    eventCount: number;
    resultCode: string;
  }>;
  events: SwimEvent[];      // All events merged
  warnings: string[];
}
```

---

## Processing Flow

```
1. POST /api/batch/extract
   ├── Validate swimmer name
   ├── Create processing_batches record (status: 'pending')
   ├── For each PDF/URL:
   │   └── Create batch_jobs record (status: 'pending')
   └── Return { batchId, streamUrl }

2. GET /api/batch/:id/stream
   ├── Validate batch exists
   ├── Update batch status → 'processing'
   ├── Emit SSE: batch_started
   │
   ├── For each job (sequential):
   │   ├── Update job status → 'downloading' (if URL)
   │   ├── Emit SSE: job_progress
   │   │
   │   ├── Download PDF (if URL) or use uploaded file
   │   ├── Calculate MD5 checksum
   │   │
   │   ├── Check extraction cache (pdf_id + swimmer)
   │   │   └── If cached → Emit job_completed, skip to next
   │   │
   │   ├── Update job status → 'processing'
   │   ├── Emit SSE: job_progress
   │   │
   │   ├── Call extractFromPdf() with progress callback
   │   │   └── Callback emits SSE: job_progress
   │   │
   │   ├── Cache result, create result link
   │   ├── Update job → status: 'completed', resultCode
   │   └── Emit SSE: job_completed
   │
   ├── Update batch counters
   ├── Update batch status → 'completed' | 'partial' | 'failed'
   └── Emit SSE: batch_completed
```

---

## Implementation

### File: `packages/backend/src/routes/batch.ts`

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { processBatch, getBatchStatus, getBatchResults } from '@heatsync/backend/services/batchProcessor';

export const batchRoutes = new Hono();

// Create batch
batchRoutes.post('/extract', async (c) => {
  // Implementation...
});

// SSE stream
batchRoutes.get('/:id/stream', async (c) => {
  const batchId = c.req.param('id');

  return streamSSE(c, async (stream) => {
    await processBatch(batchId, async (event) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    });
  });
});

// Polling fallback
batchRoutes.get('/:id', async (c) => {
  // Implementation...
});

// Get results
batchRoutes.get('/:id/results', async (c) => {
  // Implementation...
});
```

### File: `packages/backend/src/services/batchProcessor.ts`

```typescript
export interface ProgressCallback {
  (event: SSEEvent): Promise<void>;
}

export const processBatch = async (
  batchId: string,
  onProgress: ProgressCallback
): Promise<void> => {
  // Get batch and jobs from DB
  // Process each job sequentially
  // Emit progress events via callback
  // Update DB status after each job
};
```

---

## Tasks

- [ ] Create `packages/backend/src/routes/batch.ts`
- [ ] Create `packages/backend/src/services/batchProcessor.ts`
- [ ] Add progress callback support to `openai.ts` `extractFromPdf()`
- [ ] Register batch routes in `packages/backend/src/index.ts`
- [ ] Add batch types to `packages/shared/src/types.ts`
- [ ] Test SSE streaming with curl
- [ ] Test batch creation with multiple files

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/routes/batch.ts` | Batch API route handlers |
| `packages/backend/src/services/batchProcessor.ts` | Core batch processing logic |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/index.ts` | Register `/api/batch` routes |
| `packages/backend/src/services/openai.ts` | Add `onProgress` callback parameter |
| `packages/shared/src/types.ts` | Add `BatchExtractRequest`, `SSEEvent`, etc. |

---

## Verification

```bash
# Test batch creation
curl -X POST http://localhost:3001/api/batch/extract \
  -F "swimmer=John Smith" \
  -F "urls=[\"https://example.com/heat1.pdf\"]"

# Test SSE stream
curl -N http://localhost:3001/api/batch/{batchId}/stream

# Should see events like:
# event: batch_started
# data: {"type":"batch_started","batchId":"...","totalJobs":1}
#
# event: job_progress
# data: {"type":"job_progress","jobId":"...","progressPercent":50}
#
# event: batch_completed
# data: {"type":"batch_completed","completedJobs":1,"failedJobs":0}
```

---

## Next Phase

→ [Phase 3: Meet URL Crawler](./phase-3.md)
