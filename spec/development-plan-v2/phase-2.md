# Phase 2: Backend API & SSE Streaming

**Goal:** Create batch processing endpoints with real-time progress (decoupled from SSE connection)

**Status:** Pending

**Depends on:** Phase 1 (Database Schema)

---

## Key Design: Postgres-Backed Job Queue

**Problem:** If processing is tied to the SSE connection, closing the browser tab stops processing. If jobs are held in memory, server restarts lose all pending work.

**Solution:** 
1. `POST /api/batch/extract` writes files to temp storage, inserts jobs into DB
2. Background worker **polls** the `batch_jobs` table for pending work
3. `GET /api/batch/:id/stream` just observes progress (can reconnect anytime)
4. Processing continues even if no client is connected
5. **On server restart, jobs resume automatically** (they're in the DB, not memory)

**Why not Redis/pg-boss?**
- Supabase uses PgBouncer in transaction mode — `LISTEN/NOTIFY` doesn't work reliably
- We already have the `batch_jobs` table — no extra dependencies needed
- Polling with `FOR UPDATE SKIP LOCKED` is simple and battle-tested

---

## New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/batch/extract` | POST | Create batch, enqueue jobs in DB |
| `/api/batch/:id/stream` | GET | SSE stream for progress updates (reconnectable) |
| `/api/batch/:id` | GET | Polling fallback for batch status |
| `/api/batch/:id/results` | GET | Get merged results from all jobs |
| `/api/batch/:id/cancel` | POST | Cancel batch (stops pending jobs) |
| `/api/batch/:id/retry` | POST | Retry all failed jobs |
| `/api/batch/:id/jobs/:jobId/retry` | POST | Retry specific failed job |

---

## Temp File Management

### Problem
When a user uploads files via multipart form data, the `File` objects exist only during the request. If we return early, the files are gone.

### Solution
Write uploaded files to temp storage immediately, store paths in DB.

### File: `packages/backend/src/services/tempFiles.ts`

```typescript
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const TEMP_DIR = process.env.TEMP_FILE_DIR || '/tmp/heatsync';

/**
 * Ensure temp directory exists
 */
export const ensureTempDir = async (): Promise<void> => {
  await mkdir(TEMP_DIR, { recursive: true });
};

/**
 * Get batch temp directory path
 */
export const getBatchTempDir = (batchId: string): string => {
  return join(TEMP_DIR, batchId);
};

/**
 * Save uploaded file to temp storage
 */
export const saveTempFile = async (
  batchId: string,
  jobId: string,
  file: File
): Promise<string> => {
  const batchDir = getBatchTempDir(batchId);
  await mkdir(batchDir, { recursive: true });
  
  const filePath = join(batchDir, `${jobId}.pdf`);
  const buffer = await file.arrayBuffer();
  await Bun.write(filePath, buffer);
  
  console.log(`[TempFiles] Saved ${file.name} to ${filePath}`);
  return filePath;
};

/**
 * Read temp file as ArrayBuffer
 */
export const readTempFile = async (filePath: string): Promise<ArrayBuffer> => {
  const file = Bun.file(filePath);
  return await file.arrayBuffer();
};

/**
 * Delete batch temp directory
 */
export const cleanupBatchTempFiles = async (batchId: string): Promise<void> => {
  const batchDir = getBatchTempDir(batchId);
  try {
    await rm(batchDir, { recursive: true, force: true });
    console.log(`[TempFiles] Cleaned up ${batchDir}`);
  } catch (error) {
    console.error(`[TempFiles] Failed to cleanup ${batchDir}:`, error);
  }
};

/**
 * Delete single temp file
 */
export const deleteTempFile = async (filePath: string): Promise<void> => {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Ignore if file doesn't exist
  }
};

/**
 * Cleanup orphaned temp directories
 */
export const cleanupOrphanedTempFiles = async (
  isOrphaned: (batchId: string) => Promise<boolean>
): Promise<number> => {
  let cleaned = 0;
  try {
    const entries = await readdir(TEMP_DIR);
    for (const batchId of entries) {
      if (await isOrphaned(batchId)) {
        await cleanupBatchTempFiles(batchId);
        cleaned++;
      }
    }
  } catch {
    // Temp dir might not exist yet
  }
  return cleaned;
};
```

---

## Concurrency Control (DB-Based)

### Problem
Without limits, many concurrent batches could overwhelm OpenAI with requests.

### Solution
**Count active jobs in DB** before claiming new work. No in-memory state = works across restarts.

### File: `packages/backend/src/services/concurrency.ts`

```typescript
import { getDb } from '@heatsync/backend/db';
import { batchJobs } from '@heatsync/backend/db/schema';
import { eq, sql } from 'drizzle-orm';

const MAX_CONCURRENT_AI_CALLS = parseInt(process.env.MAX_CONCURRENT_AI_CALLS || '10');
const CONCURRENT_JOBS_PER_BATCH = parseInt(process.env.CONCURRENT_JOBS_PER_BATCH || '3');

/**
 * Check if we can start more AI jobs globally
 */
export const canStartGlobalJob = async (): Promise<boolean> => {
  const db = getDb();
  
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(batchJobs)
    .where(eq(batchJobs.status, 'processing'));
  
  const activeJobs = result?.count || 0;
  return activeJobs < MAX_CONCURRENT_AI_CALLS;
};

/**
 * Check if a specific batch can start more jobs
 */
export const canStartBatchJob = async (batchId: string): Promise<boolean> => {
  const db = getDb();
  
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(batchJobs)
    .where(sql`${batchJobs.batchId} = ${batchId} AND ${batchJobs.status} = 'processing'`);
  
  const activeJobs = result?.count || 0;
  return activeJobs < CONCURRENT_JOBS_PER_BATCH;
};

/**
 * Get current concurrency stats
 */
export const getConcurrencyStats = async () => {
  const db = getDb();
  
  const [global] = await db
    .select({ count: sql<number>`count(*)` })
    .from(batchJobs)
    .where(eq(batchJobs.status, 'processing'));
  
  return {
    activeGlobal: global?.count || 0,
    maxGlobal: MAX_CONCURRENT_AI_CALLS,
    maxPerBatch: CONCURRENT_JOBS_PER_BATCH,
  };
};

console.log(`[Concurrency] Global limit: ${MAX_CONCURRENT_AI_CALLS}, per-batch: ${CONCURRENT_JOBS_PER_BATCH}`);
```

---

## SSE Event Broadcasting

### Problem
Need to notify connected SSE clients when job progress updates.

### Solution
In-memory EventEmitter (single server, SSE clients only — doesn't need persistence).

### File: `packages/backend/src/services/eventBroadcast.ts`

```typescript
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export type SSEEventType = 
  | 'batch_started'
  | 'job_progress'
  | 'job_completed'
  | 'job_failed'
  | 'batch_completed'
  | 'batch_cancelled';

export interface SSEEvent {
  type: SSEEventType;
  eventId: number;
  [key: string]: unknown;
}

/**
 * Emit event for a batch
 */
export const emitBatchEvent = (batchId: string, event: SSEEvent): void => {
  emitter.emit(`batch:${batchId}`, event);
};

/**
 * Subscribe to events for a batch
 */
export const subscribeToBatch = (
  batchId: string,
  callback: (event: SSEEvent) => void
): (() => void) => {
  const handler = (event: SSEEvent) => callback(event);
  emitter.on(`batch:${batchId}`, handler);
  return () => emitter.off(`batch:${batchId}`, handler);
};
```

---

## Polling Worker

**This is the core change** — instead of spawning in-memory tasks, a worker polls the DB.

### File: `packages/backend/src/services/jobWorker.ts`

```typescript
import { getDb } from '@heatsync/backend/db';
import { processingBatches, batchJobs } from '@heatsync/backend/db/schema';
import { eq, and, sql, or } from 'drizzle-orm';
import { emitBatchEvent } from './eventBroadcast';
import { canStartGlobalJob, canStartBatchJob } from './concurrency';
import { readTempFile, deleteTempFile, cleanupBatchTempFiles } from './tempFiles';
import { extractFromPdf } from './openai';
import { sendCompletionNotification } from './email';

const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

let isRunning = false;
let pollTimeout: Timer | null = null;

/**
 * Start the polling worker
 */
export const startWorker = (): void => {
  if (isRunning) return;
  isRunning = true;
  console.log('[Worker] Started');
  schedulePoll();
};

/**
 * Stop the polling worker (for graceful shutdown)
 */
export const stopWorker = (): void => {
  isRunning = false;
  if (pollTimeout) {
    clearTimeout(pollTimeout);
    pollTimeout = null;
  }
  console.log('[Worker] Stopped');
};

/**
 * Schedule next poll
 */
const schedulePoll = (): void => {
  if (!isRunning) return;
  pollTimeout = setTimeout(pollForWork, POLL_INTERVAL_MS);
};

/**
 * Poll for pending jobs and process them
 */
const pollForWork = async (): Promise<void> => {
  try {
    // Check global concurrency
    if (!(await canStartGlobalJob())) {
      schedulePoll();
      return;
    }

    const db = getDb();

    // Claim a pending job using FOR UPDATE SKIP LOCKED
    // This is atomic — only one worker instance can claim each job
    const claimedJobs = await db.execute(sql`
      UPDATE batch_jobs
      SET 
        status = 'processing',
        started_at = NOW()
      WHERE id = (
        SELECT bj.id 
        FROM batch_jobs bj
        INNER JOIN processing_batches pb ON bj.batch_id = pb.id
        WHERE bj.status = 'pending'
          AND pb.status IN ('pending', 'processing')
          -- Per-batch concurrency: count processing jobs for this batch
          AND (
            SELECT COUNT(*) FROM batch_jobs 
            WHERE batch_id = bj.batch_id AND status = 'processing'
          ) < ${parseInt(process.env.CONCURRENT_JOBS_PER_BATCH || '3')}
        ORDER BY bj.created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    if (claimedJobs.rows.length === 0) {
      schedulePoll();
      return;
    }

    const job = claimedJobs.rows[0] as any;
    console.log(`[Worker] Claimed job ${job.id} (batch ${job.batch_id}, seq ${job.sequence})`);

    // Ensure batch is marked as processing
    await db.update(processingBatches)
      .set({ 
        status: 'processing',
        startedAt: sql`COALESCE(started_at, NOW())`,
        workerHeartbeat: new Date(),
      })
      .where(eq(processingBatches.id, job.batch_id));

    // Process the job (don't await — let it run while we poll for more)
    processJob(job).catch(err => {
      console.error(`[Worker] Error processing job ${job.id}:`, err);
    });

  } catch (error) {
    console.error('[Worker] Poll error:', error);
  }

  schedulePoll();
};

/**
 * Process a single job
 */
const processJob = async (job: any): Promise<void> => {
  const db = getDb();
  const batchId = job.batch_id;

  // Get swimmer name from batch
  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId));

  if (!batch) {
    console.error(`[Worker] Batch ${batchId} not found for job ${job.id}`);
    return;
  }

  const swimmerName = batch.swimmerNameDisplay;

  try {
    let buffer: ArrayBuffer;

    // Download or read file
    if (job.source_type === 'url') {
      await updateJobProgress(batchId, job.id, job.sequence, 'downloading', 'Downloading PDF...');
      buffer = await downloadPdf(job.source_url);
    } else {
      buffer = await readTempFile(job.temp_file_path);
    }

    // Extract with AI
    await updateJobProgress(batchId, job.id, job.sequence, 'extracting', 'Analyzing with AI...');
    
    const result = await extractFromPdf(buffer, swimmerName, {
      sourceUrl: job.source_url || undefined,
      filename: job.filename || undefined,
    });

    // Mark job completed
    await db.update(batchJobs)
      .set({
        status: 'completed',
        stage: 'done',
        completedAt: new Date(),
        extractionId: result.extractionId,
        resultCode: result.resultCode,
        meetName: result.result.meetName,
        eventCount: result.result.events.length,
        cached: result.cached,
      })
      .where(eq(batchJobs.id, job.id));

    // Update batch counter
    await db.execute(sql`
      UPDATE processing_batches 
      SET completed_pdfs = completed_pdfs + 1 
      WHERE id = ${batchId}
    `);

    // Emit completion event
    const eventId = await incrementEventId(batchId);
    emitBatchEvent(batchId, {
      type: 'job_completed',
      jobId: job.id,
      sequence: job.sequence,
      resultCode: result.resultCode || '',
      eventCount: result.result.events.length,
      meetName: result.result.meetName,
      cached: result.cached,
      eventId,
    });

    // Cleanup temp file
    if (job.temp_file_path) {
      await deleteTempFile(job.temp_file_path);
    }

    // Check if batch is complete
    await checkBatchCompletion(batchId);

  } catch (error) {
    await handleJobError(batchId, job, error);
  }
};

