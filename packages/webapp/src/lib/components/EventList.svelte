<script lang="ts">
	import {
		filteredEvents,
		extractionResult,
		selectedEventIds,
		toggleEventSelection,
		clearSelections
	} from '$lib/stores/extraction';
	import EventCard from './EventCard.svelte';
	import EventCardSkeleton from './EventCardSkeleton.svelte';
	import { fade } from 'svelte/transition';

	interface Props {
		showPlaceholder?: boolean;
	}

	let { showPlaceholder = false }: Props = $props();

	const selectAll = () => {
		const indices = $filteredEvents.map((_, i) => i);
		indices.forEach((i) => {
			if (!$selectedEventIds.has(i)) {
				toggleEventSelection(i);
			}
		});
	};

	const isAllSelected = (): boolean => {
		if ($filteredEvents.length === 0) return false;
		return $filteredEvents.every((_, i) => $selectedEventIds.has(i));
	};
</script>

{#if showPlaceholder}
	<!-- Placeholder state before extraction -->
	<div class="rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/50 p-8 text-center">
		<div class="flex flex-col items-center gap-3">
			<div class="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-3xl">
				<span role="img" aria-label="sparkles">✨</span>
			</div>
			<div>
				<p class="text-2xl font-medium text-sky-900">Your Events Will Appear Here</p>
				<p class="mt-1 text-base text-sky-600">
					Upload a heat sheet PDF and click "Find Events" to get started
				</p>
			</div>
		</div>
	</div>
{:else if !$extractionResult}
	<!-- Loading/extracting state with skeleton loaders -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<div class="h-4 w-4 animate-spin rounded-full border-2 border-sky-200 border-t-sky-500"></div>
				<p class="text-sm text-sky-600">Processing your heat sheet...</p>
			</div>
		</div>
		<div class="space-y-3">
			{#each Array(4) as _, i}
				<EventCardSkeleton />
			{/each}
		</div>
	</div>
{:else if $filteredEvents.length === 0}
	<!-- No results -->
	<div class="rounded-xl border border-sky-200 bg-white p-8 text-center">
		<div class="flex flex-col items-center gap-3">
			<div class="flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-2xl">
				<span role="img" aria-label="magnifying glass">🔍</span>
			</div>
			<div>
				<p class="font-medium text-sky-900">No events found</p>
				<p class="mt-1 text-base text-sky-600">Try adjusting your search query</p>
			</div>
		</div>
	</div>
{:else}
	<!-- Event list -->
	<div class="space-y-4" in:fade={{ duration: 200 }}>
		<div class="flex items-center justify-between">
			<p class="text-sm text-sky-600">
				{$filteredEvents.length} event{$filteredEvents.length === 1 ? '' : 's'} found
				{#if $selectedEventIds.size > 0}
					<span class="ml-2 text-sky-500">({$selectedEventIds.size} selected)</span>
				{/if}
			</p>
			<button
				type="button"
				onclick={() => (isAllSelected() ? clearSelections() : selectAll())}
				class="text-sm text-sky-500 hover:text-sky-600 hover:underline"
			>
				{isAllSelected() ? 'Select None' : 'Select All'}
			</button>
		</div>
		<div class="space-y-3">
			{#each $filteredEvents as event, index (event.eventNumber + '-' + event.heatNumber + '-' + event.lane)}
				<div in:fade={{ duration: 150, delay: index * 30 }}>
					<EventCard
						{event}
						selected={$selectedEventIds.has(index)}
						onToggle={() => toggleEventSelection(index)}
					/>
				</div>
			{/each}
		</div>
	</div>
{/if}
