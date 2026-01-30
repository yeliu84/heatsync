# Phase 5: Email Notification System

**Goal:** Notify users when long-running batches complete

**Status:** Pending

**Depends on:** Phase 2 (Backend API), Phase 4 (Frontend UI)

---

## Overview

For batches that take longer than expected, users can optionally enter their email to receive a notification when processing completes.

**UX Flow:**
1. User starts batch processing
2. After **first job completes OR 15 seconds elapsed** (whichever is first), email prompt appears
3. User can enter email or dismiss
4. On submit, email is stored with batch in DB
5. When batch completes, send email with results link

**Why this timing?**
- 4 seconds felt abrupt (user just started watching)
- 15 seconds gives user time to see progress
- First job completion is a natural checkpoint
- If batch is fast, prompt may never show (good!)

---

## Email Provider: Resend

**Why Resend:**
- Simple API, minimal setup
- 100 free emails/day (sufficient for MVP)
- Good developer experience
- No complex domain verification required for testing

**Setup:**
1. Create account at https://resend.com
2. Get API key
3. Add to environment variables

---

## Backend Implementation

### Database Addition

Add to `processing_batches` table (already included in Phase 1 schema):
```sql
notification_email VARCHAR(255),
notification_sent_at TIMESTAMPTZ
```

### New Endpoint

**POST `/api/batch/:id/notify`**

Register email for notification.

```typescript
// Request
{ email: string }

// Response
{ success: true }
```

### Email Service

**File: `packages/backend/src/services/email.ts`**

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendNotificationParams {
  to: string;
  swimmerName: string;
  batchId: string;
  eventCount: number;
  meetNames: string[];
}

export const sendCompletionNotification = async ({
  to,
  swimmerName,
  batchId,
  eventCount,
  meetNames,
}: SendNotificationParams): Promise<void> => {
  const resultsUrl = `${process.env.BASE_URL || 'https://heatsync.now'}/batch/${batchId}`;

  await resend.emails.send({
    from: process.env.NOTIFICATION_FROM_EMAIL || 'HeatSync <noreply@heatsync.now>',
    to,
    subject: `HeatSync: Found ${eventCount} events for ${swimmerName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #2563eb;">Your Heat Sheet Results Are Ready!</h1>

        <p>We found <strong>${eventCount} events</strong> for <strong>${swimmerName}</strong> across ${meetNames.length} heat sheet${meetNames.length > 1 ? 's' : ''}:</p>

        <ul>
          ${meetNames.map(name => `<li>${name}</li>`).join('')}
        </ul>

        <p>
          <a href="${resultsUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">
            View Results & Export to Calendar
          </a>
        </p>

        <p style="color: #666; font-size: 14px;">
          This link will remain active for 30 days.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />

        <p style="color: #999; font-size: 12px;">
          You received this email because you requested a notification from HeatSync.
          <br />
          <a href="https://heatsync.now" style="color: #2563eb;">heatsync.now</a> - Find your swim events, sync to calendar.
        </p>
      </div>
    `,
  });
};
```

### Notify Endpoint

**File: `packages/backend/src/routes/batch.ts`** (addition)

```typescript
// Register email for notification
batchRoutes.post('/:id/notify', async (c) => {
  const batchId = c.req.param('id');
  const { email } = await c.req.json();

  // Validate email format
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ success: false, error: 'Invalid email format' }, 400);
  }

  // Validate batch exists
  const db = getDb();
  const batch = await db
    .select()
    .from(processingBatches)
    .where(eq(processingBatches.id, batchId))
    .limit(1);

  if (!batch.length) {
    return c.json({ success: false, error: 'Batch not found' }, 404);
  }

  // Store email
  await db
    .update(processingBatches)
    .set({ notificationEmail: email })
    .where(eq(processingBatches.id, batchId));

  return c.json({ success: true });
});
```

### Send Notification on Completion

Update `batchProcessor.ts` to send email when batch completes:

```typescript
// In processBatch(), after all jobs complete:
if (batch.notificationEmail && !batch.notificationSentAt) {
  try {
    const completedJobs = await getCompletedJobs(batchId);
    const meetNames = completedJobs.map(j => j.result?.meetName).filter(Boolean);
    const eventCount = completedJobs.reduce((sum, j) => sum + (j.result?.events.length || 0), 0);

    await sendCompletionNotification({
      to: batch.notificationEmail,
      swimmerName: batch.swimmerName,
      batchId,
      eventCount,
      meetNames,
    });

    // Mark as sent
    await db
      .update(processingBatches)
      .set({ notificationSentAt: new Date() })
      .where(eq(processingBatches.id, batchId));
  } catch (error) {
    console.error('Failed to send notification email:', error);
    // Don't fail the batch if email fails
  }
}
```

---

## Frontend Implementation

### Email Prompt Timing Logic

**In `ProgressPanel.svelte`:**

```typescript
let showPrompt = false;
let processingStartTime = Date.now();