/**
 * Handle job error with retry logic
 */
const handleJobError = async (batchId: string, job: any, error: unknown): Promise<void> => {
  const db = getDb();
  const err = error instanceof Error ? error : new Error(String(error));
  const { code, retriable } = classifyError(err);
  
  const currentRetries = job.retry_count || 0;

  // Should retry?
  if (retriable && currentRetries < MAX_RETRIES) {
    const delay = BASE_RETRY_DELAY_MS * Math.pow(2, currentRetries);
    console.log(`[Worker] Job ${job.id} failed (${code}), retry ${currentRetries + 1}/${MAX_RETRIES} in ${delay}ms`);
    
    // Reset to pending with incremented retry count
    await db.update(batchJobs)
      .set({ 
        status: 'pending',
        stage: 'queued',
        retryCount: currentRetries + 1,
        progressMessage: `Retry ${currentRetries + 1} after ${code}`,
      })
      .where(eq(batchJobs.id, job.id));
    
    return;
  }

  // Mark as failed
  console.log(`[Worker] Job ${job.id} permanently failed: ${code}`);
  
  await db.update(batchJobs)
    .set({
      status: 'failed',
      stage: 'failed',
      completedAt: new Date(),
      errorMessage: err.message,
      errorCode: code,
    })
    .where(eq(batchJobs.id, job.id));

  // Update batch counter
  await db.execute(sql`
    UPDATE processing_batches 
    SET failed_pdfs = failed_pdfs + 1 
    WHERE id = ${batchId}
  `);

  // Emit failure event
  const eventId = await incrementEventId(batchId);
  emitBatchEvent(batchId, {
    type: 'job_failed',
    jobId: job.id,
    sequence: job.sequence,
    errorCode: code,
    errorMessage: err.message,
    retriable: false,
    retryCount: currentRetries,
    eventId,
  });

  // Check if batch is complete
  await checkBatchCompletion(batchId);
};

