# Phase 2: Backend API & SSE Streaming

**Goal:** Create batch processing endpoints with real-time progress (decoupled from SSE connection)

**Status:** Pending

**Depends on:** Phase 1 (Database Schema)

---

## Key Design: Decoupled Processing

**Problem:** If processing is tied to the SSE connection, closing the browser tab stops processing.

**Solution:** 
1. `POST /api/batch/extract` starts background processing immediately
2. `GET /api/batch/:id/stream` just observes progress (can reconnect anytime)
3. Processing continues even if no client is connected

---

## New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch/extract` | POST | Create batch, start processing immediately |
| `/api/batch/:id/stream` | GET | SSE stream for progress updates (reconnectable) |
| `/api/batch/:id` | GET | Polling fallback for batch status |
| `/api/batch/:id/results` | GET | Get merged results from all jobs |
| `/api/batch/:id/cancel` | POST | Cancel batch (stops pending jobs) |
| `/api/batch/:id/retry` | POST | Retry all failed jobs |
| `/api/batch/:id/jobs/:jobId/retry` | POST | Retry specific failed job |

---

## API Specifications

### POST `/api/batch/extract`

Create a new batch processing request. Processing starts immediately in background.

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
  batchId: string;
  totalJobs: number;
  streamUrl: string;        // "/api/batch/{batchId}/stream"
}
```

**Error Responses:**
```typescript
// Batch too large
{ success: false, error: 'BATCH_TOO_LARGE', message: 'Maximum 15 PDFs per batch. You submitted 20.' }

// Missing swimmer name
{ success: false, error: 'MISSING_SWIMMER', message: 'Swimmer name is required.' }

// No PDFs provided
{ success: false, error: 'NO_PDFS', message: 'At least one PDF file or URL is required.' }
```

### Batch Size Limit

```typescript
const MAX_PDFS_PER_BATCH = parseInt(process.env.MAX_PDFS_PER_BATCH || '15');

// Validation in /api/batch/extract
const totalPdfs = (files?.length || 0) + (urls?.length || 0);
if (totalPdfs > MAX_PDFS_PER_BATCH) {
  return c.json({
    success: false,
    error: 'BATCH_TOO_LARGE',
    message: `Maximum ${MAX_PDFS_PER_BATCH} PDFs per batch. You submitted ${totalPdfs}.`
  }, 400);
}
if (totalPdfs === 0) {
  return c.json({
    success: false,
    error: 'NO_PDFS',
    message: 'At least one PDF file or URL is required.'
  }, 400);
}
```

---

### GET `/api/batch/:id/stream`

SSE stream for real-time progress updates. Supports reconnection via `Last-Event-ID`.

**SSE Event Types:**
```typescript
type SSEEvent =
  // Batch started
  | { type: 'batch_started'; batchId: string; totalJobs: number; swimmerName: string; eventId: number }
  
  // Job progress update
  | { type: 'job_progress'; jobId: string; sequence: number; stage: JobStage; message: string; eventId: number }
  
  // Job completed successfully
  | { type: 'job_completed'; jobId: string; sequence: number; resultCode: string; eventCount: number; meetName: string; cached: boolean; eventId: number }
  
  // Job failed
  | { type: 'job_failed'; jobId: string; sequence: number; errorCode: string; errorMessage: string; retriable: boolean; retryCount: number; eventId: number }
  
  // All jobs done
  | { type: 'batch_completed'; status: 'completed' | 'partial' | 'failed'; completedJobs: number; failedJobs: number; totalEvents: number; results: JobResult[]; eventId: number }
  
  // Batch cancelled
  | { type: 'batch_cancelled'; eventId: number };

