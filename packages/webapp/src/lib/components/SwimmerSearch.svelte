<script lang="ts">
  import {
    swimmerProfiles,
    needsDisambiguation,
    selectedProfile,
    type SwimmerProfile,
  } from '$lib/stores/extraction';

  /**
   * Format a swimmer profile for display: "Name, Team, Age"
   * Omits missing fields gracefully
   */
  const formatProfile = (p: SwimmerProfile): string => {
    const parts = [p.swimmerName];
    if (p.team) parts.push(p.team);
    if (p.age) parts.push(String(p.age));
    return parts.join(', ');
  };

  /**
   * Auto-select first profile when profiles change and none is selected
   */
  $effect(() => {
    if ($swimmerProfiles.length > 0 && !$selectedProfile) {
      selectedProfile.set($swimmerProfiles[0]);
    }
  });

  /**
   * Handle combobox selection change
   */
  const handleChange = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    const selectedKey = select.value;
    const profile = $swimmerProfiles.find((p) => p.key === selectedKey);
    selectedProfile.set(profile || null);
  };
</script>

{#if $needsDisambiguation}
  <div class="space-y-2">
    <label for="swimmer-select" class="block text-base font-medium text-sky-900">
      Select Swimmer
    </label>
    <div class="relative">
      <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <svg class="h-5 w-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      </div>
      <select
        id="swimmer-select"
        value={$selectedProfile?.key || ''}
        onchange={handleChange}
        class="w-full appearance-none rounded-lg border border-sky-200 bg-white py-4 pr-10 pl-10 text-lg text-sky-900 transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
      >
        {#each $swimmerProfiles as profile (profile.key)}
          <option value={profile.key}>{formatProfile(profile)}</option>
        {/each}
      </select>
      <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
        <svg class="h-5 w-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
    <p class="text-sm text-sky-600">
      Found {$swimmerProfiles.length} swimmers with this name
    </p>
  </div>
{/if}
