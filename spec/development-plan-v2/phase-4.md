# Phase 4: Frontend Multi-Upload UI

**Goal:** Allow users to queue multiple heat sheets (via meet URL, direct URLs, or file upload)

**Status:** Pending

**Depends on:** Phase 2 (Backend API) for SSE integration

---

## Overview

The new frontend provides three ways to add heat sheets:
1. **Meet URL Discovery** - Enter meet website URL, auto-discover PDFs
2. **Direct URL** - Paste individual PDF URLs
3. **File Upload** - Upload PDF files directly

---

## New Store: `packages/webapp/src/lib/stores/batch.ts`

```typescript
import { writable, derived } from 'svelte/store';
import type { ExtractionResult } from '@heatsync/shared';

// Types
export type QueueItemStatus = 'pending' | 'uploading' | 'downloading' | 'processing' | 'completed' | 'failed';
export type BatchStatus = 'idle' | 'collecting' | 'discovering' | 'processing' | 'completed';

export interface QueueItem {
  id: string;
  source: { type: 'file'; file: File; name: string } | { type: 'url'; url: string; name: string };
  status: QueueItemStatus;
  progress?: number;
  statusMessage?: string;
  result?: ExtractionResult;
  resultCode?: string;
  error?: string;
  addedAt: Date;
}

export interface DiscoveredHeatsheet {
  url: string;
  name: string;
  size?: number;
  selected: boolean;
}

// Core stores
export const swimmerName = writable<string>('');
export const queueItems = writable<QueueItem[]>([]);
export const batchId = writable<string | null>(null);
export const batchStatus = writable<BatchStatus>('idle');

// Discovery stores
export const meetUrl = writable<string>('');
export const discoveredHeatsheets = writable<DiscoveredHeatsheet[]>([]);
export const isDiscovering = writable<boolean>(false);

// Email notification stores
export const showEmailPrompt = writable<boolean>(false);
export const notificationEmail = writable<string>('');
export const emailSubmitted = writable<boolean>(false);

// Derived stores
export const pendingItems = derived(queueItems, $q => $q.filter(i => i.status === 'pending'));
export const processingItems = derived(queueItems, $q => $q.filter(i => ['uploading', 'downloading', 'processing'].includes(i.status)));
export const completedItems = derived(queueItems, $q => $q.filter(i => i.status === 'completed'));
export const failedItems = derived(queueItems, $q => $q.filter(i => i.status === 'failed'));

export const overallProgress = derived(
  [queueItems, completedItems, failedItems],
  ([$q, $c, $f]) => $q.length === 0 ? 0 : Math.round((($c.length + $f.length) / $q.length) * 100)
);

export const canStartProcessing = derived(
  [queueItems, swimmerName, batchStatus],
  ([$q, $name, $status]) => $q.length > 0 && $name.trim().length > 0 && $status === 'collecting'
);

// Actions
export const addFileToQueue = (file: File): void => { /* ... */ };
export const addUrlToQueue = (url: string, name?: string): void => { /* ... */ };
export const removeFromQueue = (id: string): void => { /* ... */ };
export const clearQueue = (): void => { /* ... */ };
export const addSelectedHeatsheets = (): void => { /* ... */ };
export const resetBatch = (): void => { /* ... */ };
```

---

## New Components

### Component Hierarchy

```
src/lib/components/v2/
├── MultiHeatSheetForm.svelte      # Main container
│   ├── MeetUrlInput.svelte        # Meet URL discovery input
│   ├── DiscoveredHeatsheets.svelte # Show/select discovered PDFs
│   ├── HeatSheetQueue.svelte      # Queue display
│   │   └── QueueItem.svelte       # Individual queue item
│   ├── ManualAddInput.svelte      # URL/file manual add
│   └── SwimmerNameInput.svelte    # Swimmer name (reusable)
│
├── ProgressPanel.svelte           # Processing progress
│   ├── OverallProgress.svelte     # Total progress bar
│   ├── JobProgressList.svelte     # Per-job status list
│   └── EmailPrompt.svelte         # Email notification prompt
│
└── (existing components remain for v1 compatibility)
```

### MultiHeatSheetForm.svelte

Main form container that orchestrates the upload workflow.

