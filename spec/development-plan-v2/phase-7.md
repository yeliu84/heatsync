# Phase 7: Cleanup & Polish

**Goal:** Database maintenance, final integration, migration from old endpoints

**Status:** Pending

**Depends on:** All previous phases

---

## Overview

This phase handles the operational aspects of v2:
- **Cleanup**: Expired batches, orphaned temp files, stuck jobs
- **Worker Health**: Heartbeat tracking, stuck batch detection & recovery
- **Analytics**: Track v2 feature usage
- **Migration**: Deprecate old endpoints gracefully
- **Rollback Plan**: Feature flags for safe deployment

---

## Cleanup Service

Handles all cleanup tasks in one place.

### File: `packages/backend/src/services/cleanup.ts`

```typescript
import { getDb } from '@heatsync/backend/db';
import { processingBatches, batchJobs } from '@heatsync/backend/db/schema';
import { lt, eq, and, sql, isNull, or } from 'drizzle-orm';
import { cleanupBatchTempFiles, cleanupOrphanedTempFiles } from './tempFiles';

const BATCH_TTL_DAYS = parseInt(process.env.BATCH_TTL_DAYS || '30');
const STUCK_BATCH_TIMEOUT_MINUTES = 30;
const WORKER_HEARTBEAT_STALE_SECONDS = 120;

export interface CleanupResult {
  expiredBatches: number;
  stuckBatches: number;
  orphanedTempDirs: number;
  orphanedLinks: number;
}

/**
 * Run all cleanup tasks
 */
export const runFullCleanup = async (): Promise<CleanupResult> => {
  const [expiredBatches, stuckBatches, orphanedTempDirs, orphanedLinks] = await Promise.all([
    cleanupExpiredBatches(),
    recoverStuckBatches(),
    cleanupOrphanedTempFilesTask(),
    cleanupOrphanedLinks(),
  ]);
  
  console.log(`[Cleanup] Completed: ${expiredBatches} expired, ${stuckBatches} stuck recovered, ${orphanedTempDirs} temp dirs, ${orphanedLinks} orphaned links`);
  
  return { expiredBatches, stuckBatches, orphanedTempDirs, orphanedLinks };
};

/**
 * Delete batches past their TTL (default 30 days)
 */
export const cleanupExpiredBatches = async (): Promise<number> => {
  const db = getDb();
  
  // Get expired batches
  const expiredBatches = await db
    .select({ id: processingBatches.id })
    .from(processingBatches)
    .where(lt(processingBatches.expiresAt, new Date()));
  
  if (expiredBatches.length === 0) return 0;
  
  // Clean up temp files for each batch
  for (const batch of expiredBatches) {
    await cleanupBatchTempFiles(batch.id);
  }
  
  // Delete from DB (cascades to batch_jobs)
  const result = await db
    .delete(processingBatches)
    .where(lt(processingBatches.expiresAt, new Date()))
    .returning({ id: processingBatches.id });
  
  console.log(`[Cleanup] Deleted ${result.length} expired batches`);
  return result.length;
};

/**
 * Detect and recover stuck batches
 * 
 * A batch is "stuck" if:
 * - status = 'processing'
 * - processing_timeout_at has passed, OR
 * - worker_heartbeat is stale (>2 minutes old)
 */
export const recoverStuckBatches = async (): Promise<number> => {
  const db = getDb();
  const now = new Date();
  const staleHeartbeatCutoff = new Date(now.getTime() - WORKER_HEARTBEAT_STALE_SECONDS * 1000);
  
  // Find stuck batches
  const stuckBatches = await db
    .select()
    .from(processingBatches)
    .where(
      and(
        eq(processingBatches.status, 'processing'),
        or(
          // Timeout exceeded
          lt(processingBatches.processingTimeoutAt, now),
          // Heartbeat stale (worker died)
          and(
            lt(processingBatches.workerHeartbeat, staleHeartbeatCutoff),
            // Only if heartbeat was set (batch actually started)
            sql`${processingBatches.workerHeartbeat} IS NOT NULL`
          )
        )
      )
    );
  
  if (stuckBatches.length === 0) return 0;
  
  console.log(`[Cleanup] Found ${stuckBatches.length} stuck batches, attempting recovery`);
  
  for (const batch of stuckBatches) {
    await recoverBatch(batch.id);
  }
  
  return stuckBatches.length;
};

/**
 * Recover a single stuck batch
 * 
 * Strategy:
 * 1. Mark any 'processing' jobs as 'pending' (will be retried)
 * 2. Reset batch status to 'pending'
 * 3. Re-trigger processing (or wait for next worker poll)
 */
const recoverBatch = async (batchId: string): Promise<void> => {
  const db = getDb();
  
  // Reset in-progress jobs to pending
  await db
    .update(batchJobs)
    .set({
      status: 'pending',
      stage: null,
      progressMessage: 'Recovered after worker failure',
      retryCount: sql`${batchJobs.retryCount} + 1`,
    })
    .where(
      and(
        eq(batchJobs.batchId, batchId),
        or(
          eq(batchJobs.status, 'processing'),
          eq(batchJobs.status, 'downloading')
        )
      )
    );
  
  // Reset batch status
  await db
    .update(processingBatches)
    .set({
      status: 'pending',
      processingTimeoutAt: null,
      workerHeartbeat: null,
    })
    .where(eq(processingBatches.id, batchId));
  
  console.log(`[Cleanup] Recovered batch ${batchId}`);
  
  // Note: The batch worker's polling loop will pick this up automatically
  // If you want immediate recovery, emit an event here:
  // import { emitBatchEvent } from './eventBroadcast';
  // emitBatchEvent(batchId, { type: 'batch_recovered', eventId: 0 });
};

/**
 * Clean up temp directories for batches that no longer exist or are complete
 */
const cleanupOrphanedTempFilesTask = async (): Promise<number> => {
  const db = getDb();
  
  const isOrphaned = async (batchId: string): Promise<boolean> => {
    const [batch] = await db
      .select({ status: processingBatches.status })
      .from(processingBatches)
      .where(eq(processingBatches.id, batchId))
      .limit(1);
    
    // Orphaned if batch doesn't exist or is in terminal state
    if (!batch) return true;
    return ['completed', 'failed', 'partial', 'cancelled'].includes(batch.status);
  };
  
  return await cleanupOrphanedTempFiles(isOrphaned);
};

/**
 * Delete result_links where the extraction_result no longer exists
 */
export const cleanupOrphanedLinks = async (): Promise<number> => {
  const db = getDb();
  
  const result = await db.execute(sql`
    DELETE FROM result_links
    WHERE extraction_id NOT IN (SELECT id FROM extraction_results)
  `);
  
  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[Cleanup] Deleted ${count} orphaned result links`);
  }
  return count;
};

