# Phase 6: Grouped Results Display

**Goal:** Display results organized by session/heat sheet

**Status:** Pending

**Depends on:** Phase 2 (Backend API), Phase 4 (Frontend UI)

---

## Overview

When a batch contains multiple heat sheets, results should be displayed grouped by source, making it easy for users to see events from each session separately while still allowing export of all events together.

---

## New Route: `/batch/:id`

Shows all extraction results from a batch, grouped by source PDF.

### URL Structure

```
/batch/[batchId]           # Batch results page (new)
/batch/[batchId]/results   # Same as above (alias)
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
│    │ ... 10 more events                                   │   │
│    └───────────────────────────────────────────────────────┘   │
│                                                                 │
│  ▼ Session 2 - Afternoon Finals                 session2.pdf   │
│    ┌───────────────────────────────────────────────────────┐   │
│    │ Friday, Jan 15 • Aquatic Center                       │   │
│    │                                                       │   │
│    │ [✓] Event 23: 200 IM • Finals, Lane 4 • 4:15 PM      │   │
│    │     Seed: 2:34.56                                    │   │
│    │                                                       │   │
│    │ ... 5 more events                                    │   │
│    └───────────────────────────────────────────────────────┘   │
│                                                                 │
│  ▶ Session 3 - Saturday Prelims              Click to expand   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  24 events selected (of 28 total)                               │
│                                                                 │
│  Reminder: [5 min] [10 min ●] [15 min]                         │
│                                                                 │
│  [Export All to Calendar]    [Export Selected Only]             │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  [+ Add More Heat Sheets]           [Share Results]             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Structure

```
src/routes/batch/[id]/
├── +page.svelte              # Main batch results page
└── +page.ts                  # Load batch data