/**
 * Check if all jobs in a batch are done
 */
const checkBatchCompletion = async (batchId: string): Promise<void> => {
  const db = getDb();

  // Count pending/processing jobs
  const [pending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(batchJobs)
    .where(sql`
      ${batchJobs.batchId} = ${batchId} 
      AND ${batchJobs.status} IN ('pending', 'processing', 'downloading')
    `);

  if ((pending?.count || 0) > 0) {
    return; // Still work to do
  }

  // All jobs done — finalize batch
  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId));

  if (!batch || batch.status === 'completed' || batch.status === 'partial' || batch.status === 'failed') {
    return; // Already finalized
  }

  let finalStatus: 'completed' | 'partial' | 'failed';
  if (batch.failedPdfs === 0) {
    finalStatus = 'completed';
  } else if (batch.completedPdfs > 0) {
    finalStatus = 'partial';
  } else {
    finalStatus = 'failed';
  }

  await db.update(processingBatches)
    .set({
      status: finalStatus,
      completedAt: new Date(),
    })
    .where(eq(processingBatches.id, batchId));

  console.log(`[Worker] Batch ${batchId} completed with status: ${finalStatus}`);

  // Emit batch completed
  const eventId = await incrementEventId(batchId);
  emitBatchEvent(batchId, {
    type: 'batch_completed',
    status: finalStatus,
    completedJobs: batch.completedPdfs,
    failedJobs: batch.failedPdfs,
    totalEvents: await getTotalEventCount(batchId),
    eventId,
  });

  // Send email notification if registered
  await sendCompletionNotification(batchId);

  // Cleanup temp files
  await cleanupBatchTempFiles(batchId);
};

