# Phase 7: Cleanup & Polish

**Goal:** Database maintenance, analytics, final integration, migration from old endpoints

**Status:** Pending

**Depends on:** All previous phases

---

## Database Cleanup

### Batch TTL

Batches and their jobs should be cleaned up after a retention period (default: 30 days).

The `expires_at` column in `processing_batches` is set on creation:
```sql
expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
```

### Cleanup Service

**File: `packages/backend/src/services/cleanup.ts`**

```typescript
import { getDb } from '@heatsync/backend/db';
import { processingBatches, batchJobs } from '@heatsync/backend/db/schema';
import { lt, sql } from 'drizzle-orm';

const BATCH_TTL_DAYS = parseInt(process.env.BATCH_TTL_DAYS || '30');

export interface CleanupResult {
  deletedBatches: number;
  deletedJobs: number;
  freedBytes?: number;
}

export const cleanupExpiredBatches = async (): Promise<CleanupResult> => {
  const db = getDb();
  
  // Get count of jobs to be deleted (for logging)
  const jobsToDelete = await db
    .select({ count: sql<number>`count(*)` })
    .from(batchJobs)
    .innerJoin(processingBatches, sql`${batchJobs.batchId} = ${processingBatches.id}`)
    .where(lt(processingBatches.expiresAt, new Date()));
  
  const jobCount = jobsToDelete[0]?.count || 0;

  // Delete batches (cascades to jobs)
  const result = await db
    .delete(processingBatches)
    .where(lt(processingBatches.expiresAt, new Date()))
    .returning({ id: processingBatches.id });
  
  console.log(`[Cleanup] Deleted ${result.length} expired batches and ~${jobCount} jobs`);
  
  return {
    deletedBatches: result.length,
    deletedJobs: jobCount,
  };
};

// Also clean up orphaned result_links (optional)
export const cleanupOrphanedLinks = async (): Promise<number> => {
  const db = getDb();
  
  // Delete result_links where the extraction_result no longer exists
  // This handles edge cases where extraction_results were manually deleted
  const result = await db.execute(sql`
    DELETE FROM result_links
    WHERE extraction_id NOT IN (SELECT id FROM extraction_results)
  `);
  
  return result.rowCount || 0;
};
```

### Cleanup Endpoint (Admin)

**Add to `packages/backend/src/routes/admin.ts`:**

```typescript
import { Hono } from 'hono';
import { cleanupExpiredBatches, cleanupOrphanedLinks } from '@heatsync/backend/services/cleanup';

export const adminRoutes = new Hono();

// Protect with admin key
adminRoutes.use('*', async (c, next) => {
  const adminKey = c.req.header('X-Admin-Key');
  const expectedKey = process.env.ADMIN_KEY;
  
  if (!expectedKey || adminKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  await next();
});

adminRoutes.post('/cleanup', async (c) => {
  const batchResult = await cleanupExpiredBatches();
  const orphanedLinks = await cleanupOrphanedLinks();
  
  return c.json({
    success: true,
    ...batchResult,
    orphanedLinksDeleted: orphanedLinks,
    timestamp: new Date().toISOString(),
  });
});

// Health check that includes DB stats
adminRoutes.get('/stats', async (c) => {
  const db = getDb();
  
  const [batches, jobs, results] = await Promise.all([
    db.execute(sql`SELECT count(*) as total, count(*) FILTER (WHERE status = 'processing') as processing FROM processing_batches`),
    db.execute(sql`SELECT count(*) as total FROM batch_jobs`),
    db.execute(sql`SELECT count(*) as total FROM extraction_results`),
  ]);
  
  return c.json({
    success: true,
    stats: {
      batches: batches.rows[0],
      jobs: jobs.rows[0],
      extractionResults: results.rows[0],
    },
    timestamp: new Date().toISOString(),
  });
});
```

---

## Scheduled Cleanup (Cloudflare Worker)

Add daily cleanup to the existing Cloudflare Worker cron:

**Update `packages/cloudflare-worker/src/index.ts`:**