/**
 * Get cleanup statistics for admin dashboard
 */
export const getCleanupStats = async () => {
  const db = getDb();
  const now = new Date();
  const staleHeartbeatCutoff = new Date(now.getTime() - WORKER_HEARTBEAT_STALE_SECONDS * 1000);
  
  const [
    totalBatches,
    processingBatches,
    expiredBatches,
    stuckBatches,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(processingBatches),
    db.select({ count: sql<number>`count(*)` }).from(processingBatches)
      .where(eq(processingBatches.status, 'processing')),
    db.select({ count: sql<number>`count(*)` }).from(processingBatches)
      .where(lt(processingBatches.expiresAt, now)),
    db.select({ count: sql<number>`count(*)` }).from(processingBatches)
      .where(
        and(
          eq(processingBatches.status, 'processing'),
          or(
            lt(processingBatches.processingTimeoutAt, now),
            lt(processingBatches.workerHeartbeat, staleHeartbeatCutoff)
          )
        )
      ),
  ]);
  
  return {
    totalBatches: totalBatches[0]?.count || 0,
    processingBatches: processingBatches[0]?.count || 0,
    expiredBatches: expiredBatches[0]?.count || 0,
    stuckBatches: stuckBatches[0]?.count || 0,
  };
};
```

---

## Admin Routes

Protected endpoints for monitoring and maintenance.

### File: `packages/backend/src/routes/admin.ts`

```typescript
import { Hono } from 'hono';
import { getDb } from '@heatsync/backend/db';
import { processingBatches, batchJobs, extractionResults } from '@heatsync/backend/db/schema';
import { sql, eq, desc } from 'drizzle-orm';
import { runFullCleanup, getCleanupStats } from '@heatsync/backend/services/cleanup';

export const adminRoutes = new Hono();