/**
 * Update job progress and emit SSE event
 */
const updateJobProgress = async (
  batchId: string,
  jobId: string,
  sequence: number,
  stage: string,
  message: string
): Promise<void> => {
  const db = getDb();
  
  await db.update(batchJobs)
    .set({ stage, progressMessage: message })
    .where(eq(batchJobs.id, jobId));

  const eventId = await incrementEventId(batchId);
  emitBatchEvent(batchId, {
    type: 'job_progress',
    jobId,
    sequence,
    stage,
    message,
    eventId,
  });
};

/**
 * Increment and return the next event ID for a batch
 */
const incrementEventId = async (batchId: string): Promise<number> => {
  const db = getDb();
  const [result] = await db.execute(sql`
    UPDATE processing_batches 
    SET last_event_id = last_event_id + 1 
    WHERE id = ${batchId}
    RETURNING last_event_id
  `);
  return (result as any)?.last_event_id || 0;
};

/**
 * Get total event count for a batch
 */
const getTotalEventCount = async (batchId: string): Promise<number> => {
  const db = getDb();
  const [result] = await db
    .select({ total: sql<number>`COALESCE(SUM(event_count), 0)` })
    .from(batchJobs)
    .where(eq(batchJobs.batchId, batchId));
  return result?.total || 0;
};