```typescript
const TARGET_HOST = "heatsync.ai-builders.space";

interface Env {
  ADMIN_KEY: string;
}

export default {
  // Existing fetch handler for proxying
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, `https://${TARGET_HOST}`);

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
    });

    return fetch(modifiedRequest);
  },

  // Enhanced scheduled handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const hour = now.getUTCHours();
    
    // Keep-alive ping (every 4 minutes)
    try {
      const response = await fetch(`https://${TARGET_HOST}/api/health`, {
        method: 'HEAD',
      });
      console.log(`Keep-alive ping: ${response.status} at ${now.toISOString()}`);
    } catch (error) {
      console.error('Keep-alive ping failed:', error);
    }
    
    // Daily cleanup at 3 AM UTC
    if (hour === 3) {
      try {
        const response = await fetch(`https://${TARGET_HOST}/api/admin/cleanup`, {
          method: 'POST',
          headers: {
            'X-Admin-Key': env.ADMIN_KEY,
          },
        });
        const result = await response.json();
        console.log(`Daily cleanup completed:`, result);
      } catch (error) {
        console.error('Daily cleanup failed:', error);
      }
    }
  },
};
```

**Update `packages/cloudflare-worker/wrangler.toml`:**

```toml
name = "heatsync-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

routes = [
  { pattern = "heatsync.now", custom_domain = true }
]

[triggers]
crons = ["*/4 * * * *"]  # Every 4 minutes

[vars]
# Set ADMIN_KEY via wrangler secret
```

---

## Analytics Events

Track v2 feature usage for insights.

**Update `packages/webapp/src/lib/utils/analytics.ts`:**

```typescript
// Existing analytics helpers...

// V2 Batch Processing
export const trackBatchStarted = (pdfCount: number, source: 'meet_url' | 'manual' | 'mixed') => {
  track('batch_started', { pdfCount, source });
};

export const trackBatchCompleted = (pdfCount: number, eventCount: number, failedCount: number) => {
  track('batch_completed', { pdfCount, eventCount, failedCount });
};

// Meet URL Crawler
export const trackCrawlerUsed = (success: boolean, pdfsFound: number) => {
  track('crawler_used', { success, pdfsFound });
};

export const trackCrawlerPlatform = (platform: string) => {
  track('crawler_platform', { platform });
};

// Email Notifications
export const trackEmailRequested = () => {
  track('email_notification_requested');
};

// Retry Functionality
export const trackRetryClicked = (scope: 'all' | 'single', jobCount: number) => {
  track('retry_clicked', { scope, jobCount });
};

// Cancel Functionality
export const trackBatchCancelled = (completedJobs: number, cancelledJobs: number) => {
  track('batch_cancelled', { completedJobs, cancelledJobs });
};

// Export from batch results
export const trackBatchExport = (eventCount: number, sourceCount: number) => {
  track('batch_export', { eventCount, sourceCount });
};
```

---

## Migration: Deprecate Old Endpoints

### Phase 1: Add Deprecation Headers

**Update `packages/backend/src/routes/extract.ts`:**

```typescript
// Add deprecation warning
extractRoutes.use('*', async (c, next) => {
  c.header('X-Deprecated', 'true');
  c.header('X-Deprecated-Message', 'This endpoint is deprecated. Use /api/batch/extract instead.');
  c.header('Sunset', 'Sat, 01 Mar 2026 00:00:00 GMT'); // 30 days from now
  await next();
});
```

### Phase 2: Frontend Migration

Update `packages/webapp/src/routes/+page.svelte` to use `MultiHeatSheetForm`:

```svelte
<script lang="ts">
  import MultiHeatSheetForm from '$lib/components/v2/MultiHeatSheetForm.svelte';
</script>

<MultiHeatSheetForm />
```

The new batch form handles single PDFs the same as multiple - no special case needed.

### Phase 3: Monitor & Remove

1. Monitor `/api/extract` and `/api/extractUrl` usage in analytics
2. When usage drops to near-zero (give it 2-4 weeks), remove endpoints
3. Keep result links (`/result/:code`) working forever

---

## Integration Testing Checklist

### Happy Path
- [ ] Enter meet URL → discover PDFs → select all → enter swimmer → process → view results → export
- [ ] Upload multiple files → enter swimmer → process → view grouped results
- [ ] Mix of URLs and files → process → verify all sources in results

### Error Handling
- [ ] Invalid meet URL → clear error message
- [ ] SSRF attempt (localhost, 192.168.x.x) → blocked with message
- [ ] Batch exceeds limit → rejected with count
- [ ] AI rate limit → retries automatically
- [ ] Permanent failure → shows error, allows manual retry

### SSE Resilience
- [ ] Close browser mid-processing → reopen → processing completed
- [ ] Disconnect/reconnect SSE → events replay correctly
- [ ] Polling fallback works when SSE unavailable

### Email Notifications
- [ ] Process 5+ PDFs → wait 15s → email prompt appears
- [ ] Enter email → complete → email received with link
- [ ] Click email link → results load correctly

### Cancellation & Retry
- [ ] Cancel mid-processing → pending jobs stop
- [ ] Retry all failed → jobs reprocess
- [ ] Retry single job → only that job reprocesses

### Mobile
- [ ] Full flow works on iOS Safari
- [ ] Full flow works on Android Chrome
- [ ] Responsive design at all breakpoints

---

## Environment Variables (New in v2)

```bash
# Email notifications (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxx
NOTIFICATION_FROM_EMAIL=HeatSync <noreply@heatsync.now>

