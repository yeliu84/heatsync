<script lang="ts">
	import { toasts, type Toast } from '$lib/stores/toast';
	import { fly, fade } from 'svelte/transition';

	const getIcon = (type: Toast['type']): string => {
		switch (type) {
			case 'success':
				return '✓';
			case 'error':
				return '✕';
			case 'warning':
				return '⚠';
			case 'info':
				return 'ℹ';
		}
	};

	const getStyles = (type: Toast['type']): string => {
		switch (type) {
			case 'success':
				return 'bg-green-50 border-green-200 text-green-800';
			case 'error':
				return 'bg-red-50 border-red-200 text-red-800';
			case 'warning':
				return 'bg-amber-50 border-amber-200 text-amber-800';
			case 'info':
				return 'bg-sky-50 border-sky-200 text-sky-800';
		}
	};

	const getIconStyles = (type: Toast['type']): string => {
		switch (type) {
			case 'success':
				return 'bg-green-100 text-green-600';
			case 'error':
				return 'bg-red-100 text-red-600';
			case 'warning':
				return 'bg-amber-100 text-amber-600';
			case 'info':
				return 'bg-sky-100 text-sky-600';
		}
	};
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4">
	{#each $toasts as toast (toast.id)}
		<div
			class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg {getStyles(toast.type)}"
			in:fly={{ y: 50, duration: 200 }}
			out:fade={{ duration: 150 }}
			role="alert"
		>
			<div class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold {getIconStyles(toast.type)}">
				{getIcon(toast.type)}
			</div>
			<p class="flex-1 text-sm font-medium">{toast.message}</p>
			<button
				type="button"
				onclick={() => toasts.remove(toast.id)}
				class="flex-shrink-0 rounded p-1 opacity-60 transition-opacity hover:opacity-100"
				aria-label="Dismiss notification"
			>
				<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/each}
</div>
