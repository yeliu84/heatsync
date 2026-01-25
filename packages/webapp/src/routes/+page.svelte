<script lang="ts">
	import HeatSheetForm from '$lib/components/HeatSheetForm.svelte';
	import SwimmerSearch from '$lib/components/SwimmerSearch.svelte';
	import EventList from '$lib/components/EventList.svelte';
	import CalendarExport from '$lib/components/CalendarExport.svelte';
	import { appState, extractionResult, selectedEventIds, resetStores } from '$lib/stores/extraction';

	const handleStartOver = () => {
		resetStores();
	};
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