# Admin (for cleanup endpoint)
ADMIN_KEY=your_secret_admin_key_here

# Limits
MAX_PDFS_PER_BATCH=15
BATCH_TTL_DAYS=30

# Base URL for email links
BASE_URL=https://heatsync.now
```

---

## Documentation Updates

### User-Facing Help/FAQ

Add to FAQ page:

**Q: How many heat sheets can I process at once?**
A: You can process up to 15 heat sheets in a single batch. If you have more, you can run multiple batches.

**Q: What if processing takes too long?**
A: For large batches, you can enter your email and we'll notify you when results are ready. Processing continues even if you close the browser.

**Q: Can I retry if something fails?**
A: Yes! If any heat sheets fail to process (due to temporary issues), you can retry them from the results page without re-uploading.

**Q: How long are results kept?**
A: Results are stored for 30 days. After that, you'll need to process the heat sheets again.

---

## Tasks

- [ ] Create `packages/backend/src/services/cleanup.ts`
- [ ] Create `packages/backend/src/routes/admin.ts`
- [ ] Register admin routes in `packages/backend/src/index.ts`
- [ ] Update Cloudflare Worker for scheduled cleanup
- [ ] Add ADMIN_KEY secret to Cloudflare Worker
- [ ] Add analytics events to frontend
- [ ] Add deprecation headers to old endpoints
- [ ] Update main page to use MultiHeatSheetForm
- [ ] Run full integration testing
- [ ] Update FAQ page
- [ ] Deploy to staging
- [ ] Deploy to production

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/services/cleanup.ts` | Cleanup logic |
| `packages/backend/src/routes/admin.ts` | Admin endpoints |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/index.ts` | Register admin routes |
| `packages/backend/src/routes/extract.ts` | Add deprecation headers |
| `packages/backend/src/routes/extractUrl.ts` | Add deprecation headers |
| `packages/cloudflare-worker/src/index.ts` | Add cleanup cron |
| `packages/webapp/src/lib/utils/analytics.ts` | Add v2 analytics events |
| `packages/webapp/src/routes/+page.svelte` | Use new form component |
| `packages/webapp/src/routes/help/+page.svelte` | Update FAQ |

---

## Rollout Plan

1. **Staging Deploy**
   - Deploy all v2 changes to staging environment
   - Run full integration testing
   - Fix any issues

2. **Production Deploy (Soft Launch)**
   - Deploy with feature flag if available
   - OR deploy fully but monitor closely
   - Keep old endpoints working

3. **Monitor (1-2 weeks)**
   - Watch for errors in batch processing
   - Monitor analytics for v2 feature usage
   - Gather user feedback

4. **Deprecation (Week 3-4)**
   - Add deprecation headers to old endpoints
   - Update any remaining clients
   - Announce deprecation timeline

5. **Cleanup (Week 5+)**
   - Remove old endpoints
   - Remove feature flags
   - Clean up legacy code

---

## Success Metrics

- **Batch adoption**: >50% of extractions use batch API within 2 weeks
- **Crawler usage**: >30% of batches start from meet URL discovery
- **Email completion**: <5% of users who enter email abandon before completion
- **Retry success**: >80% of retried jobs succeed
- **Mobile usage**: No increase in mobile error rates

---

## Next Steps After v2

Potential v2.1 features based on user feedback:
- Multi-swimmer search (siblings)
- Google Calendar direct integration
- Saved swimmer profiles / history
- Team mode (coach uploads once)
