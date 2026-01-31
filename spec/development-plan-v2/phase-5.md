# Phase 5: Email Notification System

**Goal:** Send email when batch processing completes (optional, user-initiated)

**Status:** Pending

**Depends on:** Phase 2 (Batch Processing)

---

## Overview

Users can optionally provide their email to get notified when processing completes. This is useful for long-running batches where the user might close the tab.

**Key decisions:**
- Email is **optional** — never required
- Only stored temporarily (deleted after notification sent)
- Prompted **after** processing starts, not before (reduces friction)
- Works with any email provider (Resend, SendGrid, etc.)

---

## Database Changes

### Update Schema (`packages/backend/src/db/schema.ts`)

Add to `processingBatches` table:

```typescript
// Add to existing schema
notificationEmail: text('notification_email'),
notificationSentAt: integer('notification_sent_at', { mode: 'timestamp' }),
```

---

## New Endpoint

### POST `/api/batch/:id/notify`

Register email for notification.

**Request:**
```typescript
{ email: string }
```

**Response:**
```typescript
{ success: true }
// or
{ success: false, error: 'INVALID_EMAIL' | 'BATCH_NOT_FOUND' | 'ALREADY_COMPLETE' }
```

### Implementation

```typescript
// packages/backend/src/routes/batch.ts

import { z } from 'zod';

const notifySchema = z.object({
  email: z.string().email(),
});

batchRoutes.post('/:id/notify', async (c) => {
  const batchId = c.req.param('id');
  const body = await c.req.json();
  
  // Validate email
  const parsed = notifySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'INVALID_EMAIL' }, 400);
  }
  const { email } = parsed.data;

  const db = getDb();
  
  // Check batch exists
  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId))
    .limit(1);

  if (!batch) {
    return c.json({ success: false, error: 'BATCH_NOT_FOUND' }, 404);
  }

  // If batch is already complete, send immediately
  if (['completed', 'partial', 'failed'].includes(batch.status)) {
    await sendCompletionEmail(batchId, email);
    return c.json({ success: true, sentImmediately: true });
  }

  // Store email for later notification
  await db.update(processingBatches)
    .set({ notificationEmail: email })
    .where(eq(processingBatches.id, batchId));

  return c.json({ success: true });
});
```

---

## Email Service

### File: `packages/backend/src/services/email.ts`

```typescript
import { Resend } from 'resend';
import { getDb } from '@heatsync/backend/db';
import { processingBatches, batchJobs } from '@heatsync/backend/db/schema';
import { eq } from 'drizzle-orm';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || 'HeatSync <notifications@heatsync.now>';
const APP_URL = process.env.APP_URL || 'https://heatsync.now';

export interface CompletionStats {
  swimmerName: string;
  totalPdfs: number;
  completedPdfs: number;
  failedPdfs: number;
  totalEvents: number;
  meetNames: string[];
}

/**
 * Send completion email if email was registered
 */
export const sendCompletionNotification = async (batchId: string): Promise<void> => {
  const db = getDb();
  
  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId))
    .limit(1);

  if (!batch?.notificationEmail) {
    return; // No email registered
  }

  await sendCompletionEmail(batchId, batch.notificationEmail);
};

/**
 * Send completion email to specific address
 */
export const sendCompletionEmail = async (
  batchId: string, 
  email: string
): Promise<void> => {
  const db = getDb();

  // Get batch details
  const [batch] = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId))
    .limit(1);

  if (!batch) return;

  // Get job details for meet names
  const jobs = await db
    .select()
    .from(batchJobs)
    .where(eq(batchJobs.batchId, batchId));

  const meetNames = [...new Set(
    jobs
      .filter(j => j.meetName)
      .map(j => j.meetName!)
  )];

  const totalEvents = jobs.reduce((sum, j) => sum + (j.eventCount || 0), 0);

  const stats: CompletionStats = {
    swimmerName: batch.swimmerNameDisplay,
    totalPdfs: batch.totalPdfs,
    completedPdfs: batch.completedPdfs,
    failedPdfs: batch.failedPdfs,
    totalEvents,
    meetNames,
  };

  // Send email
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: getSubject(stats),
      html: getHtmlBody(batchId, stats),
      text: getTextBody(batchId, stats),
    });

    // Mark as sent and clear email
    await db.update(processingBatches)
      .set({ 
        notificationSentAt: new Date(),
        notificationEmail: null,  // Clear for privacy
      })
      .where(eq(processingBatches.id, batchId));

    console.log(`[Email] Sent completion notification for batch ${batchId}`);
  } catch (error) {
    console.error(`[Email] Failed to send for batch ${batchId}:`, error);
    // Don't throw - email failure shouldn't affect batch completion
  }
};

const getSubject = (stats: CompletionStats): string => {
  if (stats.failedPdfs === 0) {
    return `✅ HeatSync: ${stats.swimmerName}'s events are ready (${stats.totalEvents} events)`;
  } else if (stats.completedPdfs > 0) {
    return `⚠️ HeatSync: ${stats.swimmerName}'s events are ready (${stats.completedPdfs}/${stats.totalPdfs} processed)`;
  } else {
    return `❌ HeatSync: Processing failed for ${stats.swimmerName}`;
  }
};