```svelte
<script lang="ts">
  import { swimmerName, queueItems, batchStatus, canStartProcessing } from '$lib/stores/batch';
  import MeetUrlInput from './MeetUrlInput.svelte';
  import DiscoveredHeatsheets from './DiscoveredHeatsheets.svelte';
  import HeatSheetQueue from './HeatSheetQueue.svelte';
  import ManualAddInput from './ManualAddInput.svelte';
  import SwimmerNameInput from './SwimmerNameInput.svelte';
  import ProgressPanel from './ProgressPanel.svelte';
  import { startBatchProcessing } from '$lib/services/batchClient';

  const handleStartProcessing = async () => {
    await startBatchProcessing();
  };
</script>

{#if $batchStatus === 'idle' || $batchStatus === 'collecting' || $batchStatus === 'discovering'}
  <div class="space-y-6">
    <!-- Meet URL Discovery -->
    <MeetUrlInput />

    <!-- Discovered Heatsheets -->
    <DiscoveredHeatsheets />

    <!-- Queue -->
    <HeatSheetQueue />

    <!-- Manual Add -->
    <ManualAddInput />

    <!-- Swimmer Name -->
    <SwimmerNameInput />

    <!-- Start Button -->
    <button
      onclick={handleStartProcessing}
      disabled={!$canStartProcessing}
      class="w-full btn-primary"
    >
      Find Events in {$queueItems.length} Heat Sheet{$queueItems.length !== 1 ? 's' : ''}
    </button>
  </div>
{:else if $batchStatus === 'processing'}
  <ProgressPanel />
{/if}
```

### MeetUrlInput.svelte

Input for meet website URL with discover button.

```svelte
<script lang="ts">
  import { meetUrl, isDiscovering, discoveredHeatsheets, batchStatus } from '$lib/stores/batch';
  import { discoverHeatsheets } from '$lib/services/batchClient';

  let error = '';

  const handleDiscover = async () => {
    error = '';
    try {
      await discoverHeatsheets($meetUrl);
    } catch (e) {
      error = e.message;
    }
  };
</script>

<div class="space-y-2">
  <label class="text-sm font-medium">Enter Meet Website URL</label>
  <div class="flex gap-2">
    <input
      type="url"
      bind:value={$meetUrl}
      placeholder="https://swimtopia.com/meets/winter-2026"
      class="flex-1 input"
      disabled={$isDiscovering}
    />
    <button
      onclick={handleDiscover}
      disabled={!$meetUrl || $isDiscovering}
      class="btn-secondary"
    >
      {$isDiscovering ? 'Finding...' : 'Find PDFs'}
    </button>
  </div>
  {#if error}
    <p class="text-sm text-red-500">{error}</p>
  {/if}
</div>
```

### DiscoveredHeatsheets.svelte

Display discovered PDFs with checkboxes.

```svelte
<script lang="ts">
  import { discoveredHeatsheets, addSelectedHeatsheets } from '$lib/stores/batch';

  const toggleAll = (checked: boolean) => {
    discoveredHeatsheets.update(sheets =>
      sheets.map(s => ({ ...s, selected: checked }))
    );
  };

  const selectedCount = $derived($discoveredHeatsheets.filter(s => s.selected).length);
</script>

{#if $discoveredHeatsheets.length > 0}
  <div class="border rounded-lg p-4 space-y-3">
    <div class="flex justify-between items-center">
      <h3 class="font-medium">Found {$discoveredHeatsheets.length} Heat Sheets</h3>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={selectedCount === $discoveredHeatsheets.length}
          onchange={(e) => toggleAll(e.target.checked)}
        />
        Select All
      </label>
    </div>

    <div class="space-y-2 max-h-48 overflow-y-auto">
      {#each $discoveredHeatsheets as sheet, i}
        <label class="flex items-center gap-3 p-2 hover:bg-gray-50 rounded">
          <input
            type="checkbox"
            bind:checked={sheet.selected}
          />
          <span class="flex-1">{sheet.name}</span>
          {#if sheet.size}
            <span class="text-sm text-gray-500">
              {(sheet.size / 1024 / 1024).toFixed(1)} MB
            </span>
          {/if}
        </label>
      {/each}
    </div>

    <button
      onclick={addSelectedHeatsheets}
      disabled={selectedCount === 0}
      class="w-full btn-secondary"
    >
      Add {selectedCount} Selected to Queue
    </button>
  </div>
{/if}
```

### ProgressPanel.svelte

Shows processing progress with email prompt.

```svelte
<script lang="ts">
  import { queueItems, overallProgress, showEmailPrompt, batchStatus } from '$lib/stores/batch';
  import EmailPrompt from './EmailPrompt.svelte';

  // Show email prompt after 4 seconds of processing
  $effect(() => {
    if ($batchStatus === 'processing') {
      const timer = setTimeout(() => {
        showEmailPrompt.set(true);
      }, 4000);
      return () => clearTimeout(timer);
    }
  });
</script>

<div class="space-y-4">
  <div class="flex justify-between items-center">
    <h2 class="text-lg font-medium">Processing Heat Sheets...</h2>
    <span class="text-sm text-gray-500">{$overallProgress}%</span>
  </div>

  <!-- Overall progress bar -->
  <div class="w-full bg-gray-200 rounded-full h-3">
    <div
      class="bg-blue-600 h-3 rounded-full transition-all duration-300"
      style="width: {$overallProgress}%"
    ></div>
  </div>

  <!-- Per-job status -->
  <div class="space-y-2">
    {#each $queueItems as item}
      <div class="flex items-center gap-3 p-2 bg-gray-50 rounded">
        <!-- Status icon -->
        {#if item.status === 'completed'}
          <span class="text-green-500">✓</span>
        {:else if item.status === 'failed'}
          <span class="text-red-500">✗</span>
        {:else if item.status === 'pending'}
          <span class="text-gray-400">○</span>
        {:else}
          <span class="animate-spin">◷</span>
        {/if}

        <span class="flex-1 truncate">{item.source.name}</span>

        {#if item.statusMessage}
          <span class="text-sm text-gray-500">{item.statusMessage}</span>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Email prompt -->
  {#if $showEmailPrompt}
    <EmailPrompt />
  {/if}
</div>
```

