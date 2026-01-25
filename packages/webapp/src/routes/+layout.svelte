<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>HeatSync - Swim Meet Heat Sheet to Calendar</title>
	<meta
		name="description"
		content="Convert swim meet heat sheets into calendar events. Upload a PDF, find your swimmer, sync to your calendar."
	/>
</svelte:head>

<div class="min-h-screen bg-gradient-to-b from-sky-50/30 to-white">
	<main class="mx-auto w-full max-w-2xl px-6 pb-16">
		{@render children()}
	</main>
</div>
