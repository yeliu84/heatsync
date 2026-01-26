<script lang="ts">
  import HeatSheetForm from '$lib/components/HeatSheetForm.svelte';
  import SwimmerSearch from '$lib/components/SwimmerSearch.svelte';
  import EventList from '$lib/components/EventList.svelte';
  import CalendarExport from '$lib/components/CalendarExport.svelte';
  import { extractionResult, selectedEventIds, resetStores } from '$lib/stores/extraction';

  const handleStartOver = () => {
    resetStores();
  };
</script>

<!-- Hero Header -->
<header class="pt-8 text-center sm:pt-12">
  <h1 class="text-3xl font-bold tracking-tight text-sky-900 sm:text-5xl">HeatSync</h1>
  <p class="mt-2 text-lg text-sky-600 sm:mt-3 sm:text-xl">Heat Sheet → Calendar</p>
  <p class="mt-1 text-xs text-sky-400 sm:mt-2 sm:text-sm">Never miss a race again</p>
</header>

<!-- Main content -->
<div class="mt-8 space-y-12 sm:mt-16">
  <!-- Step 1: Heat Sheet Form -->
  <section>
    <HeatSheetForm />
  </section>

  <!-- Steps 2-4: Only show when events are found -->
  {#if $extractionResult && $extractionResult.events.length > 0}
    <!-- Step 2: Swimmer Disambiguation (only shows when needed) -->
    <section>
      <SwimmerSearch />
    </section>

    <!-- Step 3: Event List -->
    <section>
      <EventList />
    </section>

    <!-- Step 4: Export -->
    <section>
      <CalendarExport disabled={$selectedEventIds.size === 0} />
    </section>

    <!-- Start Over -->
    <div class="text-center">
      <button
        type="button"
        onclick={handleStartOver}
        class="text-sky-500 hover:text-sky-600 hover:underline"
      >
        Start Over
      </button>
    </div>
  {/if}
</div>
