<script lang="ts">
	import type { SwimEvent } from '$lib/types';

	interface Props {
		event: SwimEvent;
		selected?: boolean;
		onToggle?: () => void;
	}

	let { event, selected = false, onToggle }: Props = $props();

	function formatSeedTime(time?: string): string {
		if (!time) return 'NT';
		return time;
	}

	/**
	 * Convert 24-hour format "HH:MM" to 12-hour format "H:MM AM/PM"
	 */
	function formatHeatTime(time24?: string): string {
		if (!time24) return '';
		const [hourStr, minute] = time24.split(':');
		const hour = parseInt(hourStr, 10);
		const period = hour >= 12 ? 'PM' : 'AM';
		const hour12 = hour % 12 || 12;
		return `${hour12}:${minute} ${period}`;
	}
</script>

<button
	type="button"
	onclick={onToggle}
	class="w-full rounded-lg border p-4 text-left transition-all duration-200
		{selected
		? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/20'
		: 'border-sky-200 bg-white hover:border-sky-300 hover:bg-sky-50/50'}"
>
	<div class="flex items-start justify-between gap-3">
		<div class="flex-1">
			<div class="flex items-center gap-2">
				<span class="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
					Event {event.eventNumber}
				</span>
				<span class="text-xs text-sky-500">
					Heat {event.heatNumber} | Lane {event.lane}
					{#if event.heatStartTime}
						| {formatHeatTime(event.heatStartTime)}
					{/if}
				</span>
			</div>
			<h3 class="mt-2 truncate font-medium text-sky-900">
				{event.swimmerName}
				{#if event.team || event.age}
					<span class="text-sm font-normal text-sky-400">({#if event.team}{event.team}{/if}{#if event.team && event.age},&nbsp;{/if}{#if event.age}{event.age}{/if})</span>
				{/if}
			</h3>
			<p class="truncate text-sm text-sky-600">{event.eventName}</p>
		</div>
		<div class="flex flex-col items-end gap-2">
			<div
				class="flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors
					{selected ? 'border-sky-500 bg-sky-500' : 'border-sky-300'}"
			>
				{#if selected}
					<svg class="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5 13l4 4L19 7"
						/>
					</svg>
				{/if}
			</div>
			<span class="font-mono text-sm text-sky-600">{formatSeedTime(event.seedTime)}</span>
		</div>
	</div>
</button>