const getHtmlBody = (batchId: string, stats: CompletionStats): string => {
  const resultsUrl = `${APP_URL}/batch/${batchId}`;
  
  let statusHtml: string;
  if (stats.failedPdfs === 0) {
    statusHtml = `
      <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 12px; margin-bottom: 16px;">
        <strong>✅ All ${stats.totalPdfs} heat sheet(s) processed successfully!</strong>
      </div>
    `;
  } else if (stats.completedPdfs > 0) {
    statusHtml = `
      <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin-bottom: 16px;">
        <strong>⚠️ ${stats.completedPdfs} of ${stats.totalPdfs} heat sheet(s) processed</strong>
        <br><span style="color: #856404;">${stats.failedPdfs} failed - you can retry these on the results page.</span>
      </div>
    `;
  } else {
    statusHtml = `
      <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 12px; margin-bottom: 16px;">
        <strong>❌ Processing failed</strong>
        <br><span style="color: #721c24;">All heat sheets failed to process. Please try again or use different files.</span>
      </div>
    `;
  }

  const meetListHtml = stats.meetNames.length > 0
    ? `<p><strong>Meets:</strong> ${stats.meetNames.join(', ')}</p>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #2563eb; margin-bottom: 24px;">🏊 HeatSync</h1>
      
      <p>Hi! Your heat sheet processing for <strong>${stats.swimmerName}</strong> is complete.</p>
      
      ${statusHtml}
      
      <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0 0 8px 0;"><strong>Summary:</strong></p>
        <ul style="margin: 0; padding-left: 20px;">
          <li>Heat sheets processed: ${stats.completedPdfs} of ${stats.totalPdfs}</li>
          <li>Total events found: ${stats.totalEvents}</li>
        </ul>
        ${meetListHtml}
      </div>
      
      <p>
        <a href="${resultsUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600;">
          View Results & Download Calendar
        </a>
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      
      <p style="color: #6b7280; font-size: 14px;">
        This is an automated message from HeatSync. Your email was used only for this notification and has not been stored.
      </p>
    </body>
    </html>
  `;
};

const getTextBody = (batchId: string, stats: CompletionStats): string => {
  const resultsUrl = `${APP_URL}/batch/${batchId}`;
  
  let statusText: string;
  if (stats.failedPdfs === 0) {
    statusText = `✅ All ${stats.totalPdfs} heat sheet(s) processed successfully!`;
  } else if (stats.completedPdfs > 0) {
    statusText = `⚠️ ${stats.completedPdfs} of ${stats.totalPdfs} heat sheet(s) processed\n${stats.failedPdfs} failed - you can retry these on the results page.`;
  } else {
    statusText = `❌ Processing failed. All heat sheets failed to process.`;
  }

  const meetText = stats.meetNames.length > 0
    ? `Meets: ${stats.meetNames.join(', ')}\n`
    : '';

  return `
HeatSync - Processing Complete

Hi! Your heat sheet processing for ${stats.swimmerName} is complete.

${statusText}

Summary:
- Heat sheets processed: ${stats.completedPdfs} of ${stats.totalPdfs}
- Total events found: ${stats.totalEvents}
${meetText}

View your results and download the calendar:
${resultsUrl}

---
This is an automated message from HeatSync. Your email was used only for this notification and has not been stored.
  `.trim();
};
```

---

## Integrate with Batch Processor

Update `packages/backend/src/services/batchProcessor.ts`:

```typescript
import { sendCompletionNotification } from './email';

