<script lang="ts">
	import { searchQuery } from '$lib/stores/extraction';

	interface Props {
		disabled?: boolean;
	}

	let { disabled = false }: Props = $props();

	function handleInput(event: Event) {
		const target = event.target as HTMLInputElement;
		searchQuery.set(target.value);
	}
</script>

<div class="space-y-2">
	<label for="swimmer-search" class="block text-base font-medium text-sky-900">
		Find Your Swimmer
	</label>
	<div class="relative">
		<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
			<svg
				class="h-5 w-5 {disabled ? 'text-sky-200' : 'text-sky-400'}"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
		</div>
		<input
			id="swimmer-search"
			type="text"
			placeholder={disabled ? 'Upload a heat sheet first...' : 'Search by name, team, or event...'}
			value={$searchQuery}
			oninput={handleInput}
			{disabled}
			class="w-full rounded-lg border py-4 pr-4 pl-10 text-lg transition-colors
				{disabled
				? 'cursor-not-allowed border-sky-100 bg-sky-50 text-sky-300 placeholder-sky-200'
				: 'border-sky-200 bg-white text-sky-900 placeholder-sky-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none'}"
		/>
	</div>
	{#if disabled}
		<p class="text-sm text-sky-400">Search will be available after processing</p>
	{/if}
</div>