type JobStage = 'queued' | 'downloading' | 'uploading_to_ai' | 'extracting' | 'caching' | 'done' | 'failed';
```

### SSE Reconnection (Last-Event-ID)

When client reconnects with `Last-Event-ID` header:
1. Server queries batch state and reconstructs events since that ID
2. Server replays missed events
3. Continues streaming new events

```typescript
// Server implementation
batchRoutes.get('/:id/stream', async (c) => {
  const batchId = c.req.param('id');
  const lastEventId = parseInt(c.req.header('Last-Event-ID') || '0');

  return streamSSE(c, async (stream) => {
    // Get current batch state
    const batch = await getBatch(batchId);
    if (!batch) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Batch not found' }) });
      return;
    }

    // Replay events since lastEventId
    if (lastEventId < batch.lastEventId) {
      const events = await reconstructEventsSince(batchId, lastEventId);
      for (const event of events) {
        await stream.writeSSE({ id: String(event.eventId), event: event.type, data: JSON.stringify(event) });
      }
    }

    // Subscribe to new events
    await subscribeToEvents(batchId, async (event) => {
      await stream.writeSSE({ id: String(event.eventId), event: event.type, data: JSON.stringify(event) });
    });
  });
});
```

---

### POST `/api/batch/:id/cancel`

Cancel a batch. Stops processing of pending jobs.

**Response:**
```typescript
{ success: true, cancelledJobs: number }
```

---

### POST `/api/batch/:id/retry`

Retry all failed jobs in a batch.

**Response:**
```typescript
{ success: true, retriedJobs: number }
```

---

### POST `/api/batch/:id/jobs/:jobId/retry`

Retry a specific failed job.

**Response:**
```typescript
{ success: true }
```

---

### GET `/api/batch/:id`

Polling fallback for batch status (for clients that can't use SSE).

**Response:**
```typescript
interface BatchStatusResponse {
  success: true;
  batch: {
    id: string;
    swimmerName: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial' | 'cancelled';
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    lastEventId: number;
  };
  jobs: Array<{
    id: string;
    sequence: number;
    filename: string | null;
    sourceUrl: string | null;
    status: string;
    stage: string | null;
    resultCode: string | null;
    error: string | null;
    errorCode: string | null;
    retriable: boolean;
    retryCount: number;
  }>;
}
```

---

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
    sourceUrl: string | null;
    meetName: string;
    sessionDate: string;
    venue: string | null;
    eventCount: number;
    resultCode: string;
  }>;
  events: SwimEvent[];      // All events merged
  warnings: string[];
  failedSources: Array<{
    sequence: number;
    filename: string | null;
    errorMessage: string;
    retriable: boolean;
  }>;
}
```

---

## Processing Flow (Decoupled)

```
1. POST /api/batch/extract
   ├── Validate swimmer name
   ├── Check batch limit (max 15 PDFs)
   ├── Create processing_batches record (status: 'pending', expires_at: NOW + 30 days)
   ├── For each PDF/URL:
   │   └── Create batch_jobs record (status: 'pending', stage: 'queued')
   ├── **Spawn background worker immediately**
   └── Return { batchId, streamUrl }

2. Background worker (runs independently of SSE):
   ├── Update batch status → 'processing', started_at = NOW
   ├── Emit event: batch_started (increment last_event_id)
   │
   ├── For each job (sequential):
   │   ├── Check if batch cancelled → stop if so
   │   │
   │   ├── [If URL] Update job stage → 'downloading'
   │   ├── [If URL] Emit event: job_progress
   │   ├── [If URL] Download PDF
   │   │
   │   ├── Calculate MD5 checksum
   │   │
   │   ├── Check extraction cache (pdf_id + swimmer)
   │   │   └── If cached → emit job_completed (cached: true), continue
   │   │
   │   ├── Update job stage → 'uploading_to_ai'
   │   ├── Emit event: job_progress
   │   ├── Upload PDF to OpenAI
   │   │
   │   ├── Update job stage → 'extracting'
   │   ├── Emit event: job_progress
   │   ├── Call AI extraction
   │   │
   │   ├── Update job stage → 'caching'
   │   ├── Cache result, create result link
   │   │
   │   ├── On success:
   │   │   ├── Update job → status: 'completed', stage: 'done'
   │   │   └── Emit event: job_completed
   │   │
   │   └── On error:
   │       ├── Classify error (transient vs permanent)
   │       ├── If transient + retry_count < 3:
   │       │   ├── Increment retry_count
   │       │   ├── Wait (exponential backoff)
   │       │   └── Retry current job
   │       └── Else:
   │           ├── Update job → status: 'failed', error_code, error_message
   │           └── Emit event: job_failed (retriable: transient && retry_count < 3)
   │
   ├── Update batch counters (completed_pdfs, failed_pdfs)
   ├── Update batch status → 'completed' | 'partial' | 'failed'
   ├── Emit event: batch_completed
   └── Send email notification if registered (Phase 5)

3. GET /api/batch/:id/stream (client connects anytime):
   ├── Read Last-Event-ID header
   ├── Replay events since Last-Event-ID (reconstruct from DB state)
   └── Subscribe to new events as they occur
```

