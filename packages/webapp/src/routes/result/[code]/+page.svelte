<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import SwimmerSearch from '$lib/components/SwimmerSearch.svelte';
  import EventList from '$lib/components/EventList.svelte';
  import CalendarExport from '$lib/components/CalendarExport.svelte';
  import {
    extractionResult,
    selectedEventIds,
    selectAllEvents,
    resetStores,
  } from '$lib/stores/extraction';
  import { toasts } from '$lib/stores/toast';
  import type { ExtractResponse, ExtractErrorResponse } from '$lib/types';

  let isLoading = $state(true);
  let error = $state<string | null>(null);
  let linkCopied = $state(false);

  const API_URL = '/api';

  onMount(async () => {
    const code = $page.params.code;

    if (!code) {
      error = 'Invalid result code';
      isLoading = false;
      return;
    }

    try {
      const response = await fetch(`${API_URL}/result/${code}`);
      const result = (await response.json()) as ExtractResponse | ExtractErrorResponse;

      if (!result.success) {
        error = result.error + (result.details ? `: ${result.details}` : '');
        isLoading = false;
        return;
      }

      // Parse date strings from JSON into Date objects
      const data = {
        ...result.data,
        sessionDate: new Date(result.data.sessionDate),
        meetDateRange: result.data.meetDateRange
          ? {
              start: new Date(result.data.meetDateRange.start),
              end: new Date(result.data.meetDateRange.end),
            }
          : undefined,
        events: result.data.events.map((event) => ({
          ...event,
          sessionDate: event.sessionDate ? new Date(event.sessionDate) : undefined,
        })),
      };

      // Load data into stores
      extractionResult.set(data);

      // Auto-select all events
      if (result.data.events.length > 0) {
        selectAllEvents(result.data.events.length);
      }

      isLoading = false;
    } catch (err) {
      console.error('Failed to load result:', err);
      error = err instanceof Error ? err.message : 'Failed to load result';
      isLoading = false;
    }
  });

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      linkCopied = true;
      toasts.success('Link copied to clipboard!');
      setTimeout(() => {
        linkCopied = false;
      }, 2000);
    } catch {
      toasts.error('Failed to copy link');
    }
  };

  const handleStartNew = () => {
    resetStores();
    goto('/');
  };
</script>

<!-- Hero Header -->
<header class="pt-8 text-center sm:pt-12">
  <a href="/" class="inline-block">
    <h1 class="text-3xl font-bold tracking-tight text-sky-900 sm:text-5xl">HeatSync</h1>
  </a>
  <p class="mt-2 text-lg text-sky-600 sm:mt-3 sm:text-xl">
    {#if $extractionResult}
      Events for {$extractionResult.swimmerName}
    {:else}
      Heat Sheet Results
    {/if}
  </p>
</header>

<!-- Main content -->
<div class="mt-8 space-y-8 sm:mt-12">
  {#if isLoading}
    <!-- Loading state -->
    <div class="flex flex-col items-center justify-center py-12">
      <div class="h-8 w-8 animate-spin rounded-full border-4 border-sky-200 border-t-sky-500"></div>
      <p class="mt-4 text-sky-600">Loading results...</p>
    </div>
  {:else if error}
    <!-- Error state -->
    <div class="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <div class="flex flex-col items-center gap-4">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">
          <span role="img" aria-label="error">!</span>
        </div>
        <div>
          <p class="font-medium text-red-900">Could not load results</p>
          <p class="mt-1 text-red-700">{error}</p>
        </div>
        <button
          type="button"
          onclick={handleStartNew}
          class="mt-2 rounded-lg bg-sky-500 px-6 py-2 text-white transition-colors hover:bg-sky-600"
        >
          Start New Search
        </button>
      </div>
    </div>
  {:else if $extractionResult}
    <!-- Results loaded successfully -->

    <!-- Meet Info -->
    <section class="rounded-xl border border-sky-200 bg-white p-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 class="text-xl font-medium text-sky-900">{$extractionResult.meetName}</h2>
          {#if $extractionResult.venue}
            <p class="mt-1 text-sky-600">{$extractionResult.venue}</p>
          {/if}
          <p class="mt-1 text-sm text-sky-500">
            {$extractionResult.sessionDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'UTC',
            })}
          </p>
        </div>
        <button
          type="button"
          onclick={handleCopyLink}
          class="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700 transition-colors hover:bg-sky-100"
        >
          {#if linkCopied}
            <svg class="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            Copied!
          {:else}
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Copy Link
          {/if}
        </button>
      </div>
    </section>

    {#if $extractionResult.events.length > 0}
      <!-- Swimmer Disambiguation (only shows when needed) -->
      <section>
        <SwimmerSearch />
      </section>

      <!-- Event List -->
      <section>
        <EventList />
      </section>

      <!-- Export -->
      <section>
        <CalendarExport disabled={$selectedEventIds.size === 0} />
      </section>
    {:else}
      <!-- No events -->
      <div class="rounded-xl border border-sky-200 bg-white p-8 text-center">
        <div class="flex flex-col items-center gap-3">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-2xl">
            <span role="img" aria-label="no events">0</span>
          </div>
          <div>
            <p class="font-medium text-sky-900">No events found</p>
            <p class="mt-1 text-sky-600">This result contains no swim events</p>
          </div>
        </div>
      </div>
    {/if}

    <!-- Start New Search -->
    <div class="text-center">
      <button
        type="button"
        onclick={handleStartNew}
        class="text-sky-500 hover:text-sky-600 hover:underline"
      >
        Start New Search
      </button>
    </div>
  {/if}
</div>
