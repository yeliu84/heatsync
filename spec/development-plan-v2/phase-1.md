# Phase 1: Database Schema

**Goal:** Add tables for batch processing

**Status:** Pending

---

## New Tables

### `processing_batches` - Represents a batch request

```sql
CREATE TABLE processing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Swimmer name (consistent with extraction_results pattern)
  swimmer_name_normalized VARCHAR(255) NOT NULL,  -- lowercase for matching
  swimmer_name_display VARCHAR(255) NOT NULL,     -- original case for display
  -- Batch progress
  total_pdfs INTEGER NOT NULL,
  completed_pdfs INTEGER DEFAULT 0,
  failed_pdfs INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending', -- pending|processing|completed|failed|partial|cancelled
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days', -- For cleanup
  -- Worker health tracking
  processing_timeout_at TIMESTAMPTZ,   -- Set to NOW + 30min when processing starts
  worker_heartbeat TIMESTAMPTZ,        -- Updated every 30s during processing
  -- Request metadata (for abuse detection)
  client_ip VARCHAR(45),
  user_agent TEXT,
  referrer TEXT,
  -- SSE reconnection
  last_event_id INTEGER DEFAULT 0,
  -- Email notification (Phase 5)
  notification_email VARCHAR(255),
  notification_sent_at TIMESTAMPTZ
);

CREATE INDEX idx_batches_status ON processing_batches(status);
CREATE INDEX idx_batches_created ON processing_batches(created_at);
CREATE INDEX idx_batches_expires ON processing_batches(expires_at);
CREATE INDEX idx_batches_processing ON processing_batches(status, worker_heartbeat) 
  WHERE status = 'processing';
```

### `batch_jobs` - Individual PDF jobs within a batch

```sql
CREATE TABLE batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES processing_batches(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  -- Source info
  source_type VARCHAR(10) NOT NULL, -- 'file' | 'url'
  source_url TEXT,
  filename VARCHAR(255),
  temp_file_path TEXT,              -- Path to temp file for uploaded files
  file_checksum VARCHAR(32),        -- MD5, set after download/read
  -- Status tracking
  status VARCHAR(20) DEFAULT 'pending', -- pending|downloading|processing|completed|failed|cancelled
  stage VARCHAR(30),                   -- queued|downloading|uploading_to_ai|extracting|caching|done
  progress_message TEXT,
  -- Results
  extraction_id UUID REFERENCES extraction_results(id),
  result_code VARCHAR(12),             -- Short code for result link
  meet_name VARCHAR(500),              -- Cached for display without loading full result
  event_count INTEGER,                 -- Cached for display
  -- Error handling
  error_message TEXT,
  error_code VARCHAR(30),              -- RATE_LIMIT|TIMEOUT|NETWORK_ERROR|INVALID_PDF|etc
  retry_count INTEGER DEFAULT 0,
  -- Flags
  cached BOOLEAN DEFAULT false,        -- True if result came from cache
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_batch ON batch_jobs(batch_id, sequence);
CREATE INDEX idx_jobs_status ON batch_jobs(batch_id, status);
CREATE INDEX idx_jobs_pending ON batch_jobs(status) WHERE status = 'pending';
CREATE INDEX idx_jobs_checksum ON batch_jobs(file_checksum) WHERE file_checksum IS NOT NULL;
```

---

## Drizzle Schema

Add to `packages/backend/src/db/schema.ts`:

```typescript
import { pgTable, uuid, varchar, text, integer, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { extractionResults } from './schema'; // existing table
import { sql } from 'drizzle-orm';
import { normalizeSwimmerName } from '@heatsync/shared/utils/name';

export const processingBatches = pgTable('processing_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Swimmer name (normalized + display, consistent with extraction_results)
  swimmerNameNormalized: varchar('swimmer_name_normalized', { length: 255 }).notNull(),
  swimmerNameDisplay: varchar('swimmer_name_display', { length: 255 }).notNull(),
  // Batch progress
  totalPdfs: integer('total_pdfs').notNull(),
  completedPdfs: integer('completed_pdfs').default(0).notNull(),
  failedPdfs: integer('failed_pdfs').default(0).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // Worker health
  processingTimeoutAt: timestamp('processing_timeout_at', { withTimezone: true }),
  workerHeartbeat: timestamp('worker_heartbeat', { withTimezone: true }),
  // Request metadata
  clientIp: varchar('client_ip', { length: 45 }),
  userAgent: text('user_agent'),
  referrer: text('referrer'),
  // SSE
  lastEventId: integer('last_event_id').default(0).notNull(),
  // Email notification
  notificationEmail: varchar('notification_email', { length: 255 }),
  notificationSentAt: timestamp('notification_sent_at', { withTimezone: true }),
}, (table) => [
  index('idx_batches_status').on(table.status),
  index('idx_batches_created').on(table.createdAt),
  index('idx_batches_expires').on(table.expiresAt),
]);

export const batchJobs = pgTable('batch_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  batchId: uuid('batch_id').notNull().references(() => processingBatches.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  // Source
  sourceType: varchar('source_type', { length: 10 }).notNull(),
  sourceUrl: text('source_url'),
  filename: varchar('filename', { length: 255 }),
  tempFilePath: text('temp_file_path'),
  fileChecksum: varchar('file_checksum', { length: 32 }),
  // Status
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  stage: varchar('stage', { length: 30 }),
  progressMessage: text('progress_message'),
  // Results
  extractionId: uuid('extraction_id').references(() => extractionResults.id),
  resultCode: varchar('result_code', { length: 12 }),
  meetName: varchar('meet_name', { length: 500 }),
  eventCount: integer('event_count'),
  // Errors
  errorMessage: text('error_message'),
  errorCode: varchar('error_code', { length: 30 }),
  retryCount: integer('retry_count').default(0).notNull(),
  // Flags
  cached: boolean('cached').default(false),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('idx_jobs_batch').on(table.batchId, table.sequence),
  index('idx_jobs_status').on(table.batchId, table.status),
  index('idx_jobs_checksum').on(table.fileChecksum),
]);

// Type exports
export type ProcessingBatch = typeof processingBatches.$inferSelect;
export type NewProcessingBatch = typeof processingBatches.$inferInsert;
export type BatchJob = typeof batchJobs.$inferSelect;
export type NewBatchJob = typeof batchJobs.$inferInsert;
```

---

## Helper Functions

Add to `packages/backend/src/db/schema.ts` or a new file:

```typescript
/**
 * Create a new batch with proper name normalization
 */
export const createBatchRecord = (swimmerName: string, totalPdfs: number, metadata: {
  clientIp?: string;
  userAgent?: string;
  referrer?: string;
}): NewProcessingBatch => {
  const { firstLast } = normalizeSwimmerName(swimmerName);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  return {
    swimmerNameNormalized: firstLast.toLowerCase(),
    swimmerNameDisplay: firstLast,
    totalPdfs,
    expiresAt,
    clientIp: metadata.clientIp,
    userAgent: metadata.userAgent,
    referrer: metadata.referrer,
  };
};
```

---

## Tasks

- [ ] Add Drizzle schema definitions to `packages/backend/src/db/schema.ts`
- [ ] Add helper functions for batch creation
- [ ] Generate migration: `bun drizzle-kit generate`
- [ ] Review generated SQL in `packages/backend/drizzle/`
- [ ] Test migration: `bun run backend:dev` (auto-runs migrations)
- [ ] Verify tables created in Supabase dashboard
- [ ] Verify indexes created

---

## Files to Modify

| File | Action |
|------|--------|
| `packages/backend/src/db/schema.ts` | ADD `processingBatches` and `batchJobs` tables + types |

---

## Verification

```bash
# After starting backend, verify tables exist
psql $SUPABASE_DATABASE_URL -c "\dt"

# Should show:
# - processing_batches
# - batch_jobs
# - pdf_files (existing)
# - extraction_results (existing)
# - result_links (existing)

# Verify indexes
psql $SUPABASE_DATABASE_URL -c "\di"

# Verify columns match schema
psql $SUPABASE_DATABASE_URL -c "\d processing_batches"
psql $SUPABASE_DATABASE_URL -c "\d batch_jobs"
```

---

## Design Notes

### Why separate `swimmer_name_normalized` and `swimmer_name_display`?

This matches the pattern used in `extraction_results`:
- `normalized`: Used for cache lookups and matching (case-insensitive)
- `display`: Preserves original capitalization for UI

### Why `worker_heartbeat` and `processing_timeout_at`?

These enable stuck batch detection:
1. When processing starts: set `processing_timeout_at = NOW + 30 minutes`
2. Worker updates `worker_heartbeat` every 30 seconds
3. Cleanup cron finds batches where:
   - `status = 'processing'`
   - `worker_heartbeat < NOW - 60 seconds` (no recent heartbeat)
   - `processing_timeout_at < NOW` (past timeout)
4. These batches can be marked failed or retried

### Why `meet_name` and `event_count` on jobs?

Caching these on the job avoids loading full extraction results just to display batch summary. The grouped results page can show:
- "Session 1 - Winter Championships (12 events)" 

Without fetching all 12 events from `extraction_results`.

---

## Next Phase

→ [Phase 2: Backend API & SSE Streaming](./phase-2.md)