/**
 * Download PDF from URL
 */
const downloadPdf = async (url: string): Promise<ArrayBuffer> => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'HeatSync/2.0' },
    signal: AbortSignal.timeout(30_000),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  
  return await response.arrayBuffer();
};

/**
 * Classify error for retry logic
 */
const classifyError = (error: Error): { code: string; retriable: boolean } => {
  const msg = error.message.toLowerCase();
  
  if (msg.includes('rate limit') || msg.includes('429')) {
    return { code: 'RATE_LIMIT', retriable: true };
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { code: 'TIMEOUT', retriable: true };
  }
  if (msg.includes('network') || msg.includes('econnrefused')) {
    return { code: 'NETWORK_ERROR', retriable: true };
  }
  if (msg.includes('503') || msg.includes('service unavailable')) {
    return { code: 'SERVICE_UNAVAILABLE', retriable: true };
  }
  if (msg.includes('invalid pdf') || msg.includes('not a pdf')) {
    return { code: 'INVALID_PDF', retriable: false };
  }
  
  return { code: 'UNKNOWN', retriable: false };
};
```

---

## API Implementation

### POST `/api/batch/extract`

Create a new batch. Jobs are inserted into DB — the worker picks them up automatically.

```typescript
// packages/backend/src/routes/batch.ts

import { Hono } from 'hono';
import { getDb } from '@heatsync/backend/db';
import { processingBatches, batchJobs, createBatchRecord } from '@heatsync/backend/db/schema';
import { eq } from 'drizzle-orm';
import { saveTempFile } from '@heatsync/backend/services/tempFiles';

export const batchRoutes = new Hono();

const MAX_PDFS_PER_BATCH = parseInt(process.env.MAX_PDFS_PER_BATCH || '15');

