# Phase 6: Grouped Results Display

**Goal:** Display results organized by session/heat sheet

**Status:** Pending

**Depends on:** Phase 2 (Backend API), Phase 4 (Frontend UI)

---

## Overview

When a batch contains multiple heat sheets, results should be displayed grouped by source, making it easy for users to see events from each session separately while still allowing export of all events together.

**Key Features:**
- **Grouped by source** - Each heat sheet gets its own collapsible section
- **Event deduplication** - Detect and flag same event appearing in multiple sources
- **Empty source handling** - Don't show sources with zero events found
- **Deep linking** - Support `#session-N` hash links for direct navigation
- **Smart filenames** - Different export names for single vs multi-source

---

## New Route: `/batch/:id`

Shows all extraction results from a batch, grouped by source PDF.

### URL Structure

```
/batch/[batchId]           # Batch results page (new)
/batch/[batchId]#session-2 # Deep link to specific session
/result/[code]             # Individual extraction result (existing, still works)
```

---

## UI Design

```
┌─────────────────────────────────────────────────────────────────┐
│  HeatSync                                       [Start New]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Events for John Smith                                          │
│  3 heat sheets • 28 events total                                │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  ▼ Session 1 - Morning Heats                    session1.pdf   │
│    ┌───────────────────────────────────────────────────────┐   │
│    │ Friday, Jan 15 • Aquatic Center                       │   │
│    │                                                       │   │
│    │ [✓] Event 5: 100 Free • Heat 3, Lane 4 • 9:45 AM     │   │
│    │     Seed: 1:02.34                                    │   │
│    │                                                       │   │
│    │ [✓] Event 12: 50 Back • Heat 2, Lane 5 • 10:30 AM    │   │
│    │     Seed: 35.67                                      │   │
│    │                                                       │   │
│    │ [Select All] [Select None]            12 events      │   │
│    └───────────────────────────────────────────────────────┘   │
│                                                                 │
│  ▼ Session 2 - Afternoon Finals                 session2.pdf   │
│    ┌───────────────────────────────────────────────────────┐   │
│    │ Friday, Jan 15 • Aquatic Center                       │   │
│    │                                                       │   │
│    │ [✓] Event 23: 200 IM • Finals, Lane 4 • 4:15 PM      │   │
│    │     Seed: 2:34.56                                    │   │
│    │     ⚠️ Also in: Session 1 (same event)               │   │
│    │                                                       │   │
│    │ [Select All] [Select None]             6 events      │   │
│    └───────────────────────────────────────────────────────┘   │
│                                                                 │
│  ▶ Session 3 - Saturday Prelims (10 events)  Click to expand   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  24 events selected (of 28 total)                               │
│  ⚠️ 2 duplicate events detected (will export once)              │
│                                                                 │
│  Reminder: [5 min] [10 min ●] [15 min]                         │
│                                                                 │
│  [Download Calendar (.ics)]                                     │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  [+ Add More Heat Sheets]           [📋 Copy Share Link]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Structure

```
src/routes/batch/[id]/
├── +page.svelte              # Main batch results page
└── +page.ts                  # Load batch data (SSR optional)

src/lib/components/v2/
├── GroupedResults.svelte     # Container for all session groups
├── SessionGroup.svelte       # Single session/source group (collapsible)
├── BatchEventCard.svelte     # Event card with duplicate indicator
├── BatchExportPanel.svelte   # Combined export controls
├── BatchSummary.svelte       # Header with counts and swimmer name
└── BatchActions.svelte       # Add more, share, start new
```

---

## Event Deduplication

Events can appear in multiple heat sheets (e.g., prelims and finals PDFs both list same event). We detect and handle this.

### Deduplication Logic

```typescript
// packages/webapp/src/lib/utils/deduplication.ts

export interface EventWithSource {
  event: SwimEvent;
  sourceSequence: number;
  eventIndex: number;
}

export interface DeduplicationResult {
  uniqueEvents: EventWithSource[];
  duplicates: Map<string, EventWithSource[]>; // eventKey -> all occurrences
}

/**
 * Generate a unique key for an event based on its identifying properties
 */