---

## Retry Logic

### Error Classification

```typescript
const TRANSIENT_ERRORS = [
  'RATE_LIMIT',        // OpenAI rate limit
  'TIMEOUT',           // Request timeout
  'NETWORK_ERROR',     // Network failure
  'AI_OVERLOADED',     // OpenAI capacity
  'SERVICE_UNAVAILABLE', // 503 errors
];

const PERMANENT_ERRORS = [
  'INVALID_PDF',       // Not a valid PDF
  'PDF_TOO_LARGE',     // Exceeds size limit
  'EXTRACTION_FAILED', // AI couldn't extract events
  'SWIMMER_NOT_FOUND', // No events for swimmer
];

const classifyError = (error: Error): { code: string; retriable: boolean } => {
  if (error.message.includes('rate limit')) return { code: 'RATE_LIMIT', retriable: true };
  if (error.message.includes('timeout')) return { code: 'TIMEOUT', retriable: true };
  // ... etc
  return { code: 'UNKNOWN', retriable: false };
};
```

### Exponential Backoff

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const getRetryDelay = (retryCount: number): number => {
  return BASE_DELAY_MS * Math.pow(2, retryCount); // 1s, 2s, 4s
};

const processJobWithRetry = async (job: BatchJob): Promise<void> => {
  while (job.retryCount <= MAX_RETRIES) {
    try {
      await processJob(job);
      return;
    } catch (error) {
      const { code, retriable } = classifyError(error);
      
      if (!retriable || job.retryCount >= MAX_RETRIES) {
        throw error; // Give up
      }
      
      job.retryCount++;
      await updateJobRetryCount(job.id, job.retryCount);
      
      const delay = getRetryDelay(job.retryCount);
      console.log(`Retrying job ${job.id} in ${delay}ms (attempt ${job.retryCount + 1})`);
      await sleep(delay);
    }
  }
};
```

---

## Implementation

### File: `packages/backend/src/routes/batch.ts`

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { startBatchProcessing, cancelBatch, retryBatch, retryJob } from '@heatsync/backend/services/batchProcessor';
import { getBatch, getBatchStatus, getBatchResults, createBatch, reconstructEventsSince, subscribeToEvents } from '@heatsync/backend/services/batchProcessor';

export const batchRoutes = new Hono();

const MAX_PDFS_PER_BATCH = parseInt(process.env.MAX_PDFS_PER_BATCH || '15');

// Create batch and start processing
batchRoutes.post('/extract', async (c) => {
  const formData = await c.req.formData();
  const swimmer = formData.get('swimmer') as string;
  const pdfFiles = formData.getAll('pdfs') as File[];
  const urlsJson = formData.get('urls') as string;
  const urls = urlsJson ? JSON.parse(urlsJson) : [];

  // Validation
  if (!swimmer?.trim()) {
    return c.json({ success: false, error: 'MISSING_SWIMMER', message: 'Swimmer name is required.' }, 400);
  }

  const totalPdfs = pdfFiles.length + urls.length;
  if (totalPdfs === 0) {
    return c.json({ success: false, error: 'NO_PDFS', message: 'At least one PDF file or URL is required.' }, 400);
  }
  if (totalPdfs > MAX_PDFS_PER_BATCH) {
    return c.json({ success: false, error: 'BATCH_TOO_LARGE', message: `Maximum ${MAX_PDFS_PER_BATCH} PDFs per batch. You submitted ${totalPdfs}.` }, 400);
  }

  // Create batch
  const batch = await createBatch(swimmer, pdfFiles, urls, c.req.header('x-forwarded-for'));

  // Start background processing (non-blocking)
  startBatchProcessing(batch.id).catch(console.error);

  return c.json({
    success: true,
    batchId: batch.id,
    totalJobs: totalPdfs,
    streamUrl: `/api/batch/${batch.id}/stream`,
  });
});

// SSE stream with reconnection support
batchRoutes.get('/:id/stream', async (c) => {
  const batchId = c.req.param('id');
  const lastEventId = parseInt(c.req.header('Last-Event-ID') || '0');

  return streamSSE(c, async (stream) => {
    const batch = await getBatch(batchId);
    if (!batch) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Batch not found' }) });
      return;
    }

    // Replay missed events
    if (lastEventId < batch.lastEventId) {
      const events = await reconstructEventsSince(batchId, lastEventId);
      for (const event of events) {
        await stream.writeSSE({ id: String(event.eventId), event: event.type, data: JSON.stringify(event) });
      }
    }

    // If batch is already done, close stream
    if (['completed', 'failed', 'partial', 'cancelled'].includes(batch.status)) {
      return;
    }

    // Subscribe to new events
    await subscribeToEvents(batchId, async (event) => {
      await stream.writeSSE({ id: String(event.eventId), event: event.type, data: JSON.stringify(event) });
    });
  });
});

// Polling fallback
batchRoutes.get('/:id', async (c) => {
  const batchId = c.req.param('id');
  const status = await getBatchStatus(batchId);
  if (!status) {
    return c.json({ success: false, error: 'Batch not found' }, 404);
  }
  return c.json({ success: true, ...status });
});

// Get results
batchRoutes.get('/:id/results', async (c) => {
  const batchId = c.req.param('id');
  const results = await getBatchResults(batchId);
  if (!results) {
    return c.json({ success: false, error: 'Batch not found' }, 404);
  }
  return c.json({ success: true, ...results });
});

// Cancel batch
batchRoutes.post('/:id/cancel', async (c) => {
  const batchId = c.req.param('id');
  const result = await cancelBatch(batchId);
  return c.json({ success: true, cancelledJobs: result.cancelledJobs });
});

// Retry all failed jobs
batchRoutes.post('/:id/retry', async (c) => {
  const batchId = c.req.param('id');
  const result = await retryBatch(batchId);
  return c.json({ success: true, retriedJobs: result.retriedJobs });
});

// Retry specific job
batchRoutes.post('/:id/jobs/:jobId/retry', async (c) => {
  const jobId = c.req.param('jobId');
  await retryJob(jobId);
  return c.json({ success: true });
});
```

