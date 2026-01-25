<script lang="ts">
	import { selectedEvents } from '$lib/stores/extraction';

	interface Props {
		disabled?: boolean;
	}

	let { disabled = false }: Props = $props();

	let reminderMinutes = $state<5 | 10 | 15>(10);

	function handleExport() {
		// Export will be implemented in Milestone 5
		console.log('Export clicked', { events: $selectedEvents, reminderMinutes });
	}
</script>

<div class="rounded-xl border border-sky-200 bg-white p-6">
	<h2 class="text-xl font-medium text-sky-900">Export to Calendar</h2>

	{#if disabled}
		<div class="mt-4">
			<p class="text-sm text-sky-500">Select events above to enable export</p>
			<button
				type="button"
				disabled
				class="mt-4 w-full cursor-not-allowed rounded-lg bg-sky-200 px-4 py-3 text-lg font-medium text-sky-400"
			>
				Download .ics File
			</button>
		</div>
	{:else}
		<div class="mt-4 space-y-4">
			<div>
				<label for="reminder" class="block text-sm font-medium text-sky-700">
					Reminder before event
				</label>
				<select
					id="reminder"
					bind:value={reminderMinutes}
					class="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sky-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
				>
					<option value={5}>5 minutes</option>
					<option value={10}>10 minutes</option>
					<option value={15}>15 minutes</option>
				</select>
			</div>

			<div class="rounded-lg bg-sky-50 p-3">
				<p class="text-sm text-sky-700">
					<span class="font-medium">{$selectedEvents.length}</span> event{$selectedEvents.length ===
					1
						? ''
						: 's'} will be exported
				</p>
			</div>

			<button
				type="button"
				onclick={handleExport}
				class="w-full rounded-lg bg-sky-500 px-4 py-3 text-lg font-medium text-white transition-colors hover:bg-sky-600"
			>
				Download .ics File
			</button>

			<p class="text-center text-xs text-sky-400">
				Works with Apple Calendar, Google Calendar, Outlook, and more
			</p>
		</div>
	{/if}
</div>