---

## SSE Client Service

### File: `packages/webapp/src/lib/services/batchClient.ts`

```typescript
import {
  queueItems, batchId, batchStatus, swimmerName,
  discoveredHeatsheets, isDiscovering, showEmailPrompt
} from '$lib/stores/batch';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';

// Discover heatsheets from meet URL
export const discoverHeatsheets = async (url: string): Promise<void> => {
  isDiscovering.set(true);
  try {
    const response = await fetch('/api/discover-heatsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    if (!data.success) throw new Error(data.message);

    discoveredHeatsheets.set(data.heatsheets.map(h => ({ ...h, selected: true })));
  } finally {
    isDiscovering.set(false);
  }
};

// Start batch processing
export const startBatchProcessing = async (): Promise<void> => {
  const items = get(queueItems);
  const swimmer = get(swimmerName);

  // Create batch
  const formData = new FormData();
  formData.append('swimmer', swimmer);

  const urls: string[] = [];
  for (const item of items) {
    if (item.source.type === 'file') {
      formData.append('pdfs', item.source.file);
    } else {
      urls.push(item.source.url);
    }
  }
  if (urls.length > 0) {
    formData.append('urls', JSON.stringify(urls));
  }

  const response = await fetch('/api/batch/extract', {
    method: 'POST',
    body: formData,
  });

  const data = await response.json();
  if (!data.success) throw new Error(data.error);

  batchId.set(data.batchId);
  batchStatus.set('processing');

  // Connect to SSE stream
  connectToStream(data.batchId);
};

// SSE connection
const connectToStream = (id: string): void => {
  const eventSource = new EventSource(`/api/batch/${id}/stream`);

  eventSource.addEventListener('job_progress', (e) => {
    const data = JSON.parse(e.data);
    updateJobProgress(data);
  });

  eventSource.addEventListener('job_completed', (e) => {
    const data = JSON.parse(e.data);
    markJobCompleted(data);
  });

  eventSource.addEventListener('job_failed', (e) => {
    const data = JSON.parse(e.data);
    markJobFailed(data);
  });

  eventSource.addEventListener('batch_completed', (e) => {
    const data = JSON.parse(e.data);
    batchStatus.set('completed');
    eventSource.close();

    // Navigate to results
    goto(`/batch/${id}`);
  });

  eventSource.onerror = () => {
    console.error('SSE connection error');
    // Implement reconnection logic
  };
};
```

---

## Tasks

- [ ] Create `packages/webapp/src/lib/stores/batch.ts`
- [ ] Create `packages/webapp/src/lib/services/batchClient.ts`
- [ ] Create all v2 components in `packages/webapp/src/lib/components/v2/`
- [ ] Update `packages/webapp/src/routes/+page.svelte` to use new form
- [ ] Add batch types to `packages/shared/src/types.ts`
- [ ] Test full upload flow
- [ ] Test SSE reconnection

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/webapp/src/lib/stores/batch.ts` | Queue and batch state management |
| `packages/webapp/src/lib/services/batchClient.ts` | API client + SSE handling |
| `packages/webapp/src/lib/components/v2/MultiHeatSheetForm.svelte` | Main form container |
| `packages/webapp/src/lib/components/v2/MeetUrlInput.svelte` | Meet URL discovery |
| `packages/webapp/src/lib/components/v2/DiscoveredHeatsheets.svelte` | PDF selection |
| `packages/webapp/src/lib/components/v2/HeatSheetQueue.svelte` | Queue display |
| `packages/webapp/src/lib/components/v2/QueueItem.svelte` | Individual item |
| `packages/webapp/src/lib/components/v2/ManualAddInput.svelte` | Manual URL/file add |
| `packages/webapp/src/lib/components/v2/ProgressPanel.svelte` | Processing progress |
| `packages/webapp/src/lib/components/v2/EmailPrompt.svelte` | Email notification |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/webapp/src/routes/+page.svelte` | Use `MultiHeatSheetForm` |
| `packages/shared/src/types.ts` | Add frontend types |

---

## Verification

1. Enter meet URL → verify PDFs discovered
2. Select PDFs → verify added to queue
3. Add manual URL → verify added to queue
4. Upload file → verify added to queue
5. Enter swimmer name → verify validation
6. Click "Find Events" → verify SSE connection
7. Verify progress updates in real-time
8. Verify navigation to results on completion

---

## Next Phase

→ [Phase 5: Email Notification System](./phase-5.md)
