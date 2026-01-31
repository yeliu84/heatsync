# Phase 4: Frontend Multi-Upload UI

**Goal:** Allow users to queue multiple heat sheets (via meet URL, direct URLs, or file upload)

**Status:** Pending

**Depends on:** Phase 2 (Backend API) for SSE integration

---

## Overview

The new frontend provides three ways to add heat sheets:
1. **Meet URL Discovery** - Enter meet website URL, auto-discover PDFs
2. **Direct URL** - Paste individual PDF URLs
3. **File Upload** - Upload PDF files directly (including multi-file drag & drop)

---

## New Store: `packages/webapp/src/lib/stores/batch.ts`

```typescript
import { writable, derived, get } from 'svelte/store';
import type { ExtractionResult } from '@heatsync/shared';

// ============ Types ============

export type QueueItemStatus = 'pending' | 'uploading' | 'downloading' | 'processing' | 'completed' | 'failed';
export type BatchStatus = 'idle' | 'collecting' | 'discovering' | 'processing' | 'completed';

export interface QueueItem {
  id: string;
  source: 
    | { type: 'file'; file: File; name: string } 
    | { type: 'url'; url: string; name: string };
  status: QueueItemStatus;
  stage?: string;
  progressMessage?: string;
  result?: ExtractionResult;
  resultCode?: string;
  meetName?: string;
  eventCount?: number;
  error?: string;
  errorCode?: string;
  retriable?: boolean;
  cached?: boolean;
  addedAt: Date;
}

export interface DiscoveredHeatsheet {
  url: string;
  name: string;
  size?: number;
  selected: boolean;
}

// ============ Core Stores ============

export const swimmerName = writable<string>('');
export const queueItems = writable<QueueItem[]>([]);
export const batchId = writable<string | null>(null);
export const batchStatus = writable<BatchStatus>('idle');
export const processingStartTime = writable<number | null>(null);

// ============ Discovery Stores ============

export const meetUrl = writable<string>('');
export const discoveredHeatsheets = writable<DiscoveredHeatsheet[]>([]);
export const isDiscovering = writable<boolean>(false);
export const discoveryError = writable<string>('');
export const discoveredPlatform = writable<string>('');
export const discoveredMeetName = writable<string>('');

// ============ Email Notification Stores ============

export const showEmailPrompt = writable<boolean>(false);
export const notificationEmail = writable<string>('');
export const emailSubmitted = writable<boolean>(false);
export const emailError = writable<string>('');

// ============ Connection State ============

export const isOnline = writable<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
export const isReconnecting = writable<boolean>(false);
export const lastEventId = writable<number>(0);

// ============ Derived Stores ============

export const pendingItems = derived(queueItems, $q => 
  $q.filter(i => i.status === 'pending')
);

export const processingItems = derived(queueItems, $q => 
  $q.filter(i => ['uploading', 'downloading', 'processing'].includes(i.status))
);

export const completedItems = derived(queueItems, $q => 
  $q.filter(i => i.status === 'completed')
);

export const failedItems = derived(queueItems, $q => 
  $q.filter(i => i.status === 'failed')
);

export const retriableItems = derived(queueItems, $q => 
  $q.filter(i => i.status === 'failed' && i.retriable)
);

export const overallProgress = derived(
  [queueItems, completedItems, failedItems],
  ([$q, $c, $f]) => $q.length === 0 ? 0 : Math.round((($c.length + $f.length) / $q.length) * 100)
);

export const totalEventCount = derived(completedItems, $items =>
  $items.reduce((sum, item) => sum + (item.eventCount || 0), 0)
);

export const canStartProcessing = derived(
  [queueItems, swimmerName, batchStatus],
  ([$q, $name, $status]) => 
    $q.length > 0 && 
    $name.trim().length > 0 && 
    ($status === 'idle' || $status === 'collecting')
);

export const canAddMore = derived(
  [queueItems, batchStatus],
  ([$q, $status]) => 
    $q.length < 15 && 
    ($status === 'idle' || $status === 'collecting')
);

// ============ Actions ============

/**
 * Add a file to the queue
 */
export const addFileToQueue = (file: File): void => {
  if (!file.type.includes('pdf')) {
    console.warn('Not a PDF file:', file.name);
    return;
  }

  const items = get(queueItems);
  if (items.length >= 15) {
    console.warn('Queue is full (max 15)');
    return;
  }

  // Check for duplicates (by name and size)
  const isDuplicate = items.some(
    i => i.source.type === 'file' && 
         i.source.name === file.name && 
         i.source.file.size === file.size
  );
  
  if (isDuplicate) {
    console.warn('Duplicate file:', file.name);
    return;
  }

  queueItems.update(q => [...q, {
    id: crypto.randomUUID(),
    source: { type: 'file', file, name: file.name },
    status: 'pending',
    addedAt: new Date(),
  }]);

  batchStatus.set('collecting');
};

/**
 * Add multiple files at once (for drag & drop)
 */
export const addFilesToQueue = (files: FileList | File[]): void => {
  const pdfFiles = Array.from(files).filter(f => f.type.includes('pdf'));
  pdfFiles.forEach(addFileToQueue);
};

/**
 * Add a URL to the queue
 */
export const addUrlToQueue = (url: string, name?: string): void => {
  const items = get(queueItems);
  if (items.length >= 15) {
    console.warn('Queue is full (max 15)');
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.warn('Invalid URL:', url);
    return;
  }

  // Check for duplicates
  const isDuplicate = items.some(
    i => i.source.type === 'url' && i.source.url === url
  );
  
  if (isDuplicate) {
    console.warn('Duplicate URL:', url);
    return;
  }

  const inferredName = name || url.split('/').pop()?.split('?')[0] || 'Heat Sheet';

  queueItems.update(q => [...q, {
    id: crypto.randomUUID(),
    source: { type: 'url', url, name: inferredName },
    status: 'pending',
    addedAt: new Date(),
  }]);

  batchStatus.set('collecting');
};

/**
 * Remove an item from the queue
 */
export const removeFromQueue = (id: string): void => {
  queueItems.update(q => q.filter(i => i.id !== id));
  
  // Reset to idle if queue is empty
  if (get(queueItems).length === 0) {
    batchStatus.set('idle');
  }
};

/**
 * Clear the entire queue
 */
export const clearQueue = (): void => {
  queueItems.set([]);
  batchStatus.set('idle');
};

/**
 * Move item up in queue
 */
export const moveItemUp = (id: string): void => {
  queueItems.update(items => {
    const index = items.findIndex(i => i.id === id);
    if (index <= 0) return items;
    const newItems = [...items];
    [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
    return newItems;
  });
};

/**
 * Move item down in queue
 */
export const moveItemDown = (id: string): void => {
  queueItems.update(items => {
    const index = items.findIndex(i => i.id === id);
    if (index < 0 || index >= items.length - 1) return items;
    const newItems = [...items];
    [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
    return newItems;
  });
};

/**
 * Add selected discovered heatsheets to queue
 */
export const addSelectedHeatsheets = (): void => {
  const sheets = get(discoveredHeatsheets).filter(s => s.selected);
  sheets.forEach(sheet => {
    addUrlToQueue(sheet.url, sheet.name);
  });
  
  // Clear discovery state
  discoveredHeatsheets.set([]);
  meetUrl.set('');
};

/**
 * Reset all state
 */
export const resetBatch = (): void => {
  queueItems.set([]);
  batchId.set(null);
  batchStatus.set('idle');
  processingStartTime.set(null);
  discoveredHeatsheets.set([]);
  meetUrl.set('');
  isDiscovering.set(false);
  discoveryError.set('');
  showEmailPrompt.set(false);
  notificationEmail.set('');
  emailSubmitted.set(false);
  emailError.set('');
  lastEventId.set(0);
  // Don't reset swimmerName - user likely wants to keep it
};

/**
 * Update job status from SSE event
 */
export const updateJobFromEvent = (event: {
  jobId?: string;
  sequence?: number;
  type: string;
  [key: string]: unknown;
}): void => {
  queueItems.update(items => {
    return items.map((item, index) => {
      // Match by sequence (1-indexed from backend, 0-indexed here)
      if (event.sequence !== undefined && index !== event.sequence - 1) {
        return item;
      }

      switch (event.type) {
        case 'job_progress':
          return {
            ...item,
            status: 'processing' as const,
            stage: event.stage as string,
            progressMessage: event.message as string,
          };
        
        case 'job_completed':
          return {
            ...item,
            status: 'completed' as const,
            stage: 'done',
            resultCode: event.resultCode as string,
            meetName: event.meetName as string,
            eventCount: event.eventCount as number,
            cached: event.cached as boolean,
          };
        
        case 'job_failed':
          return {
            ...item,
            status: 'failed' as const,
            stage: 'failed',
            error: event.errorMessage as string,
            errorCode: event.errorCode as string,
            retriable: event.retriable as boolean,
          };
        
        default:
          return item;
      }
    });
  });
};

/**
 * Sync state from state_sync event (on reconnection)
 */
export const syncStateFromEvent = (event: {
  batch: { status: string; completedPdfs: number; failedPdfs: number };
  jobs: Array<{
    sequence: number;
    status: string;
    stage?: string;
    resultCode?: string;
    meetName?: string;
    eventCount?: number;
    errorMessage?: string;
    errorCode?: string;
    cached?: boolean;
  }>;
  eventId: number;
}): void => {
  lastEventId.set(event.eventId);
  
  queueItems.update(items => {
    return items.map((item, index) => {
      const jobState = event.jobs.find(j => j.sequence === index + 1);
      if (!jobState) return item;
      
      return {
        ...item,
        status: jobState.status as QueueItemStatus,
        stage: jobState.stage,
        resultCode: jobState.resultCode,
        meetName: jobState.meetName,
        eventCount: jobState.eventCount,
        error: jobState.errorMessage,
        errorCode: jobState.errorCode,
        cached: jobState.cached,
      };
    });
  });

  // Update batch status based on sync
  if (event.batch.status === 'completed' || event.batch.status === 'partial' || event.batch.status === 'failed') {
    batchStatus.set('completed');
  }
};
```

