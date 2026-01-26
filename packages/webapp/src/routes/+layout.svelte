<script lang="ts">
  import './layout.css';
  import Toast from '$lib/components/Toast.svelte';

  let { children } = $props();
</script>

<svelte:head>
  <title>HeatSync - Swim Meet Heat Sheet to Calendar</title>
  <meta
    name="description"
    content="Convert swim meet heat sheets into calendar events. Upload a PDF, find your swimmer, sync to your calendar."
  />
</svelte:head>

<div class="flex min-h-screen flex-col bg-gradient-to-b from-sky-50/30 to-white">
  <main class="mx-auto w-full max-w-2xl flex-1 px-4 pb-8 sm:px-6">
    {@render children()}
  </main>
  <footer class="mt-auto border-t border-sky-100 py-4">
    <div
      class="mx-auto flex max-w-2xl items-center justify-center gap-4 px-4 text-sm text-sky-400 sm:px-6"
    >
      <a href="/help" class="hover:text-sky-600 hover:underline">Help & FAQ</a>
      <span>•</span>
      <span>HeatSync</span>
    </div>
  </footer>
</div>

<Toast />
