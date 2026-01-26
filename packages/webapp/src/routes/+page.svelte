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
<header class="pt-8 text-center sm:pt-12">
	<h1 class="text-3xl font-bold tracking-tight text-sky-900 sm:text-5xl">HeatSync</h1>
	<p class="mt-2 text-lg text-sky-600 sm:mt-3 sm:text-xl">Heat Sheet → Calendar</p>
	<p class="mt-1 text-xs text-sky-400 sm:mt-2 sm:text-sm">Never miss a race again</p>
</header>

<!-- Progress indicator -->
{#if $appState === 'extracting' || $extractionResult}
	<div class="mt-8 flex items-center justify-center gap-2">
		{#each [1, 2, 3] as step}
			{@const currentStep = $appState === 'extracting' ? 1 : ($extractionResult ? 2 : 0)}
			{@const isActive = step <= currentStep + 1}
			{@const isComplete = step <= currentStep}
			<div class="flex items-center gap-2">
				<div
					class="flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors
						{isComplete ? 'bg-sky-500 text-white' : isActive ? 'border-2 border-sky-500 text-sky-500' : 'border-2 border-sky-200 text-sky-300'}"
				>
					{#if isComplete}
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
					{:else}
						{step}
					{/if}
				</div>
				{#if step < 3}
					<div class="h-0.5 w-8 transition-colors {isComplete ? 'bg-sky-500' : 'bg-sky-200'}"></div>
				{/if}
			</div>
		{/each}
	</div>
	<div class="mt-2 text-center text-xs text-sky-400">
		{#if $appState === 'extracting'}
			Step 1: Extracting events...
		{:else if $extractionResult}
			Step 2: Select your events
		{/if}
	</div>
{/if}

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