export const getEventKey = (event: SwimEvent): string => {
  // Key based on: event number, event name (normalized), and approximate time
  const timePart = event.estimatedTime 
    ? new Date(event.estimatedTime).toISOString().slice(0, 16) // YYYY-MM-DDTHH:mm
    : 'no-time';
  
  return [
    event.eventNumber?.toString() || '',
    event.eventName?.toLowerCase().replace(/\s+/g, '-') || '',
    timePart,
  ].join('|');
};

/**
 * Detect duplicate events across multiple sources
 */
export const detectDuplicates = (
  sources: Array<{ sequence: number; events: SwimEvent[] }>
): DeduplicationResult => {
  const eventMap = new Map<string, EventWithSource[]>();
  
  // Group all events by key
  for (const source of sources) {
    source.events.forEach((event, eventIndex) => {
      const key = getEventKey(event);
      const existing = eventMap.get(key) || [];
      existing.push({ event, sourceSequence: source.sequence, eventIndex });
      eventMap.set(key, existing);
    });
  }
  
  // Separate unique events from duplicates
  const uniqueEvents: EventWithSource[] = [];
  const duplicates = new Map<string, EventWithSource[]>();
  
  for (const [key, occurrences] of eventMap) {
    if (occurrences.length > 1) {
      duplicates.set(key, occurrences);
      // Keep only the first occurrence as "unique"
      uniqueEvents.push(occurrences[0]);
    } else {
      uniqueEvents.push(occurrences[0]);
    }
  }
  
  return { uniqueEvents, duplicates };
};

/**
 * Check if a specific event is a duplicate
 */
export const isDuplicate = (
  sourceSequence: number,
  eventIndex: number,
  duplicates: Map<string, EventWithSource[]>
): { isDupe: boolean; otherSources: number[] } => {
  for (const occurrences of duplicates.values()) {
    const match = occurrences.find(
      o => o.sourceSequence === sourceSequence && o.eventIndex === eventIndex
    );
    if (match) {
      const otherSources = occurrences
        .filter(o => o.sourceSequence !== sourceSequence)
        .map(o => o.sourceSequence);
      return { isDupe: true, otherSources };
    }
  }
  return { isDupe: false, otherSources: [] };
};
```

---

## Empty Source Handling

Sources with zero events should not be shown in the results, but we should indicate they were processed.

```typescript
// In GroupedResults.svelte

// Filter out empty sources for display
$: visibleSources = sources.filter(s => s.events.length > 0);
$: emptySources = sources.filter(s => s.events.length === 0);