batchRoutes.post('/extract', async (c) => {
  const formData = await c.req.formData();
  const swimmer = formData.get('swimmer') as string;
  const pdfFiles = formData.getAll('pdfs') as File[];
  const urlsJson = formData.get('urls') as string;
  const urls: string[] = urlsJson ? JSON.parse(urlsJson) : [];

  // Validation
  if (!swimmer?.trim()) {
    return c.json({ success: false, error: 'MISSING_SWIMMER', message: 'Swimmer name is required.' }, 400);
  }

  const totalPdfs = pdfFiles.length + urls.length;
  if (totalPdfs === 0) {
    return c.json({ success: false, error: 'NO_PDFS', message: 'At least one PDF file or URL is required.' }, 400);
  }
  if (totalPdfs > MAX_PDFS_PER_BATCH) {
    return c.json({ 
      success: false, 
      error: 'BATCH_TOO_LARGE', 
      message: `Maximum ${MAX_PDFS_PER_BATCH} PDFs per batch.` 
    }, 400);
  }

  // Dedupe URLs
  const uniqueUrls = [...new Set(urls)];

  const db = getDb();

  // Create batch record
  const batchRecord = createBatchRecord(swimmer, pdfFiles.length + uniqueUrls.length, {
    clientIp: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
    referrer: c.req.header('referer'),
  });

  const [batch] = await db.insert(processingBatches).values(batchRecord).returning();
  console.log(`[Batch] Created batch ${batch.id} for "${swimmer}" with ${totalPdfs} PDF(s)`);

  // Insert jobs
  let sequence = 0;

  // File uploads
  for (const file of pdfFiles) {
    sequence++;
    const [job] = await db.insert(batchJobs).values({
      batchId: batch.id,
      sequence,
      sourceType: 'file',
      filename: file.name,
      status: 'pending',
      stage: 'queued',
    }).returning();

    // Save to temp storage
    const tempPath = await saveTempFile(batch.id, job.id, file);
    await db.update(batchJobs)
      .set({ tempFilePath: tempPath })
      .where(eq(batchJobs.id, job.id));
  }

  // URL jobs
  for (const url of uniqueUrls) {
    sequence++;
    await db.insert(batchJobs).values({
      batchId: batch.id,
      sequence,
      sourceType: 'url',
      sourceUrl: url,
      filename: url.split('/').pop() || 'heatsheet.pdf',
      status: 'pending',
      stage: 'queued',
    });
  }

  // Jobs are now in DB — worker will pick them up automatically!
  // No need to call startBatchProcessing()

  const estMin = totalPdfs * 15;
  const estMax = totalPdfs * 30;

  return c.json({
    success: true,
    batchId: batch.id,
    totalJobs: totalPdfs,
    streamUrl: `/api/batch/${batch.id}/stream`,
    estimatedTime: `${estMin}s - ${estMax}s`,
  });
});
```

### GET `/api/batch/:id/stream`

SSE stream for real-time progress. Supports reconnection via `Last-Event-ID`.

```typescript
import { streamSSE } from 'hono/streaming';
import { subscribeToBatch } from '@heatsync/backend/services/eventBroadcast';