$effect(() => {
  if ($batchStatus === 'processing' && !showPrompt && !$emailSubmitted) {
    // Show after 15 seconds
    const timer = setTimeout(() => {
      showPrompt = true;
    }, 15000);
    return () => clearTimeout(timer);
  }
});

// Also show when first job completes (if > 5 seconds elapsed)
$effect(() => {
  const completed = $queueItems.filter(i => i.status === 'completed').length;
  const elapsed = Date.now() - processingStartTime;
  if (completed === 1 && elapsed > 5000 && !showPrompt) {
    showPrompt = true;
  }
});
```

### EmailPrompt Component

**File: `packages/webapp/src/lib/components/v2/EmailPrompt.svelte`**

```svelte
<script lang="ts">
  import { batchId, notificationEmail, emailSubmitted, showEmailPrompt } from '$lib/stores/batch';
  import { get } from 'svelte/store';

  let loading = false;
  let error = '';
  let dismissed = false;

  const handleSubmit = async () => {
    const email = get(notificationEmail);
    if (!email) return;

    loading = true;
    error = '';

    try {
      const response = await fetch(`/api/batch/${get(batchId)}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      emailSubmitted.set(true);
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  };

  const handleDismiss = () => {
    dismissed = true;
    showEmailPrompt.set(false);
  };
</script>

{#if !dismissed && !$emailSubmitted}
  <div class="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-3">
    <p class="text-sm text-blue-800">
      <strong>Taking a while?</strong> Get notified when your results are ready.
    </p>

    <div class="flex gap-2">
      <input
        type="email"
        bind:value={$notificationEmail}
        placeholder="your@email.com"
        class="flex-1 input input-sm"
        disabled={loading}
      />
      <button
        onclick={handleSubmit}
        disabled={loading || !$notificationEmail}
        class="btn-primary btn-sm"
      >
        {loading ? 'Saving...' : 'Notify Me'}
      </button>
    </div>

    {#if error}
      <p class="text-sm text-red-500">{error}</p>
    {/if}

    <button
      onclick={handleDismiss}
      class="text-sm text-gray-500 hover:text-gray-700"
    >
      No thanks
    </button>
  </div>
{:else if $emailSubmitted}
  <div class="border border-green-200 bg-green-50 rounded-lg p-4">
    <p class="text-sm text-green-800">
      ✓ We'll email you at <strong>{$notificationEmail}</strong> when your results are ready.
    </p>
  </div>
{/if}
```

### Store Updates

Add to `packages/webapp/src/lib/stores/batch.ts`:

```typescript
export const showEmailPrompt = writable<boolean>(false);
export const notificationEmail = writable<string>('');
export const emailSubmitted = writable<boolean>(false);
```

---

## Tasks

- [ ] Add `resend` dependency: `bun add resend`
- [ ] Create `packages/backend/src/services/email.ts`
- [ ] Add `/api/batch/:id/notify` endpoint
- [ ] Update `batchProcessor.ts` to send email on completion
- [ ] Create `EmailPrompt.svelte` component
- [ ] Update stores with email-related state
- [ ] Test email flow end-to-end
- [ ] Verify email formatting

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/backend/src/services/email.ts` | Resend email service |
| `packages/webapp/src/lib/components/v2/EmailPrompt.svelte` | Email input component |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/backend/src/routes/batch.ts` | Add `/notify` endpoint |
| `packages/backend/src/services/batchProcessor.ts` | Send email on completion |
| `packages/webapp/src/lib/stores/batch.ts` | Add email-related stores |
| `package.json` | Add `resend` dependency |

---

## Environment Variables

```bash
# Add to .env
RESEND_API_KEY=re_xxxxxxxxxxxxx
NOTIFICATION_FROM_EMAIL=HeatSync <noreply@heatsync.now>
BASE_URL=https://heatsync.now
```

---

## Verification

1. Start batch processing with 3+ PDFs
2. Wait 4 seconds → verify email prompt appears
3. Enter email → click "Notify Me"
4. Verify email saved in DB
5. Wait for batch to complete
6. Check inbox for notification email
7. Click link in email → verify navigates to results

---

## Edge Cases

1. **Invalid email**: Frontend validation + backend validation
2. **Email already submitted**: Don't show prompt again
3. **User dismisses**: Don't show prompt again this session
4. **Email send fails**: Log error, don't fail batch
5. **Batch completes before email entered**: No notification sent

---

## Next Phase

→ [Phase 6: Grouped Results Display](./phase-6.md)
