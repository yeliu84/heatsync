<script lang="ts">
  import HeatSheetForm from '$lib/components/HeatSheetForm.svelte';
</script>

<!-- Hero Header -->
<header class="pt-8 text-center sm:pt-12">
  <h1 class="text-3xl font-bold tracking-tight text-sky-900 sm:text-5xl">HeatSync</h1>
  <p class="mt-2 text-lg text-sky-600 sm:mt-3 sm:text-xl">Heat Sheet → Calendar</p>
  <p class="mt-1 text-xs text-sky-400 sm:mt-2 sm:text-sm">Never miss a race again</p>
</header>

<!-- Main content -->
<div class="mt-8 space-y-12 sm:mt-16">
  <section>
    <HeatSheetForm />
  </section>
</div>