batchRoutes.get('/:id/stream', async (c) => {
  const batchId = c.req.param('id');
  const lastEventId = parseInt(c.req.header('Last-Event-ID') || '0');

  return streamSSE(c, async (stream) => {
    const db = getDb();
    
    // Get current batch state
    const [batch] = await db
      .select()
      .from(processingBatches)
      .where(eq(processingBatches.id, batchId))
      .limit(1);
    
    if (!batch) {
      await stream.writeSSE({ 
        event: 'error', 
        data: JSON.stringify({ error: 'Batch not found' }) 
      });
      return;
    }

    // Send state sync for reconnecting clients
    if (lastEventId > 0 || lastEventId < batch.lastEventId) {
      const jobs = await db
        .select()
        .from(batchJobs)
        .where(eq(batchJobs.batchId, batchId))
        .orderBy(batchJobs.sequence);

      await stream.writeSSE({
        id: String(batch.lastEventId),
        event: 'state_sync',
        data: JSON.stringify({
          type: 'state_sync',
          batch: {
            id: batch.id,
            status: batch.status,
            swimmerName: batch.swimmerNameDisplay,
            totalPdfs: batch.totalPdfs,
            completedPdfs: batch.completedPdfs,
            failedPdfs: batch.failedPdfs,
          },
          jobs: jobs.map(j => ({
            id: j.id,
            sequence: j.sequence,
            filename: j.filename,
            status: j.status,
            stage: j.stage,
            resultCode: j.resultCode,
            meetName: j.meetName,
            eventCount: j.eventCount,
            errorMessage: j.errorMessage,
            cached: j.cached,
          })),
          eventId: batch.lastEventId,
        }),
      });
    }

    // If batch is already done, close stream
    if (['completed', 'failed', 'partial', 'cancelled'].includes(batch.status)) {
      return;
    }

    // Subscribe to new events
    const unsubscribe = subscribeToBatch(batchId, async (event) => {
      try {
        await stream.writeSSE({
          id: String(event.eventId),
          event: event.type,
          data: JSON.stringify(event),
        });

        if (['batch_completed', 'batch_cancelled'].includes(event.type)) {
          unsubscribe();
        }
      } catch {
        unsubscribe();
      }
    });

    // Keep alive
    const keepAlive = setInterval(async () => {
      try {
        await stream.writeSSE({ comment: 'keepalive' });
      } catch {
        clearInterval(keepAlive);
        unsubscribe();
      }
    }, 30000);

    stream.onAbort(() => {
      clearInterval(keepAlive);
      unsubscribe();
    });

    await new Promise(() => {});
  });
});
```

### Other Endpoints

```typescript
// GET /api/batch/:id - Polling fallback
batchRoutes.get('/:id', async (c) => {
  const batchId = c.req.param('id');
  const db = getDb();

  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId));

  if (!batch) {
    return c.json({ success: false, error: 'Batch not found' }, 404);
  }

  const jobs = await db
    .select()
    .from(batchJobs)
    .where(eq(batchJobs.batchId, batchId))
    .orderBy(batchJobs.sequence);

  return c.json({
    success: true,
    batch: {
      id: batch.id,
      status: batch.status,
      swimmerName: batch.swimmerNameDisplay,
      totalPdfs: batch.totalPdfs,
      completedPdfs: batch.completedPdfs,
      failedPdfs: batch.failedPdfs,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
    },
    jobs: jobs.map(j => ({
      id: j.id,
      sequence: j.sequence,
      filename: j.filename,
      status: j.status,
      stage: j.stage,
      resultCode: j.resultCode,
      meetName: j.meetName,
      eventCount: j.eventCount,
      errorMessage: j.errorMessage,
      cached: j.cached,
    })),
  });
});

// POST /api/batch/:id/cancel
batchRoutes.post('/:id/cancel', async (c) => {
  const batchId = c.req.param('id');
  const db = getDb();

  // Mark pending jobs as cancelled
  await db.update(batchJobs)
    .set({ status: 'cancelled' })
    .where(sql`${batchJobs.batchId} = ${batchId} AND ${batchJobs.status} = 'pending'`);

  // Mark batch as cancelled
  await db.update(processingBatches)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(processingBatches.id, batchId));

  const eventId = await incrementEventId(batchId);
  emitBatchEvent(batchId, { type: 'batch_cancelled', eventId });

  return c.json({ success: true });
});

// POST /api/batch/:id/retry - Retry all failed jobs
batchRoutes.post('/:id/retry', async (c) => {
  const batchId = c.req.param('id');
  const db = getDb();

  const result = await db.update(batchJobs)
    .set({ 
      status: 'pending', 
      stage: 'queued',
      errorMessage: null,
      errorCode: null,
    })
    .where(sql`${batchJobs.batchId} = ${batchId} AND ${batchJobs.status} = 'failed'`)
    .returning({ id: batchJobs.id });

  // Reset batch counters
  await db.update(processingBatches)
    .set({ 
      status: 'processing',
      failedPdfs: 0,
      completedAt: null,
    })
    .where(eq(processingBatches.id, batchId));

  return c.json({ success: true, retriedJobs: result.length });
});
```

---

## Server Startup

```typescript
// packages/backend/src/index.ts