// Show notice if some sources had no events
{#if emptySources.length > 0}
  <div class="text-sm text-gray-500 bg-gray-50 rounded p-3 mb-4">
    <p>
      {emptySources.length} heat sheet{emptySources.length > 1 ? 's' : ''} had no events for {swimmerName}:
    </p>
    <ul class="list-disc list-inside mt-1">
      {#each emptySources as source}
        <li>{source.filename || source.sourceUrl || `Source ${source.sequence}`}</li>
      {/each}
    </ul>
  </div>
{/if}
```

---

## Deep Linking

Support hash links to jump directly to a specific session.

```typescript
// packages/webapp/src/routes/batch/[id]/+page.svelte

import { onMount } from 'svelte';
import { browser } from '$app/environment';

// Track expanded state per source
let expandedSources = new Set<number>();

onMount(() => {
  // Auto-expand based on hash
  if (browser && window.location.hash) {
    const match = window.location.hash.match(/^#session-(\d+)$/);
    if (match) {
      const sessionNum = parseInt(match[1], 10);
      expandedSources.add(sessionNum);
      expandedSources = expandedSources;
      
      // Scroll to element after render
      requestAnimationFrame(() => {
        const el = document.getElementById(`session-${sessionNum}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  } else {
    // Default: expand all sources
    expandedSources = new Set(sources.map(s => s.sequence));
  }
});

// Update hash when expanding/collapsing (optional)
const toggleExpanded = (seq: number) => {
  if (expandedSources.has(seq)) {
    expandedSources.delete(seq);
  } else {
    expandedSources.add(seq);
  }
  expandedSources = expandedSources;
  
  // Update URL hash (without scroll)
  if (browser && expandedSources.size === 1) {
    const only = [...expandedSources][0];
    history.replaceState(null, '', `#session-${only}`);
  }
};
```

### SessionGroup with ID

```svelte
<!-- SessionGroup.svelte -->
<section id="session-{source.sequence}" class="border rounded-lg overflow-hidden">
  <!-- ... header and content ... -->
</section>
```

---

## Smart Filenames

Export filenames should be descriptive based on content.

```typescript
// packages/webapp/src/lib/utils/calendar.ts

export interface ExportOptions {
  swimmerName: string;
  reminderMinutes: number;
  sources: Array<{ meetName: string; filename?: string }>;
}

/**
 * Generate smart filename for calendar export
 */
export const getExportFilename = (options: ExportOptions): string => {
  const { swimmerName, sources } = options;
  const namePart = swimmerName.replace(/[^a-zA-Z0-9]/g, '_');
  
  if (sources.length === 1) {
    // Single source: "JohnSmith_WinterChampionships.ics"
    const meetPart = sources[0].meetName
      ?.replace(/[^a-zA-Z0-9]/g, '_')
      ?.slice(0, 30) || 'events';
    return `${namePart}_${meetPart}.ics`;
  }
  
  // Multiple sources: "JohnSmith_3meets_28events.ics"
  const meetCount = sources.length;
  const eventCount = sources.reduce((sum, s) => sum + (s.events?.length || 0), 0);
  return `${namePart}_${meetCount}meets_${eventCount}events.ics`;
};

/**
 * Generate ICS with smart filename
 */
export const exportToCalendar = (
  events: SwimEvent[],
  options: ExportOptions
): void => {
  const icsContent = generateICSContent(events, options.reminderMinutes);
  const filename = getExportFilename(options);
  
  downloadFile(icsContent, filename, 'text/calendar');
};
```

---

## Implementation

### Page: `packages/webapp/src/routes/batch/[id]/+page.svelte`

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import GroupedResults from '$lib/components/v2/GroupedResults.svelte';
  import BatchExportPanel from '$lib/components/v2/BatchExportPanel.svelte';
  import BatchSummary from '$lib/components/v2/BatchSummary.svelte';
  import BatchActions from '$lib/components/v2/BatchActions.svelte';
  import { detectDuplicates, type DeduplicationResult } from '$lib/utils/deduplication';

  interface Source {
    sequence: number;
    filename: string | null;
    sourceUrl: string | null;
    meetName: string;
    sessionDate: string;
    venue?: string;
    events: SwimEvent[];
    resultCode: string;
  }

  interface BatchResult {
    swimmerName: string;
    sources: Source[];
    totalEvents: number;
    status: 'completed' | 'partial' | 'failed';
    failedCount: number;
  }

  let batchResult: BatchResult | null = null;
  let loading = true;
  let error = '';
  let deduplication: DeduplicationResult | null = null;

  // Selection state
  let selectedEventIds = new Set<string>(); // "sequence:eventIndex"
  let reminderMinutes = 10;
  
  // Expanded state
  let expandedSources = new Set<number>();

  onMount(async () => {
    try {
      const response = await fetch(`/api/batch/${$page.params.id}/results`);
      const data = await response.json();

      if (!data.success) throw new Error(data.error || 'Failed to load results');

      batchResult = data;
      
      // Run deduplication
      deduplication = detectDuplicates(
        data.sources.map((s: Source) => ({ sequence: s.sequence, events: s.events }))
      );

      // Auto-select all events (excluding duplicates after first occurrence)
      for (const source of data.sources) {
        source.events.forEach((_: SwimEvent, i: number) => {
          selectedEventIds.add(`${source.sequence}:${i}`);
        });
      }
      selectedEventIds = selectedEventIds;
      
      // Handle deep linking
      if (browser && window.location.hash) {
        const match = window.location.hash.match(/^#session-(\d+)$/);
        if (match) {
          const sessionNum = parseInt(match[1], 10);
          expandedSources = new Set([sessionNum]);
          requestAnimationFrame(() => {
            document.getElementById(`session-${sessionNum}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        } else {
          expandedSources = new Set(data.sources.map((s: Source) => s.sequence));
        }
      } else {
        // Default: expand all
        expandedSources = new Set(data.sources.map((s: Source) => s.sequence));
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  });

  const toggleEvent = (sourceSeq: number, eventIdx: number) => {
    const key = `${sourceSeq}:${eventIdx}`;
    if (selectedEventIds.has(key)) {
      selectedEventIds.delete(key);
    } else {
      selectedEventIds.add(key);
    }
    selectedEventIds = selectedEventIds;
  };
  
  const toggleExpanded = (seq: number) => {
    if (expandedSources.has(seq)) {
      expandedSources.delete(seq);
    } else {
      expandedSources.add(seq);
    }
    expandedSources = expandedSources;
  };

  const selectAll = () => {
    selectedEventIds.clear();
    for (const source of batchResult!.sources) {
      source.events.forEach((_, i) => {
        selectedEventIds.add(`${source.sequence}:${i}`);
      });
    }
    selectedEventIds = selectedEventIds;
  };

  const selectNone = () => {
    selectedEventIds.clear();
    selectedEventIds = selectedEventIds;
  };

  $: selectedCount = selectedEventIds.size;
  $: totalCount = batchResult?.totalEvents || 0;
  $: duplicateCount = deduplication?.duplicates.size || 0;
  $: visibleSources = batchResult?.sources.filter(s => s.events.length > 0) || [];
  $: emptySources = batchResult?.sources.filter(s => s.events.length === 0) || [];
</script>

<svelte:head>
  <title>
    {batchResult ? `${batchResult.swimmerName}'s Events` : 'Loading...'} | HeatSync
  </title>
</svelte:head>

<div class="max-w-3xl mx-auto p-4 space-y-6">
  {#if loading}
    <div class="text-center py-12">
      <div class="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
      <p class="text-gray-600">Loading results...</p>
    </div>
  {:else if error}
    <div class="text-center py-12">
      <p class="text-red-500 mb-4">{error}</p>
      <a href="/" class="text-blue-600 hover:underline">← Start Over</a>
    </div>
  {:else if batchResult}
    <BatchSummary
      swimmerName={batchResult.swimmerName}
      sourceCount={batchResult.sources.length}
      {totalCount}
      failedCount={batchResult.failedCount}
      status={batchResult.status}
    />

    {#if emptySources.length > 0}
      <div class="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
        <p class="font-medium">
          {emptySources.length} heat sheet{emptySources.length > 1 ? 's' : ''} had no events for {batchResult.swimmerName}:
        </p>
        <ul class="list-disc list-inside mt-1 text-gray-400">
          {#each emptySources as source}
            <li>{source.filename || source.sourceUrl || `Source ${source.sequence}`}</li>
          {/each}
        </ul>
      </div>
    {/if}

    <GroupedResults
      sources={visibleSources}
      {selectedEventIds}
      {expandedSources}
      {deduplication}
      onToggle={toggleEvent}
      onToggleExpand={toggleExpanded}
    />

    <BatchExportPanel
      {batchResult}
      {selectedEventIds}
      {selectedCount}
      {totalCount}
      {duplicateCount}
      {reminderMinutes}
      {deduplication}
      onSelectAll={selectAll}
      onSelectNone={selectNone}
      onReminderChange={(m) => reminderMinutes = m}
    />

    <BatchActions 
      batchId={$page.params.id} 
      swimmerName={batchResult.swimmerName}
    />
  {/if}
</div>
```

### Component: GroupedResults.svelte

```svelte
<script lang="ts">
  import SessionGroup from './SessionGroup.svelte';
  import type { DeduplicationResult } from '$lib/utils/deduplication';

  export let sources: Array<{
    sequence: number;
    filename: string | null;
    sourceUrl: string | null;
    meetName: string;
    sessionDate: string;
    venue?: string;
    events: SwimEvent[];
    resultCode: string;
  }>;
  export let selectedEventIds: Set<string>;
  export let expandedSources: Set<number>;
  export let deduplication: DeduplicationResult | null;
  export let onToggle: (sourceSeq: number, eventIdx: number) => void;
  export let onToggleExpand: (seq: number) => void;
</script>

<div class="space-y-4">
  {#each sources as source, i}
    <SessionGroup
      {source}
      sessionNumber={i + 1}
      expanded={expandedSources.has(source.sequence)}
      {selectedEventIds}
      {deduplication}
      onToggleExpand={() => onToggleExpand(source.sequence)}
      onToggleEvent={(idx) => onToggle(source.sequence, idx)}
    />
  {/each}
</div>
```

### Component: SessionGroup.svelte

```svelte
<script lang="ts">
  import BatchEventCard from './BatchEventCard.svelte';
  import { isDuplicate, type DeduplicationResult } from '$lib/utils/deduplication';

  export let source: {
    sequence: number;
    filename: string | null;
    sourceUrl: string | null;
    meetName: string;
    sessionDate: string;
    venue?: string;
    events: SwimEvent[];
    resultCode: string;
  };
  export let sessionNumber: number;
  export let expanded: boolean;
  export let selectedEventIds: Set<string>;
  export let deduplication: DeduplicationResult | null;
  export let onToggleExpand: () => void;
  export let onToggleEvent: (idx: number) => void;

  $: selectedInSource = source.events.filter((_, i) =>
    selectedEventIds.has(`${source.sequence}:${i}`)
  ).length;

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };
  
  const selectAllInSource = () => {
    source.events.forEach((_, i) => {
      const key = `${source.sequence}:${i}`;
      if (!selectedEventIds.has(key)) {
        selectedEventIds.add(key);
      }
    });
    selectedEventIds = selectedEventIds;
  };
  
  const selectNoneInSource = () => {
    source.events.forEach((_, i) => {
      selectedEventIds.delete(`${source.sequence}:${i}`);
    });
    selectedEventIds = selectedEventIds;
  };
</script>

<section id="session-{source.sequence}" class="border rounded-lg overflow-hidden bg-white shadow-sm">
  <!-- Header (clickable) -->
  <button
    onclick={onToggleExpand}
    class="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
  >
    <div class="flex items-center gap-3">
      <span class="text-lg text-gray-400">{expanded ? '▼' : '▶'}</span>
      <div>
        <h3 class="font-medium text-gray-900">
          Session {sessionNumber} — {source.meetName}
        </h3>
        <p class="text-sm text-gray-500">
          {formatDate(source.sessionDate)}
          {#if source.venue}• {source.venue}{/if}
        </p>
      </div>
    </div>
    <div class="text-right text-sm text-gray-500">
      <p class="font-medium">{source.events.length} event{source.events.length !== 1 ? 's' : ''}</p>
      <p class="text-xs text-gray-400 truncate max-w-[150px]">
        {source.filename || 'From URL'}
      </p>
    </div>
  </button>

  <!-- Events (collapsible) -->
  {#if expanded}
    <div class="border-t">
      <div class="p-4 space-y-3">
        {#each source.events as event, i}
          {@const dupeInfo = deduplication ? isDuplicate(source.sequence, i, deduplication.duplicates) : { isDupe: false, otherSources: [] }}
          <div class="flex items-start gap-3">
            <input
              type="checkbox"
              checked={selectedEventIds.has(`${source.sequence}:${i}`)}
              onchange={() => onToggleEvent(i)}
              class="mt-1.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div class="flex-1">
              <BatchEventCard 
                {event} 
                isDuplicate={dupeInfo.isDupe}
                duplicateSources={dupeInfo.otherSources}
              />
            </div>
          </div>
        {/each}
      </div>
      
      <!-- Source-level actions -->
      <div class="px-4 pb-3 flex items-center justify-between border-t pt-3 bg-gray-50">
        <div class="flex gap-3 text-sm">
          <button
            onclick={selectAllInSource}
            class="text-blue-600 hover:underline"
          >
            Select All
          </button>
          <button
            onclick={selectNoneInSource}
            class="text-blue-600 hover:underline"
          >
            Select None
          </button>
        </div>
        <span class="text-sm text-gray-500">
          {selectedInSource} of {source.events.length} selected
        </span>
      </div>
    </div>
  {/if}
</section>
```

### Component: BatchEventCard.svelte

```svelte
<script lang="ts">
  export let event: SwimEvent;
  export let isDuplicate = false;
  export let duplicateSources: number[] = [];

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };
  
  $: time = formatTime(event.estimatedTime);
</script>

<div class="py-2">
  <div class="flex items-start justify-between gap-2">
    <div>
      <p class="font-medium text-gray-900">
        {#if event.eventNumber}
          <span class="text-gray-500">Event {event.eventNumber}:</span>
        {/if}
        {event.eventName}
      </p>
      <p class="text-sm text-gray-600">
        {#if event.heat}Heat {event.heat}{/if}
        {#if event.lane}, Lane {event.lane}{/if}
        {#if time}
          <span class="mx-1">•</span> {time}
        {/if}
      </p>
      {#if event.seedTime}
        <p class="text-sm text-gray-500">Seed: {event.seedTime}</p>
      {/if}
    </div>
  </div>
  
  {#if isDuplicate}
    <p class="text-xs text-amber-600 mt-1 flex items-center gap-1">
      <span>⚠️</span>
      Also in Session {duplicateSources.join(', ')} (will export once)
    </p>
  {/if}
</div>
```

### Component: BatchExportPanel.svelte

```svelte
<script lang="ts">
  import { exportToCalendar, getExportFilename } from '$lib/utils/calendar';
  import type { DeduplicationResult } from '$lib/utils/deduplication';

  export let batchResult: BatchResult;
  export let selectedEventIds: Set<string>;
  export let selectedCount: number;
  export let totalCount: number;
  export let duplicateCount: number;
  export let reminderMinutes: number;
  export let deduplication: DeduplicationResult | null;
  export let onSelectAll: () => void;
  export let onSelectNone: () => void;
  export let onReminderChange: (m: number) => void;

  const handleExport = () => {
    // Collect selected events, deduplicating
    const seenKeys = new Set<string>();
    const events: SwimEvent[] = [];
    
    for (const source of batchResult.sources) {
      source.events.forEach((event, i) => {
        if (!selectedEventIds.has(`${source.sequence}:${i}`)) return;
        
        // Deduplicate on export
        const key = getEventKey(event);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        
        events.push({
          ...event,
          meetName: source.meetName,
          venue: source.venue,
        });
      });
    }
    
    exportToCalendar(events, {
      swimmerName: batchResult.swimmerName,
      reminderMinutes,
      sources: batchResult.sources,
    });
  };
  
  $: exportDisabled = selectedCount === 0;
</script>

<div class="border-t pt-4 space-y-4">
  <!-- Selection summary -->
  <div class="flex items-center justify-between">
    <div>
      <p class="text-sm text-gray-600">
        {selectedCount} of {totalCount} events selected
      </p>
      {#if duplicateCount > 0}
        <p class="text-xs text-amber-600">
          ⚠️ {duplicateCount} duplicate{duplicateCount !== 1 ? 's' : ''} detected (will export once)
        </p>
      {/if}
    </div>
    <div class="flex gap-2">
      <button onclick={onSelectAll} class="text-sm text-blue-600 hover:underline">
        Select All
      </button>
      <span class="text-gray-300">|</span>
      <button onclick={onSelectNone} class="text-sm text-blue-600 hover:underline">
        Select None
      </button>
    </div>
  </div>

  <!-- Reminder selector -->
  <div class="flex items-center gap-4">
    <span class="text-sm text-gray-600">Reminder:</span>
    {#each [5, 10, 15] as minutes}
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="radio"
          name="reminder"
          value={minutes}
          checked={reminderMinutes === minutes}
          onchange={() => onReminderChange(minutes)}
          class="h-4 w-4 text-blue-600"
        />
        <span class="text-sm">{minutes} min</span>
      </label>
    {/each}
  </div>

  <!-- Export button -->
  <button
    onclick={handleExport}
    disabled={exportDisabled}
    class="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  >
    Download Calendar (.ics)
  </button>
</div>
```

### Component: BatchSummary.svelte

```svelte
<script lang="ts">
  export let swimmerName: string;
  export let sourceCount: number;
  export let totalCount: number;
  export let failedCount: number;
  export let status: 'completed' | 'partial' | 'failed';
</script>

<header class="space-y-2">
  <h1 class="text-2xl font-bold text-gray-900">
    Events for {swimmerName}
  </h1>
  <p class="text-gray-600">
    {sourceCount} heat sheet{sourceCount !== 1 ? 's' : ''} • {totalCount} event{totalCount !== 1 ? 's' : ''} total
  </p>
  
  {#if status === 'partial'}
    <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
      ⚠️ {failedCount} heat sheet{failedCount !== 1 ? 's' : ''} failed to process. 
      <a href="#" class="underline">Retry failed</a>
    </div>
  {:else if status === 'failed'}
    <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
      ❌ All heat sheets failed to process. Please try again.
    </div>
  {/if}
</header>
```

### Component: BatchActions.svelte

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  
  export let batchId: string;
  export let swimmerName: string;
  
  let copied = false;
  
  const copyShareLink = async () => {
    const url = `${window.location.origin}/batch/${batchId}`;
    await navigator.clipboard.writeText(url);
    copied = true;
    setTimeout(() => copied = false, 2000);
  };
</script>

<div class="border-t pt-4 flex flex-wrap gap-3 justify-between">
  <a
    href="/"
    class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
  >
    + Add More Heat Sheets
  </a>
  
  <button
    onclick={copyShareLink}
    class="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
  >
    {#if copied}
      <span class="text-green-600">✓ Copied!</span>
    {:else}
      <span>📋</span> Copy Share Link
    {/if}
  </button>
</div>
```

---

## Backend: Results Endpoint

The `/api/batch/:id/results` endpoint (from Phase 2) should return:

```typescript
// GET /api/batch/:id/results

interface BatchResultsResponse {
  success: true;
  swimmerName: string;
  totalEvents: number;
  status: 'completed' | 'partial' | 'failed';
  failedCount: number;
  sources: Array<{
    sequence: number;
    filename: string | null;
    sourceUrl: string | null;
    meetName: string;
    sessionDate: string;
    venue?: string;
    events: SwimEvent[];
    resultCode: string;
  }>;
}
```

---

## Tasks

- [ ] Create `packages/webapp/src/lib/utils/deduplication.ts`
- [ ] Create `packages/webapp/src/routes/batch/[id]/+page.svelte`
- [ ] Create `GroupedResults.svelte`
- [ ] Create `SessionGroup.svelte`
- [ ] Create `BatchEventCard.svelte`
- [ ] Create `BatchExportPanel.svelte`
- [ ] Create `BatchSummary.svelte`
- [ ] Create `BatchActions.svelte`
- [ ] Update `packages/webapp/src/lib/utils/calendar.ts` with smart filenames
- [ ] Test deep linking with `#session-N`
- [ ] Test deduplication with overlapping events
- [ ] Test empty source handling
- [ ] Test export with duplicates (should export once)
- [ ] Test on mobile

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/webapp/src/lib/utils/deduplication.ts` | Event deduplication logic |
| `packages/webapp/src/routes/batch/[id]/+page.svelte` | Batch results page |
| `packages/webapp/src/lib/components/v2/GroupedResults.svelte` | Results container |
| `packages/webapp/src/lib/components/v2/SessionGroup.svelte` | Single session group |
| `packages/webapp/src/lib/components/v2/BatchEventCard.svelte` | Event card with dupe indicator |
| `packages/webapp/src/lib/components/v2/BatchExportPanel.svelte` | Export controls |
| `packages/webapp/src/lib/components/v2/BatchSummary.svelte` | Header summary |
| `packages/webapp/src/lib/components/v2/BatchActions.svelte` | Additional actions |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/webapp/src/lib/utils/calendar.ts` | Add smart filename generation |

---

## Verification

1. **Grouped Display**: Upload 3 PDFs → verify results grouped by source
2. **Collapse/Expand**: Click headers → verify groups collapse/expand
3. **Deep Linking**: Navigate to `/batch/xxx#session-2` → verify scrolls to session 2
4. **Deduplication**: Same event in 2 sources → verify warning shown, exports once
5. **Empty Sources**: Upload PDF with no matches → verify not shown but mentioned
6. **Selection**: Toggle individual events → verify count updates
7. **Source Selection**: Use Select All/None per source → verify works
8. **Export Filename**: Single source → `Name_MeetName.ics`; Multiple → `Name_3meets_28events.ics`
9. **Share Link**: Click copy → verify correct URL in clipboard
10. **Mobile**: Full flow on phone → verify responsive design
11. **Partial Failure**: 1 of 3 fails → verify warning shown with retry link

---

## Design Notes

### Why deduplicate on export, not display?

Users should see all events from each source for transparency. But the exported calendar shouldn't have duplicate reminders. We show a warning ("also in Session X") but include the event in both lists, then deduplicate only at export time.

### Why filter empty sources?

Showing "0 events" sections adds noise. Instead, we mention them once at the top so users know they were processed, then focus on sources with actual results.

### Why deep linking?

Share links like `/batch/xxx#session-2` let users direct others to a specific meet's events, useful when a coach shares results and says "check Session 2 for finals."

---

## Next Phase

→ [Phase 7: Cleanup & Polish](./phase-7.md)