src/lib/components/v2/
├── GroupedResults.svelte     # Container for all session groups
├── SessionGroup.svelte       # Single session/source group
├── SessionHeader.svelte      # Collapsible header with meet info
├── BatchEventCard.svelte     # Event card (reuse from v1)
├── BatchExportPanel.svelte   # Combined export controls
└── BatchActions.svelte       # Add more, share, start new
```

---

## Implementation

### Page: `packages/webapp/src/routes/batch/[id]/+page.svelte`

```svelte
<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import GroupedResults from '$lib/components/v2/GroupedResults.svelte';
  import BatchExportPanel from '$lib/components/v2/BatchExportPanel.svelte';
  import BatchActions from '$lib/components/v2/BatchActions.svelte';

  interface BatchResult {
    swimmerName: string;
    sources: Array<{
      sequence: number;
      filename: string | null;
      meetName: string;
      sessionDate: string;
      venue?: string;
      events: SwimEvent[];
      resultCode: string;
    }>;
    totalEvents: number;
  }

  let batchResult: BatchResult | null = null;
  let loading = true;
  let error = '';

  // Selection state
  let selectedEventIds = new Set<string>(); // "source-sequence:event-index"
  let reminderMinutes = 10;

  onMount(async () => {
    try {
      const response = await fetch(`/api/batch/${$page.params.id}/results`);
      const data = await response.json();

      if (!data.success) throw new Error(data.error);

      batchResult = data;

      // Auto-select all events
      for (const source of data.sources) {
        source.events.forEach((_, i) => {
          selectedEventIds.add(`${source.sequence}:${i}`);
        });
      }
      selectedEventIds = selectedEventIds; // Trigger reactivity
    } catch (e) {
      error = e.message;
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
</script>

<div class="max-w-3xl mx-auto p-4 space-y-6">
  {#if loading}
    <div class="text-center py-12">Loading results...</div>
  {:else if error}
    <div class="text-center py-12 text-red-500">{error}</div>
  {:else if batchResult}
    <header class="space-y-2">
      <h1 class="text-2xl font-bold">Events for {batchResult.swimmerName}</h1>
      <p class="text-gray-600">
        {totalCount} events across {batchResult.sources.length} heat sheet{batchResult.sources.length > 1 ? 's' : ''}
      </p>
    </header>

    <GroupedResults
      sources={batchResult.sources}
      {selectedEventIds}
      onToggle={toggleEvent}
    />

    <BatchExportPanel
      {batchResult}
      {selectedEventIds}
      {selectedCount}
      {totalCount}
      {reminderMinutes}
      onSelectAll={selectAll}
      onSelectNone={selectNone}
      onReminderChange={(m) => reminderMinutes = m}
    />

    <BatchActions batchId={$page.params.id} />
  {/if}
</div>
```

### Component: GroupedResults.svelte

```svelte
<script lang="ts">
  import SessionGroup from './SessionGroup.svelte';

  export let sources: Array<{
    sequence: number;
    filename: string | null;
    meetName: string;
    sessionDate: string;
    venue?: string;
    events: SwimEvent[];
    resultCode: string;
  }>;
  export let selectedEventIds: Set<string>;
  export let onToggle: (sourceSeq: number, eventIdx: number) => void;

  // Track expanded state per source
  let expandedSources = new Set(sources.map(s => s.sequence));

  const toggleExpanded = (seq: number) => {
    if (expandedSources.has(seq)) {
      expandedSources.delete(seq);
    } else {
      expandedSources.add(seq);
    }
    expandedSources = expandedSources;
  };
</script>

<div class="space-y-4">
  {#each sources as source}
    <SessionGroup
      {source}
      expanded={expandedSources.has(source.sequence)}
      {selectedEventIds}
      onToggleExpand={() => toggleExpanded(source.sequence)}
      onToggleEvent={(idx) => onToggle(source.sequence, idx)}
    />
  {/each}
</div>
```

### Component: SessionGroup.svelte

```svelte
<script lang="ts">
  import EventCard from '../EventCard.svelte'; // Reuse v1 component

  export let source: {
    sequence: number;
    filename: string | null;
    meetName: string;
    sessionDate: string;
    venue?: string;
    events: SwimEvent[];
    resultCode: string;
  };
  export let expanded: boolean;
  export let selectedEventIds: Set<string>;
  export let onToggleExpand: () => void;
  export let onToggleEvent: (idx: number) => void;

  $: selectedInSource = source.events.filter((_, i) =>
    selectedEventIds.has(`${source.sequence}:${i}`)
  ).length;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };
</script>

<div class="border rounded-lg overflow-hidden">
  <!-- Header (clickable) -->
  <button
    onclick={onToggleExpand}
    class="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
  >
    <div class="flex items-center gap-3">
      <span class="text-lg">{expanded ? '▼' : '▶'}</span>
      <div class="text-left">
        <h3 class="font-medium">{source.meetName}</h3>
        <p class="text-sm text-gray-500">
          {formatDate(source.sessionDate)}
          {#if source.venue}• {source.venue}{/if}
        </p>
      </div>
    </div>
    <div class="text-right text-sm text-gray-500">
      <p>{source.events.length} events</p>
      <p class="text-xs">{source.filename || 'From URL'}</p>
    </div>
  </button>

  <!-- Events (collapsible) -->
  {#if expanded}
    <div class="p-4 space-y-3 border-t">
      {#each source.events as event, i}
        <div class="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selectedEventIds.has(`${source.sequence}:${i}`)}
            onchange={() => onToggleEvent(i)}
            class="mt-1"
          />
          <div class="flex-1">
            <EventCard {event} compact />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
```

### Component: BatchExportPanel.svelte

```svelte
<script lang="ts">
  import { generateICS } from '$lib/utils/calendar';

  export let batchResult: BatchResult;
  export let selectedEventIds: Set<string>;
  export let selectedCount: number;
  export let totalCount: number;
  export let reminderMinutes: number;
  export let onSelectAll: () => void;
  export let onSelectNone: () => void;
  export let onReminderChange: (m: number) => void;

  const exportSelected = () => {
    const events = [];
    for (const source of batchResult.sources) {
      source.events.forEach((event, i) => {
        if (selectedEventIds.has(`${source.sequence}:${i}`)) {
          events.push({
            ...event,
            meetName: source.meetName,
            venue: source.venue,
          });
        }
      });
    }
    generateICS(events, batchResult.swimmerName, reminderMinutes);
  };

  const exportAll = () => {
    const events = batchResult.sources.flatMap(source =>
      source.events.map(event => ({
        ...event,
        meetName: source.meetName,
        venue: source.venue,
      }))
    );
    generateICS(events, batchResult.swimmerName, reminderMinutes);
  };
</script>

<div class="border-t pt-4 space-y-4">
  <!-- Selection summary -->
  <div class="flex items-center justify-between">
    <p class="text-sm text-gray-600">
      {selectedCount} of {totalCount} events selected
    </p>
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
      <label class="flex items-center gap-1">
        <input
          type="radio"
          name="reminder"
          value={minutes}
          checked={reminderMinutes === minutes}
          onchange={() => onReminderChange(minutes)}
        />
        <span class="text-sm">{minutes} min</span>
      </label>
    {/each}
  </div>

  <!-- Export buttons -->
  <div class="flex gap-3">
    <button
      onclick={exportAll}
      class="flex-1 btn-primary"
    >
      Export All to Calendar
    </button>
    <button
      onclick={exportSelected}
      disabled={selectedCount === 0}
      class="flex-1 btn-secondary"
    >
      Export {selectedCount} Selected
    </button>
  </div>
</div>
```

---

## Backend Endpoint Update

The `/api/batch/:id/results` endpoint (from Phase 2) returns data structured for this display:

```typescript
interface BatchResultsResponse {
  success: true;
  swimmerName: string;
  totalEvents: number;
  sources: Array<{
    sequence: number;
    filename: string | null;
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

- [ ] Create `packages/webapp/src/routes/batch/[id]/+page.svelte`
- [ ] Create `GroupedResults.svelte`
- [ ] Create `SessionGroup.svelte`
- [ ] Create `BatchExportPanel.svelte`
- [ ] Create `BatchActions.svelte`
- [ ] Update calendar export utility to handle batch events
- [ ] Test with multiple sources
- [ ] Test selection across groups
- [ ] Test export functionality

---

## Files to Create

| File | Description |
|------|-------------|
| `packages/webapp/src/routes/batch/[id]/+page.svelte` | Batch results page |
| `packages/webapp/src/lib/components/v2/GroupedResults.svelte` | Results container |
| `packages/webapp/src/lib/components/v2/SessionGroup.svelte` | Single session group |
| `packages/webapp/src/lib/components/v2/BatchExportPanel.svelte` | Export controls |
| `packages/webapp/src/lib/components/v2/BatchActions.svelte` | Additional actions |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/webapp/src/lib/utils/calendar.ts` | Handle batch exports |

---

## Verification

1. Navigate to `/batch/{id}` with multi-source batch
2. Verify all sources displayed as collapsible groups
3. Collapse/expand groups → verify state persists
4. Toggle individual events → verify selection updates
5. Select All/None → verify works across all groups
6. Export All → verify ICS contains all events
7. Export Selected → verify ICS contains only selected
8. Verify reminder selection affects exported events
9. Test on mobile → verify responsive design

---

## Completion

This completes the v2 development plan. After Phase 6:

1. **Integration Testing**: Full flow from meet URL → batch → results → export
2. **Migration**: Deprecate old `/api/extract` endpoints
3. **Deploy**: Update production with new features
4. **Documentation**: Update user-facing help/FAQ

---

## Summary

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 1 | Database Schema | None |
| 2 | Backend API & SSE | Phase 1 |
| 3 | Meet URL Crawler | None |
| 4 | Frontend Multi-Upload UI | Phase 2 |
| 5 | Email Notifications | Phase 2, 4 |
| 6 | Grouped Results Display | Phase 2, 4 |