// Protect all admin routes with API key
adminRoutes.use('*', async (c, next) => {
  const adminKey = c.req.header('X-Admin-Key');
  const expectedKey = process.env.ADMIN_KEY;
  
  if (!expectedKey) {
    console.warn('[Admin] ADMIN_KEY not configured, admin routes disabled');
    return c.json({ error: 'Admin routes not configured' }, 503);
  }
  
  if (adminKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  await next();
});

/**
 * GET /api/admin/stats
 * Get system statistics
 */
adminRoutes.get('/stats', async (c) => {
  const db = getDb();
  
  const [batchStats, jobStats, extractionStats, cleanupStats] = await Promise.all([
    // Batch stats by status
    db.execute(sql`
      SELECT status, count(*) as count 
      FROM processing_batches 
      GROUP BY status
    `),
    // Job stats by status
    db.execute(sql`
      SELECT status, count(*) as count 
      FROM batch_jobs 
      GROUP BY status
    `),
    // Extraction results count
    db.select({ count: sql<number>`count(*)` }).from(extractionResults),
    // Cleanup stats
    getCleanupStats(),
  ]);
  
  return c.json({
    success: true,
    stats: {
      batches: Object.fromEntries(
        (batchStats.rows as any[]).map(r => [r.status, parseInt(r.count)])
      ),
      jobs: Object.fromEntries(
        (jobStats.rows as any[]).map(r => [r.status, parseInt(r.count)])
      ),
      extractionResults: extractionStats[0]?.count || 0,
      cleanup: cleanupStats,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * POST /api/admin/cleanup
 * Run cleanup manually
 */
adminRoutes.post('/cleanup', async (c) => {
  const result = await runFullCleanup();
  
  return c.json({
    success: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/admin/batches
 * List recent batches with details
 */
adminRoutes.get('/batches', async (c) => {
  const db = getDb();
  const limit = parseInt(c.req.query('limit') || '20');
  
  const batches = await db
    .select()
    .from(processingBatches)
    .orderBy(desc(processingBatches.createdAt))
    .limit(limit);
  
  return c.json({
    success: true,
    batches,
  });
});

/**
 * POST /api/admin/batch/:id/recover
 * Manually recover a stuck batch
 */
adminRoutes.post('/batch/:id/recover', async (c) => {
  const batchId = c.req.param('id');
  const db = getDb();
  
  // Check batch exists
  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId))
    .limit(1);
  
  if (!batch) {
    return c.json({ error: 'Batch not found' }, 404);
  }
  
  // Reset processing jobs to pending
  const result = await db
    .update(batchJobs)
    .set({
      status: 'pending',
      stage: null,
      progressMessage: 'Manually recovered by admin',
    })
    .where(
      sql`${batchJobs.batchId} = ${batchId} AND ${batchJobs.status} IN ('processing', 'downloading')`
    )
    .returning({ id: batchJobs.id });
  
  // Reset batch status
  await db
    .update(processingBatches)
    .set({ status: 'pending' })
    .where(eq(processingBatches.id, batchId));
  
  return c.json({
    success: true,
    recoveredJobs: result.length,
  });
});

/**
 * GET /api/admin/health
 * Detailed health check
 */
adminRoutes.get('/health', async (c) => {
  const db = getDb();
  
  // Check DB connection
  let dbOk = false;
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (e) {
    console.error('[Admin] DB health check failed:', e);
  }
  
  // Check for stuck batches
  const cleanupStats = await getCleanupStats();
  
  const healthy = dbOk && cleanupStats.stuckBatches === 0;
  
  return c.json({
    healthy,
    checks: {
      database: dbOk,
      stuckBatches: cleanupStats.stuckBatches === 0,
    },
    details: {
      stuckBatchCount: cleanupStats.stuckBatches,
      processingBatchCount: cleanupStats.processingBatches,
    },
    timestamp: new Date().toISOString(),
  }, healthy ? 200 : 503);
});
```

### Register Admin Routes

Update `packages/backend/src/index.ts`:

```typescript
import { adminRoutes } from './routes/admin';

// ... existing code ...

// Register admin routes (after other routes)
app.route('/api/admin', adminRoutes);
```

---

## Scheduled Cleanup (Cloudflare Worker)

### File: `packages/cloudflare-worker/src/index.ts`

```typescript
const TARGET_HOST = 'heatsync.ai-builders.space';

interface Env {
  ADMIN_KEY: string;
}

export default {
  // Proxy requests to backend
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, `https://${TARGET_HOST}`);

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'follow',
    });

    return fetch(modifiedRequest);
  },

  // Scheduled tasks
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    
    // Keep-alive ping (runs every trigger, typically every 4 minutes)
    ctx.waitUntil(keepAlive());
    
    // Daily cleanup at 3:00 AM UTC
    if (hour === 3 && minute < 5) {
      ctx.waitUntil(runCleanup(env.ADMIN_KEY));
    }
    
    // Stuck batch recovery every 15 minutes (at :00, :15, :30, :45)
    if (minute % 15 < 5) {
      ctx.waitUntil(checkStuckBatches(env.ADMIN_KEY));
    }
  },
};

async function keepAlive(): Promise<void> {
  try {
    const response = await fetch(`https://${TARGET_HOST}/api/health`, {
      method: 'HEAD',
    });
    console.log(`Keep-alive: ${response.status}`);
  } catch (error) {
    console.error('Keep-alive failed:', error);
  }
}

async function runCleanup(adminKey: string): Promise<void> {
  try {
    const response = await fetch(`https://${TARGET_HOST}/api/admin/cleanup`, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminKey },
    });
    const result = await response.json();
    console.log('Daily cleanup:', result);
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

async function checkStuckBatches(adminKey: string): Promise<void> {
  try {
    const response = await fetch(`https://${TARGET_HOST}/api/admin/health`, {
      headers: { 'X-Admin-Key': adminKey },
    });
    const result = await response.json() as any;
    
    if (result.details?.stuckBatchCount > 0) {
      console.warn(`Found ${result.details.stuckBatchCount} stuck batches, triggering cleanup`);
      await fetch(`https://${TARGET_HOST}/api/admin/cleanup`, {
        method: 'POST',
        headers: { 'X-Admin-Key': adminKey },
      });
    }
  } catch (error) {
    console.error('Stuck batch check failed:', error);
  }
}
```

### Wrangler Config

Update `packages/cloudflare-worker/wrangler.toml`:

```toml
name = "heatsync-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

routes = [
  { pattern = "heatsync.now", custom_domain = true }
]

# Run every 4 minutes for keep-alive + stuck batch checks
[triggers]
crons = ["*/4 * * * *"]

# Secrets (set via `wrangler secret put ADMIN_KEY`)
# ADMIN_KEY = "..."
```

---

## Feature Flags

Enable gradual rollout and quick rollback.

### Implementation

Add to `packages/backend/src/config/features.ts`:

```typescript
/**
 * Feature flags for v2 rollout
 * 
 * Set via environment variables for easy toggling without redeploy
 */

export const features = {
  // Master switch for batch API
  batchApiEnabled: process.env.ENABLE_BATCH_API !== 'false',
  
  // Enable meet URL crawler
  crawlerEnabled: process.env.ENABLE_CRAWLER !== 'false',
  
  // Enable email notifications
  emailNotificationsEnabled: process.env.ENABLE_EMAIL_NOTIFICATIONS !== 'false',
  
  // Percentage of traffic to route to v2 (0-100)
  // Set to 100 for full rollout, lower for gradual rollout
  v2TrafficPercent: parseInt(process.env.V2_TRAFFIC_PERCENT || '100'),
};

/**
 * Check if request should use v2
 * For gradual rollout: hash client IP/session to get consistent routing
 */
export const shouldUseV2 = (clientId: string): boolean => {
  if (!features.batchApiEnabled) return false;
  if (features.v2TrafficPercent >= 100) return true;
  if (features.v2TrafficPercent <= 0) return false;
  
  // Simple hash for consistent routing
  const hash = clientId.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  
  return Math.abs(hash % 100) < features.v2TrafficPercent;
};

console.log('[Features]', features);
```

### Usage in Routes

```typescript
// packages/backend/src/routes/batch.ts

import { features } from '../config/features';

batchRoutes.post('/extract', async (c) => {
  if (!features.batchApiEnabled) {
    return c.json({ 
      error: 'Batch API is currently disabled',
      fallback: '/api/extract' 
    }, 503);
  }
  
  // ... rest of handler
});
```

### Frontend Feature Detection

```typescript
// packages/webapp/src/lib/config/features.ts

export const checkBatchApiAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch('/api/batch/health');
    return response.ok;
  } catch {
    return false;
  }
};
```

---

## Analytics Events

Track v2 feature usage.

### File: `packages/webapp/src/lib/utils/analytics.ts`

```typescript
// Add to existing analytics helpers

// ============================================
// V2 Batch Processing Analytics
// ============================================

/**
 * Track when user starts a batch
 */
export const trackBatchStarted = (params: {
  pdfCount: number;
  source: 'meet_url' | 'direct_urls' | 'files' | 'mixed';
  hasEmail: boolean;
}) => {
  track('batch_started', params);
};

/**
 * Track batch completion
 */
export const trackBatchCompleted = (params: {
  pdfCount: number;
  eventCount: number;
  failedCount: number;
  durationMs: number;
  cachedCount: number;
}) => {
  track('batch_completed', params);
};

/**
 * Track batch cancellation
 */
export const trackBatchCancelled = (params: {
  completedJobs: number;
  cancelledJobs: number;
}) => {
  track('batch_cancelled', params);
};

// ============================================
// Meet URL Crawler Analytics
// ============================================

/**
 * Track crawler usage
 */
export const trackCrawlerUsed = (params: {
  success: boolean;
  pdfsFound: number;
  platform: string | null;
  durationMs: number;
}) => {
  track('crawler_used', params);
};

// ============================================
// Error Tracking
// ============================================

/**
 * Track extraction errors by type
 */
export const trackExtractionError = (params: {
  errorCode: string;
  source: 'batch' | 'single';
  retryCount: number;
}) => {
  track('extraction_error', params);
};

/**
 * Track SSE connection issues
 */
export const trackSSEError = (params: {
  errorType: 'disconnect' | 'timeout' | 'reconnect_failed';
  reconnectAttempts: number;
}) => {
  track('sse_error', params);
};

// ============================================
// Email Notification Analytics
// ============================================

/**
 * Track email notification request
 */
export const trackEmailRequested = () => {
  track('email_notification_requested');
};

/**
 * Track email link click (from UTM params)
 */
export const trackEmailLinkClicked = () => {
  track('email_link_clicked');
};

// ============================================
// Retry/Recovery Analytics
// ============================================

/**
 * Track retry actions
 */
export const trackRetryClicked = (params: {
  scope: 'all_failed' | 'single_job';
  jobCount: number;
}) => {
  track('retry_clicked', params);
};

// ============================================
// Export Analytics
// ============================================

/**
 * Track batch export
 */
export const trackBatchExport = (params: {
  eventCount: number;
  sourceCount: number;
  duplicatesRemoved: number;
}) => {
  track('batch_export', params);
};
```

---

## Migration: Deprecate Old Endpoints

### Phase 1: Add Deprecation Headers

```typescript
// packages/backend/src/routes/extract.ts

import { features } from '../config/features';

// Add deprecation middleware to old endpoints
const deprecationMiddleware = async (c: Context, next: Next) => {
  // Only add headers if batch API is enabled
  if (features.batchApiEnabled) {
    c.header('X-Deprecated', 'true');
    c.header('X-Deprecated-Message', 'Use /api/batch/extract instead. See docs at https://heatsync.now/docs/api');
    c.header('Sunset', 'Sat, 01 Mar 2026 00:00:00 GMT');
  }
  await next();
};

extractRoutes.use('*', deprecationMiddleware);
```

### Phase 2: Frontend Migration

The new `MultiHeatSheetForm` handles both single and batch uploads:

```svelte
<!-- packages/webapp/src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import MultiHeatSheetForm from '$lib/components/v2/MultiHeatSheetForm.svelte';
  import LegacyForm from '$lib/components/HeatSheetForm.svelte';
  import { checkBatchApiAvailable } from '$lib/config/features';
  
  let useBatchApi = true;
  let checking = true;
  
  onMount(async () => {
    useBatchApi = await checkBatchApiAvailable();
    checking = false;
  });
</script>

{#if checking}
  <div class="animate-pulse">Loading...</div>
{:else if useBatchApi}
  <MultiHeatSheetForm />
{:else}
  <LegacyForm />
{/if}
```

### Phase 3: Monitor & Remove

Timeline:
1. **Week 1-2**: Deploy with deprecation headers, monitor usage
2. **Week 3-4**: If old endpoint usage drops to <5%, remove from frontend
3. **Week 5+**: Keep old endpoints functional but undocumented
4. **Month 3+**: Remove old endpoints entirely (if safe)

---

## Integration Testing Checklist

### Happy Path
- [ ] Meet URL → discover → select PDFs → process → view grouped results → export
- [ ] Upload 3 files → process → view results → share link works
- [ ] Mix of URLs and files → all processed correctly
- [ ] Single PDF → works like v1 (backwards compatible)

### Error Handling
- [ ] Invalid meet URL → clear error, retry possible
- [ ] SSRF attempt → blocked with message
- [ ] Batch exceeds 15 PDFs → rejected before upload
- [ ] AI rate limit → auto-retry with backoff
- [ ] Permanent failure → shows error, manual retry available
- [ ] All jobs fail → "failed" status, helpful message

### SSE & Resilience
- [ ] Close browser mid-processing → reopen → results ready
- [ ] Disconnect/reconnect SSE → missed events replayed
- [ ] Server restart mid-batch → batch recovers automatically
- [ ] Polling fallback works when SSE blocked

### Email Notifications
- [ ] Long batch → email prompt after 15s
- [ ] Enter email → completion email received
- [ ] Email link → loads results correctly
- [ ] No duplicate emails on retry/reconnect

### Cancel & Retry
- [ ] Cancel mid-processing → pending jobs stop, completed preserved
- [ ] Retry all failed → jobs reprocess
- [ ] Retry single job → only that job reprocesses
- [ ] Max retries exceeded → permanent failure

### Cleanup & Admin
- [ ] Old batches cleaned up after TTL
- [ ] Stuck batches auto-recovered
- [ ] Admin stats endpoint works
- [ ] Manual cleanup via admin API works

### Mobile
- [ ] Full flow on iOS Safari
- [ ] Full flow on Android Chrome
- [ ] Drag-drop fallback to file picker
- [ ] SSE works on mobile networks

### Rollback
- [ ] Set ENABLE_BATCH_API=false → old form shows
- [ ] Gradual rollout (V2_TRAFFIC_PERCENT=50) → consistent routing

---

## Environment Variables (Complete v2 List)

```bash
# ============================================
# Email Notifications (Resend)
# ============================================
RESEND_API_KEY=re_xxxxxxxxxxxxx
NOTIFICATION_FROM_EMAIL=HeatSync <noreply@heatsync.now>

# ============================================
# Admin
# ============================================
ADMIN_KEY=your_secret_admin_key_here

# ============================================
# Processing Limits
# ============================================
MAX_PDFS_PER_BATCH=15
BATCH_TTL_DAYS=30
CONCURRENT_JOBS_PER_BATCH=3
MAX_CONCURRENT_AI_CALLS=10

# ============================================
# Temp Files
# ============================================
TEMP_FILE_DIR=/tmp/heatsync

# ============================================
# Feature Flags
# ============================================
ENABLE_BATCH_API=true
ENABLE_CRAWLER=true
ENABLE_EMAIL_NOTIFICATIONS=true
V2_TRAFFIC_PERCENT=100

# ============================================
# URLs
# ============================================
BASE_URL=https://heatsync.now

# ============================================
# Optional: Playwright for JS-rendered pages
# ============================================
USE_PLAYWRIGHT_CRAWLER=false
```

---

## Documentation Updates

### User-Facing FAQ

Add to `/help` page:

**Q: How many heat sheets can I process at once?**
A: You can process up to 15 heat sheets in a single batch.

**Q: What if processing takes too long?**
A: For large batches, enter your email and we'll notify you when results are ready. Processing continues even if you close the browser.

**Q: What if some heat sheets fail?**
A: You'll see which ones failed and can retry them individually or all at once.

**Q: How long are results kept?**
A: Results are stored for 30 days. After that, you'll need to process the heat sheets again.

**Q: Can I share my results?**
A: Yes! Click "Copy Share Link" to share your results with coaches, teammates, or family.

**Q: Why do I see "duplicate event" warnings?**
A: If the same event appears in multiple heat sheets (like prelims and finals), we detect it and only include it once when you export to calendar.

---

## Tasks

- [ ] Create `packages/backend/src/services/cleanup.ts`
- [ ] Create `packages/backend/src/routes/admin.ts`
- [ ] Create `packages/backend/src/config/features.ts`
- [ ] Register admin routes in `packages/backend/src/index.ts`
- [ ] Update Cloudflare Worker with cleanup cron
- [ ] Set ADMIN_KEY secret in Cloudflare (`wrangler secret put ADMIN_KEY`)
- [ ] Add analytics events to frontend
- [ ] Add deprecation headers to old endpoints
- [ ] Update main page to use MultiHeatSheetForm with fallback
- [ ] Add feature flag checks to batch routes
- [ ] Run full integration testing
- [ ] Update FAQ/help page
- [ ] Deploy to staging
- [ ] Gradual rollout (start at 10%, increase to 100%)
- [ ] Monitor analytics for errors
- [ ] Full production deploy

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/services/cleanup.ts` | Cleanup logic (batches, temp files, stuck recovery) |
| `packages/backend/src/routes/admin.ts` | Admin/monitoring endpoints |
| `packages/backend/src/config/features.ts` | Feature flags |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/index.ts` | Register admin routes |
| `packages/backend/src/routes/extract.ts` | Add deprecation headers |
| `packages/backend/src/routes/extractUrl.ts` | Add deprecation headers |
| `packages/backend/src/routes/batch.ts` | Add feature flag check |
| `packages/cloudflare-worker/src/index.ts` | Add cleanup cron, stuck batch checks |
| `packages/cloudflare-worker/wrangler.toml` | Update cron schedule |
| `packages/webapp/src/lib/utils/analytics.ts` | Add v2 analytics events |
| `packages/webapp/src/routes/+page.svelte` | Use new form with fallback |
| `packages/webapp/src/routes/help/+page.svelte` | Update FAQ |
| `.env.example` | Add all new env vars |

---

## Rollout Plan

### Week 1: Staging
1. Deploy all v2 changes to staging
2. Run full integration testing
3. Fix any issues found

### Week 2: Soft Launch (10%)
1. Deploy to production with `V2_TRAFFIC_PERCENT=10`
2. Monitor analytics for errors
3. Check stuck batch recovery works
4. Verify email notifications

### Week 3: Ramp Up (50%)
1. Increase to `V2_TRAFFIC_PERCENT=50`
2. Monitor for increased load
3. Check cleanup cron running correctly

### Week 4: Full Launch (100%)
1. Set `V2_TRAFFIC_PERCENT=100`
2. Add deprecation headers to v1 endpoints
3. Update marketing/docs to feature batch upload

### Week 5+: Cleanup
1. Remove v1 form from frontend
2. Keep v1 endpoints for API consumers
3. Monitor for any remaining v1 usage

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Batch API adoption | >80% of extractions | Analytics: batch_started / total extractions |
| Crawler usage | >25% of batches | Analytics: crawler_used events |
| Error rate | <2% of jobs | Analytics: extraction_error / total jobs |
| SSE stability | <1% connection issues | Analytics: sse_error events |
| Email delivery | >95% delivered | Resend dashboard |
| Stuck batch recovery | 100% auto-recovered | Admin stats: stuck batches = 0 |
| Mobile success rate | Same as desktop | Analytics: segment by device |

---

## Rollback Procedures

### Level 1: Feature Flag (instant)
```bash
# Disable batch API, users see v1 form
ENABLE_BATCH_API=false

# Or reduce traffic
V2_TRAFFIC_PERCENT=0
```

### Level 2: Revert Deploy
```bash
# Revert to last known good version
git revert HEAD
git push
# Trigger redeploy
```

### Level 3: Database Rollback
```sql
-- If needed, mark all processing batches as failed
UPDATE processing_batches SET status = 'failed' WHERE status = 'processing';
```

---

## Post-Launch Improvements (v2.1)

After v2 is stable, consider:
- [ ] Multi-swimmer search (search for siblings at once)
- [ ] Google Calendar direct integration (CalDAV)
- [ ] Saved swimmer profiles (optional accounts)
- [ ] Team mode (coach uploads once, swimmers search)
- [ ] Push notifications (PWA)
- [ ] PDF preview in queue

---

## Summary

Phase 7 completes the v2 development plan by adding:

1. **Cleanup Service**: Automated maintenance of expired batches, stuck jobs, and orphaned files
2. **Admin API**: Monitoring and manual intervention capabilities
3. **Feature Flags**: Safe rollout with instant rollback
4. **Analytics**: Comprehensive tracking of v2 features
5. **Migration Plan**: Graceful deprecation of v1 endpoints

After Phase 7, HeatSync v2 is production-ready with:
- Multi-PDF batch processing
- Meet URL auto-discovery
- Real-time SSE progress
- Email notifications
- Grouped results with deduplication
- Robust error handling and recovery
- Gradual rollout capability
