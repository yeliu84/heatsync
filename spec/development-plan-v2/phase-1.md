# Phase 1: Database Schema

**Goal:** Add tables for batch processing

**Status:** Pending

---

## New Tables

### `processing_batches` - Represents a batch request

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
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days', -- For cleanup
  client_ip VARCHAR(45),
  last_event_id INTEGER DEFAULT 0,     -- For SSE reconnection
  -- Phase 5 additions:
  notification_email VARCHAR(255),
  notification_sent_at TIMESTAMPTZ
);

CREATE INDEX idx_batches_status ON processing_batches(status);
CREATE INDEX idx_batches_created ON processing_batches(created_at);
CREATE INDEX idx_batches_expires ON processing_batches(expires_at);
```

### `batch_jobs` - Individual PDF jobs within a batch

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
  error_code VARCHAR(30),              -- For retry logic: RATE_LIMIT|TIMEOUT|NETWORK_ERROR|etc
  retry_count INTEGER DEFAULT 0,
  cached BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_batch ON batch_jobs(batch_id, sequence);
CREATE INDEX idx_jobs_status ON batch_jobs(status) WHERE status IN ('pending', 'processing');
CREATE INDEX idx_jobs_checksum ON batch_jobs(file_checksum) WHERE file_checksum IS NOT NULL;
```

---

## Drizzle Schema

Add to `packages/backend/src/db/schema.ts`:

```typescript
import { pgTable, uuid, varchar, text, integer, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { extractionResults } from './schema'; // existing table

export const processingBatches = pgTable('processing_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  swimmerName: varchar('swimmer_name', { length: 255 }).notNull(),
  totalPdfs: integer('total_pdfs').notNull(),
  completedPdfs: integer('completed_pdfs').default(0).notNull(),
  failedPdfs: integer('failed_pdfs').default(0).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  clientIp: varchar('client_ip', { length: 45 }),
  lastEventId: integer('last_event_id').default(0).notNull(),
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
  sourceType: varchar('source_type', { length: 10 }).notNull(),
  sourceUrl: text('source_url'),
  filename: varchar('filename', { length: 255 }),
  fileChecksum: varchar('file_checksum', { length: 32 }),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  stage: varchar('stage', { length: 30 }),
  progressMessage: text('progress_message'),
  extractionId: uuid('extraction_id').references(() => extractionResults.id),
  resultCode: varchar('result_code', { length: 12 }),
  errorMessage: text('error_message'),
  errorCode: varchar('error_code', { length: 30 }),
  retryCount: integer('retry_count').default(0).notNull(),
  cached: boolean('cached').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  index('idx_jobs_batch').on(table.batchId, table.sequence),
  index('idx_jobs_status').on(table.status),
  index('idx_jobs_checksum').on(table.fileChecksum),
]);
```

---

## Tasks

- [ ] Add Drizzle schema definitions to `packages/backend/src/db/schema.ts`
- [ ] Generate migration: `bun drizzle-kit generate`
- [ ] Verify migration SQL in `packages/backend/drizzle/`
- [ ] Test migration: `bun run backend:dev` (auto-runs migrations)
- [ ] Verify tables created in Supabase dashboard

---

## Files to Modify

| File | Action |
|------|--------|
| `packages/backend/src/db/schema.ts` | ADD `processingBatches` and `batchJobs` tables |

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
```

---

## Next Phase

→ [Phase 2: Backend API & SSE Streaming](./phase-2.md)