---

## SSE Client Service

### File: `packages/webapp/src/lib/services/batchClient.ts`

```typescript
import {
  queueItems, batchId, batchStatus, swimmerName,
  discoveredHeatsheets, isDiscovering, discoveryError,
  discoveredPlatform, discoveredMeetName,
  showEmailPrompt, notificationEmail, emailSubmitted, emailError,
  processingStartTime, lastEventId, isOnline, isReconnecting,
  updateJobFromEvent, syncStateFromEvent,
} from '$lib/stores/batch';
import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { showToast } from '$lib/stores/toast';

let eventSource: EventSource | null = null;

// ============ URL Validation ============

export const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

// ============ Discovery ============

export const discoverHeatsheets = async (url: string): Promise<void> => {
  if (!isValidUrl(url)) {
    discoveryError.set('Please enter a valid URL (http:// or https://)');
    return;
  }

  isDiscovering.set(true);
  discoveryError.set('');
  discoveredHeatsheets.set([]);
  
  try {
    const response = await fetch('/api/discover-heatsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();
    
    if (!data.success) {
      discoveryError.set(data.hint || data.message);
      return;
    }

    discoveredPlatform.set(data.platform || '');
    discoveredMeetName.set(data.meetName || '');
    discoveredHeatsheets.set(
      data.heatsheets.map((h: { url: string; name: string; size?: number }) => ({ 
        ...h, 
        selected: true 
      }))
    );
    
    if (data.heatsheets.length === 0) {
      discoveryError.set('No heat sheet PDFs found on this page.');
    }
  } catch (error) {
    discoveryError.set('Failed to fetch page. Check the URL and try again.');
  } finally {
    isDiscovering.set(false);
  }
};

// ============ Batch Processing ============

export const startBatchProcessing = async (): Promise<void> => {
  const items = get(queueItems);
  const swimmer = get(swimmerName);

  if (items.length === 0 || !swimmer.trim()) {
    return;
  }

  // Build form data
  const formData = new FormData();
  formData.append('swimmer', swimmer.trim());

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

  try {
    const response = await fetch('/api/batch/extract', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    
    if (!data.success) {
      showToast(data.message || 'Failed to start processing', 'error');
      return;
    }

    batchId.set(data.batchId);
    batchStatus.set('processing');
    processingStartTime.set(Date.now());

    // Connect to SSE stream
    connectToStream(data.batchId);
    
  } catch (error) {
    showToast('Failed to start processing. Please try again.', 'error');
  }
};

// ============ SSE Connection ============

const connectToStream = (id: string): void => {
  // Clean up existing connection
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }

  const lastId = get(lastEventId);
  eventSource = new EventSource(`/api/batch/${id}/stream`);

  // Handle state sync (on reconnection)
  eventSource.addEventListener('state_sync', (e) => {
    const data = JSON.parse(e.data);
    console.log('[SSE] State sync received');
    syncStateFromEvent(data);
    isReconnecting.set(false);
  });

  // Handle batch started
  eventSource.addEventListener('batch_started', (e) => {
    const data = JSON.parse(e.data);
    lastEventId.set(data.eventId);
    console.log('[SSE] Batch started:', data.totalJobs, 'jobs');
  });

  // Handle job progress
  eventSource.addEventListener('job_progress', (e) => {
    const data = JSON.parse(e.data);
    lastEventId.set(data.eventId);
    updateJobFromEvent(data);
  });

  // Handle job completed
  eventSource.addEventListener('job_completed', (e) => {
    const data = JSON.parse(e.data);
    lastEventId.set(data.eventId);
    updateJobFromEvent(data);
  });

  // Handle job failed
  eventSource.addEventListener('job_failed', (e) => {
    const data = JSON.parse(e.data);
    lastEventId.set(data.eventId);
    updateJobFromEvent(data);
  });

  // Handle batch completed
  eventSource.addEventListener('batch_completed', (e) => {
    const data = JSON.parse(e.data);
    lastEventId.set(data.eventId);
    batchStatus.set('completed');
    
    eventSource?.close();
    eventSource = null;

    // Navigate to results
    const currentBatchId = get(batchId);
    if (currentBatchId) {
      goto(`/batch/${currentBatchId}`);
    }
  });

  // Handle batch cancelled
  eventSource.addEventListener('batch_cancelled', () => {
    batchStatus.set('completed');
    eventSource?.close();
    eventSource = null;
    showToast('Batch cancelled', 'info');
  });

  // Handle errors
  eventSource.onerror = () => {
    console.log('[SSE] Connection error');
    
    if (!get(isOnline)) {
      // Offline - will reconnect when online
      isReconnecting.set(true);
    } else {
      // Server issue - EventSource will auto-reconnect
      // Show reconnecting indicator briefly
      isReconnecting.set(true);
      setTimeout(() => {
        if (eventSource?.readyState === EventSource.OPEN) {
          isReconnecting.set(false);
        }
      }, 2000);
    }
  };

  eventSource.onopen = () => {
    console.log('[SSE] Connected');
    isReconnecting.set(false);
  };
};

// ============ Online/Offline Handling ============

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline.set(true);
    
    // Reconnect if we have an active batch
    const currentBatchId = get(batchId);
    const currentStatus = get(batchStatus);
    
    if (currentBatchId && currentStatus === 'processing') {
      console.log('[SSE] Reconnecting after coming online');
      isReconnecting.set(true);
      connectToStream(currentBatchId);
    }
  });

  window.addEventListener('offline', () => {
    isOnline.set(false);
  });
}

// ============ Email Notification ============

export const submitNotificationEmail = async (): Promise<boolean> => {
  const email = get(notificationEmail);
  const currentBatchId = get(batchId);
  
  if (!email || !currentBatchId) return false;

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    emailError.set('Please enter a valid email address');
    return false;
  }

  try {
    const response = await fetch(`/api/batch/${currentBatchId}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();
    
    if (!data.success) {
      emailError.set(data.error || 'Failed to register email');
      return false;
    }

    emailSubmitted.set(true);
    emailError.set('');
    return true;
  } catch {
    emailError.set('Failed to submit. Please try again.');
    return false;
  }
};

