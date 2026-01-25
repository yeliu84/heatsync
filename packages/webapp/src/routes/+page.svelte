<script lang="ts">
	import HeatSheetForm from '$lib/components/HeatSheetForm.svelte';
	import SwimmerSearch from '$lib/components/SwimmerSearch.svelte';
	import EventList from '$lib/components/EventList.svelte';
	import CalendarExport from '$lib/components/CalendarExport.svelte';
	import { appState, extractionResult, selectedEventIds } from '$lib/stores/extraction';
</script>

<!-- Hero Header -->
<header class="pt-12 text-center">
	<h1 class="text-5xl font-bold tracking-tight text-sky-900">HeatSync</h1>
	<p class="mt-3 text-xl text-sky-600">Heat Sheet → Calendar</p>
	<p class="mt-2 text-sm text-sky-400">Never miss a race again</p>
</header>

<!-- Main content -->
<div class="mt-16 space-y-12">
	<!-- Step 1: Heat Sheet Form -->
	<section>
		<HeatSheetForm />
	</section>

	<!-- Steps 2-4: Only show after extraction starts -->
	{#if $appState !== 'upload' || $extractionResult}
		<!-- Step 2: Search -->
		<section>
			<SwimmerSearch disabled={$appState === 'extracting'} />
		</section>

		<!-- Step 3: Event List -->
		<section>
			{#if $appState === 'extracting'}
				<EventList />
			{:else if $appState === 'search' || $appState === 'export'}
				<EventList showPlaceholder />
			{:else}
				<EventList showPlaceholder />
			{/if}
		</section>

		<!-- Step 4: Export -->
		<section>
			<CalendarExport disabled={$selectedEventIds.size === 0} />
		</section>
	{/if}
</div>