import { ensureTempDir } from '@heatsync/backend/services/tempFiles';
import { startWorker, stopWorker } from '@heatsync/backend/services/jobWorker';
import { batchRoutes } from '@heatsync/backend/routes/batch';

const init = async () => {
  await ensureTempDir();
  await runMigrations();
  
  // Start the polling worker
  startWorker();
};

init().catch(console.error);

// Register routes
app.route('/api/batch', batchRoutes);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  stopWorker();
  process.exit(0);
});
```

---

## Tasks

- [ ] Create `packages/backend/src/services/tempFiles.ts`
- [ ] Create `packages/backend/src/services/concurrency.ts`
- [ ] Create `packages/backend/src/services/eventBroadcast.ts`
- [ ] Create `packages/backend/src/services/jobWorker.ts` (new polling worker)
- [ ] Create `packages/backend/src/routes/batch.ts`
- [ ] Update `packages/backend/src/index.ts` — start worker, register routes
- [ ] Add batch types to `packages/shared/src/types.ts`
- [ ] Test: Create batch → verify jobs in DB
- [ ] Test: Worker claims and processes jobs
- [ ] Test: Restart server → pending jobs resume
- [ ] Test: SSE reconnection with state sync
- [ ] Test: Concurrent batches respect global limit
- [ ] Test: Cancel stops pending jobs

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/services/tempFiles.ts` | Temp file management |
| `packages/backend/src/services/concurrency.ts` | DB-based concurrency checks |
| `packages/backend/src/services/eventBroadcast.ts` | SSE event broadcasting |
| `packages/backend/src/services/jobWorker.ts` | **Postgres polling worker** |
| `packages/backend/src/routes/batch.ts` | Batch API routes |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/index.ts` | Start worker, register routes, graceful shutdown |
| `packages/backend/src/services/openai.ts` | Return extractionId for linking |
| `packages/shared/src/types.ts` | Add batch types |

---

## Design Notes

### Why Polling Instead of Event-Driven?

Supabase's connection pooler (PgBouncer) runs in transaction mode, which breaks `LISTEN/NOTIFY`. Polling every 2 seconds is:
- Simple and reliable
- Works with any Postgres setup
- Adds minimal load (one small query every 2s)

### Why FOR UPDATE SKIP LOCKED?

This pattern atomically claims a job:
- `FOR UPDATE` locks the row
- `SKIP LOCKED` skips rows locked by other workers
- Combined: each job is claimed by exactly one worker

Even with a single server, this ensures correctness and makes the system ready for future horizontal scaling if needed.

### What Survives Restarts?

| Component | Survives? | Notes |
|-----------|-----------|-------|
| Pending jobs | ✅ Yes | In DB, worker picks up on restart |
| Processing jobs | ✅ Yes | Phase 7 cleanup marks stale jobs as pending |
| SSE connections | ❌ No | Clients reconnect, get state_sync |
| Event history | ✅ Yes | `last_event_id` in DB enables replay |

---

## Verification

```bash
# 1. Create a batch
curl -X POST http://localhost:3001/api/batch/extract \
  -F "swimmer=John Smith" \
  -F "pdfs=@./test.pdf"

# 2. Check jobs in DB
psql $DATABASE_URL -c "SELECT id, status, stage FROM batch_jobs"

# 3. Watch worker logs — should claim and process
# [Worker] Claimed job xxx (batch yyy, seq 1)

# 4. Kill server mid-processing
kill -9 $PID

# 5. Restart server, check job resumes
bun run dev
# [Worker] Started
# [Worker] Claimed job xxx ...

# 6. Verify completion
curl http://localhost:3001/api/batch/{batchId}
```

---

## Next Phase

→ [Phase 3: Meet URL Crawler](./phase-3.md)