// ============ Retry ============

export const retryFailedJobs = async (): Promise<void> => {
  const currentBatchId = get(batchId);
  if (!currentBatchId) return;

  try {
    const response = await fetch(`/api/batch/${currentBatchId}/retry`, {
      method: 'POST',
    });

    const data = await response.json();
    
    if (data.success && data.retriedJobs > 0) {
      showToast(`Retrying ${data.retriedJobs} job(s)...`, 'info');
      batchStatus.set('processing');
      connectToStream(currentBatchId);
    }
  } catch {
    showToast('Failed to retry. Please try again.', 'error');
  }
};

// ============ Cancel ============

export const cancelBatch = async (): Promise<void> => {
  const currentBatchId = get(batchId);
  if (!currentBatchId) return;

  try {
    await fetch(`/api/batch/${currentBatchId}/cancel`, {
      method: 'POST',
    });
  } catch {
    // Ignore errors - batch might already be complete
  }
};

// ============ Cleanup ============

export const cleanup = (): void => {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
};
```

---

## Component Hierarchy

```
src/lib/components/v2/
├── MultiHeatSheetForm.svelte      # Main container
│   ├── SwimmerNameInput.svelte    # Swimmer name input
│   ├── MeetUrlInput.svelte        # Meet URL discovery input
│   ├── DiscoveredHeatsheets.svelte # Show/select discovered PDFs
│   ├── ManualAddInput.svelte      # Direct URL input
│   ├── FileDropZone.svelte        # Drag & drop file upload
│   └── HeatSheetQueue.svelte      # Queue display
│       └── QueueItem.svelte       # Individual queue item
│
├── ProgressPanel.svelte           # Processing progress
│   ├── OverallProgress.svelte     # Total progress bar
│   ├── JobProgressList.svelte     # Per-job status list
│   ├── ConnectionStatus.svelte    # Online/offline indicator
│   └── EmailPrompt.svelte         # Email notification prompt
│
└── (existing v1 components for result display)
```

---

## Key Components

### FileDropZone.svelte

```svelte
<script lang="ts">
  import { addFilesToQueue, canAddMore } from '$lib/stores/batch';

  let isDragging = false;
  let fileInput: HTMLInputElement;

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    isDragging = false;
    
    if (!$canAddMore) return;
    
    const files = e.dataTransfer?.files;
    if (files) {
      addFilesToQueue(files);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if ($canAddMore) {
      isDragging = true;
    }
  };

  const handleDragLeave = () => {
    isDragging = false;
  };

  const handleFileSelect = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      addFilesToQueue(input.files);
      input.value = ''; // Reset for re-selection of same file
    }
  };

  const openFilePicker = () => {
    fileInput?.click();
  };