// In startBatchProcessing, after batch completes:
// ...existing code...

// Send email notification if registered
await sendCompletionNotification(batchId);
```

---

## Frontend Integration

Already covered in Phase 4 stores (`showEmailPrompt`, `notificationEmail`, etc.) and `batchClient.ts` (`submitNotificationEmail`).

### EmailPrompt.svelte

```svelte
<script lang="ts">
  import { 
    showEmailPrompt, notificationEmail, emailSubmitted, emailError,
    batchStatus 
  } from '$lib/stores/batch';
  import { submitNotificationEmail } from '$lib/services/batchClient';

  let isSubmitting = false;

  const handleSubmit = async () => {
    isSubmitting = true;
    await submitNotificationEmail();
    isSubmitting = false;
  };
</script>

{#if $batchStatus === 'processing' && !$emailSubmitted}
  <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
    <h3 class="font-medium text-blue-900 mb-2">Want to be notified?</h3>
    <p class="text-sm text-blue-700 mb-3">
      Processing may take a few minutes. Enter your email and we'll notify you when it's done.
    </p>
    
    {#if $showEmailPrompt}
      <form on:submit|preventDefault={handleSubmit} class="flex gap-2">
        <input
          type="email"
          placeholder="your@email.com"
          bind:value={$notificationEmail}
          class="flex-1 px-3 py-2 border rounded-md text-sm"
          disabled={isSubmitting}
        />
        <button
          type="submit"
          class="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium disabled:opacity-50"
          disabled={isSubmitting || !$notificationEmail}
        >
          {isSubmitting ? 'Saving...' : 'Notify Me'}
        </button>
      </form>
      
      {#if $emailError}
        <p class="text-sm text-red-600 mt-2">{$emailError}</p>
      {/if}
    {:else}
      <button
        on:click={() => showEmailPrompt.set(true)}
        class="text-blue-600 text-sm font-medium hover:underline"
      >
        Yes, notify me by email →
      </button>
    {/if}
  </div>
{/if}

{#if $emailSubmitted}
  <div class="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2">
    <span class="text-green-600">✓</span>
    <span class="text-green-800 text-sm">
      We'll email you at <strong>{$notificationEmail}</strong> when processing is complete.
    </span>
  </div>
{/if}
```

---

## Environment Variables

Add to `.env`:

```bash
# Email (Resend)
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=HeatSync <notifications@heatsync.now>

# App URL (for email links)
APP_URL=https://heatsync.now
```

---

## Tasks

- [ ] Add `resend` dependency: `bun add resend`
- [ ] Update database schema with notification fields
- [ ] Generate and run migration
- [ ] Create `packages/backend/src/services/email.ts`
- [ ] Add notify endpoint to `packages/backend/src/routes/batch.ts`
- [ ] Integrate email sending into batch processor
- [ ] Create `EmailPrompt.svelte` component
- [ ] Test email flow end-to-end
- [ ] Verify email cleared after sending (privacy)
- [ ] Test with invalid email addresses
- [ ] Set up Resend domain verification

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/services/email.ts` | Email sending service |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/db/schema.ts` | Add notification fields |
| `packages/backend/src/routes/batch.ts` | Add `/notify` endpoint |
| `packages/backend/src/services/batchProcessor.ts` | Send email on completion |
| `packages/webapp/src/lib/components/v2/EmailPrompt.svelte` | Email input UI |
| `package.json` | Add `resend` dependency |
| `.env.example` | Add email env vars |

---

## Verification

```bash
# Test email registration
curl -X POST http://localhost:3001/api/batch/{batchId}/notify \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Verify email stored
sqlite3 heatsync.db "SELECT notification_email FROM processing_batches WHERE id = '{batchId}';"

# Wait for batch to complete, verify email sent and cleared
sqlite3 heatsync.db "SELECT notification_email, notification_sent_at FROM processing_batches WHERE id = '{batchId}';"
# Expected: notification_email = NULL, notification_sent_at = timestamp
```

---

## Privacy Notes

1. Email stored **only** for the duration of processing
2. Cleared immediately after notification sent
3. Not used for marketing or any other purpose
4. Consider adding rate limiting on `/notify` endpoint

---

## Next Phase

→ [Phase 6: Batch Results Page](./phase-6.md)