### File: `packages/backend/src/services/batchProcessor.ts`

Core batch processing logic - see separate detailed spec.

### File: `packages/backend/src/services/batchWorker.ts`

Background worker that processes jobs - see separate detailed spec.

---

## Tasks

- [ ] Create `packages/backend/src/routes/batch.ts`
- [ ] Create `packages/backend/src/services/batchProcessor.ts`
- [ ] Create `packages/backend/src/services/batchWorker.ts`
- [ ] Add progress callback support to `openai.ts` `extractFromPdf()`
- [ ] Register batch routes in `packages/backend/src/index.ts`
- [ ] Add batch types to `packages/shared/src/types.ts`
- [ ] Implement event reconstruction for SSE reconnection
- [ ] Implement retry logic with exponential backoff
- [ ] Test SSE streaming with curl
- [ ] Test batch creation with multiple files
- [ ] Test SSE reconnection
- [ ] Test retry functionality
- [ ] Test cancellation

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/routes/batch.ts` | Batch API route handlers |
| `packages/backend/src/services/batchProcessor.ts` | Core batch processing logic |
| `packages/backend/src/services/batchWorker.ts` | Background worker |

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
# id: 1
# event: batch_started
# data: {"type":"batch_started","batchId":"...","totalJobs":1,"eventId":1}
#
# id: 2
# event: job_progress
# data: {"type":"job_progress","jobId":"...","stage":"downloading","eventId":2}

# Test SSE reconnection
curl -N http://localhost:3001/api/batch/{batchId}/stream \
  -H "Last-Event-ID: 2"
# Should replay events 3+ and continue

# Test cancel
curl -X POST http://localhost:3001/api/batch/{batchId}/cancel

# Test retry
curl -X POST http://localhost:3001/api/batch/{batchId}/retry
```

---

## Next Phase

→ [Phase 3: Meet URL Crawler](./phase-3.md)