</script>

<div
  class="border-2 border-dashed rounded-lg p-8 text-center transition-colors"
  class:border-blue-500={isDragging}
  class:bg-blue-50={isDragging}
  class:border-gray-300={!isDragging}
  class:opacity-50={!$canAddMore}
  on:drop={handleDrop}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  role="button"
  tabindex="0"
  on:click={openFilePicker}
  on:keypress={(e) => e.key === 'Enter' && openFilePicker()}
>
  <input
    bind:this={fileInput}
    type="file"
    accept=".pdf,application/pdf"
    multiple
    class="hidden"
    on:change={handleFileSelect}
    disabled={!$canAddMore}
  />
  
  <div class="space-y-2">
    <div class="text-4xl">📄</div>
    <p class="text-gray-600">
      {#if isDragging}
        Drop PDF files here
      {:else}
        Drag & drop PDF files here, or click to browse
      {/if}
    </p>
    <p class="text-sm text-gray-400">
      Accepts multiple PDF files
    </p>
  </div>
</div>
```

### ConnectionStatus.svelte

```svelte
<script lang="ts">
  import { isOnline, isReconnecting } from '$lib/stores/batch';
</script>

{#if !$isOnline}
  <div class="flex items-center gap-2 text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
    <span class="animate-pulse">●</span>
    <span class="text-sm">You are offline. Processing continues on the server.</span>
  </div>
{:else if $isReconnecting}
  <div class="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
    <span class="animate-spin">↻</span>
    <span class="text-sm">Reconnecting...</span>
  </div>
{/if}
```

### QueueItem.svelte

```svelte
<script lang="ts">
  import { removeFromQueue, moveItemUp, moveItemDown, batchStatus } from '$lib/stores/batch';
  import type { QueueItem } from '$lib/stores/batch';

  export let item: QueueItem;
  export let index: number;
  export let total: number;

  const canReorder = $batchStatus === 'collecting' || $batchStatus === 'idle';
  const canRemove = $batchStatus !== 'processing';

  const statusIcons = {
    pending: '○',
    uploading: '↑',
    downloading: '↓',
    processing: '◷',
    completed: '✓',
    failed: '✗',
  };

  const statusColors = {
    pending: 'text-gray-400',
    uploading: 'text-blue-500',
    downloading: 'text-blue-500',
    processing: 'text-blue-500 animate-spin',
    completed: 'text-green-500',
    failed: 'text-red-500',
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
</script>

<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg group">
  <!-- Status icon -->
  <span class={statusColors[item.status]}>{statusIcons[item.status]}</span>

  <!-- Item info -->
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="truncate font-medium">{item.source.name}</span>
      {#if item.source.type === 'url'}
        <span class="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">URL</span>
      {/if}
    </div>
    
    {#if item.progressMessage}
      <p class="text-sm text-gray-500">{item.progressMessage}</p>
    {:else if item.error}
      <p class="text-sm text-red-500">{item.error}</p>
    {:else if item.status === 'completed'}
      <p class="text-sm text-green-600">
        {item.meetName} • {item.eventCount} event{item.eventCount !== 1 ? 's' : ''}
        {#if item.cached}<span class="text-gray-400">(cached)</span>{/if}
      </p>
    {/if}
  </div>

  <!-- Reorder buttons -->
  {#if canReorder}
    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        class="p-1 hover:bg-gray-200 rounded disabled:opacity-30"
        disabled={index === 0}
        on:click={() => moveItemUp(item.id)}
        title="Move up"
      >↑</button>
      <button
        class="p-1 hover:bg-gray-200 rounded disabled:opacity-30"
        disabled={index === total - 1}
        on:click={() => moveItemDown(item.id)}
        title="Move down"
      >↓</button>
    </div>
  {/if}

  <!-- Remove button -->
  {#if canRemove}
    <button
      class="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
      on:click={() => removeFromQueue(item.id)}
      title="Remove"
    >✕</button>
  {/if}
</div>
```

---

## Tasks

- [ ] Create `packages/webapp/src/lib/stores/batch.ts`
- [ ] Create `packages/webapp/src/lib/services/batchClient.ts`
- [ ] Create all v2 components in `packages/webapp/src/lib/components/v2/`
  - [ ] `MultiHeatSheetForm.svelte`
  - [ ] `SwimmerNameInput.svelte`
  - [ ] `MeetUrlInput.svelte`
  - [ ] `DiscoveredHeatsheets.svelte`
  - [ ] `ManualAddInput.svelte`
  - [ ] `FileDropZone.svelte`
  - [ ] `HeatSheetQueue.svelte`
  - [ ] `QueueItem.svelte`
  - [ ] `ProgressPanel.svelte`
  - [ ] `ConnectionStatus.svelte`
  - [ ] `EmailPrompt.svelte`
- [ ] Update `packages/webapp/src/routes/+page.svelte` to use new form
- [ ] Add batch types to `packages/shared/src/types.ts`
- [ ] Test multi-file drag and drop
- [ ] Test URL validation
- [ ] Test SSE reconnection after offline
- [ ] Test queue reordering
- [ ] Test on mobile devices

---

## Verification

1. **Multi-file upload:** Drag 3 PDFs → verify all added to queue
2. **Duplicate detection:** Add same file twice → verify rejected
3. **Queue limit:** Try adding 16th item → verify rejected
4. **URL validation:** Enter invalid URL → verify error shown
5. **Meet discovery:** Enter meet URL → verify PDFs discovered
6. **Queue reorder:** Move item up/down → verify order changes
7. **SSE connection:** Start processing → verify progress updates
8. **Offline handling:** Go offline → verify indicator shown
9. **Reconnection:** Come back online → verify state syncs
10. **Mobile:** Test full flow on phone

---

## Next Phase

→ [Phase 5: Email Notification System](./phase-5.md)
