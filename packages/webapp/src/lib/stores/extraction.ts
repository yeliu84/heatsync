import { writable, derived } from 'svelte/store';
import type { AppState, ExtractionResult, UploadedPdf, SwimEvent } from '$lib/types';

/**
 * Special result code used when database is not configured.
 * Results are stored in localExtractionResult instead of the database.
 */
export const LOCAL_RESULT_CODE = '-----';

/**
 * Temporary storage for extraction result when database is not configured.
 * Used to pass data to result page via client-side navigation.
 */
export const localExtractionResult = writable<ExtractionResult | null>(null);

/**
 * Unique swimmer profile for disambiguation
 * When multiple swimmers share the same name, we use team + age to differentiate
 */
export interface SwimmerProfile {
  swimmerName: string;
  team?: string;
  age?: number;
  key: string; // Unique identifier: "name|team|age"
}

/**
 * Current application workflow state
 */
export const appState = writable<AppState>('upload');

/**
 * Currently uploaded PDF file
 */
export const uploadedPdf = writable<UploadedPdf | null>(null);

/**
 * Swimmer name to search for in the heat sheet
 */
export const swimmerName = writable<string>('');

/**
 * Extraction result from AI processing
 */
export const extractionResult = writable<ExtractionResult | null>(null);

/**
 * Selected events for calendar export (by index)
 */
export const selectedEventIds = writable<Set<number>>(new Set());

/**
 * Search query for filtering swimmers
 */
export const searchQuery = writable<string>('');

/**
 * Currently selected swimmer profile for disambiguation
 * null means no profile selected (show all events)
 */
export const selectedProfile = writable<SwimmerProfile | null>(null);

/**
 * Derived store: unique swimmer profiles from extraction result
 * Used for disambiguation when multiple swimmers share the same name
 */
export const swimmerProfiles = derived(extractionResult, ($result): SwimmerProfile[] => {
  if (!$result) return [];

  const profileMap = new Map<string, SwimmerProfile>();
  for (const event of $result.events) {
    const key = `${event.swimmerName}|${event.team || ''}|${event.age || ''}`;
    if (!profileMap.has(key)) {
      profileMap.set(key, {
        swimmerName: event.swimmerName,
        team: event.team,
        age: event.age,
        key,
      });
    }
  }
  return Array.from(profileMap.values());
});

/**
 * Derived store: whether disambiguation is needed (multiple profiles with same name)
 */
export const needsDisambiguation = derived(
  swimmerProfiles,
  ($profiles): boolean => $profiles.length > 1,
);

/**
 * Derived store: events filtered by selected profile
 * Returns all events if no profile is selected
 */
export const profileFilteredEvents = derived(
  [extractionResult, selectedProfile],
  ([$result, $profile]): SwimEvent[] => {
    if (!$result) return [];
    if (!$profile) return $result.events;

    return $result.events.filter(
      (event) =>
        event.swimmerName === $profile.swimmerName &&
        event.team === $profile.team &&
        event.age === $profile.age,
    );
  },
);

/**
 * Derived store: events filtered by search query (applied on top of profile filter)
 */
export const filteredEvents = derived(
  [profileFilteredEvents, searchQuery],
  ([$profileFilteredEvents, $searchQuery]): SwimEvent[] => {
    const query = $searchQuery.toLowerCase().trim();
    if (!query) return $profileFilteredEvents;

    return $profileFilteredEvents.filter(
      (event) =>
        event.swimmerName.toLowerCase().includes(query) ||
        event.team?.toLowerCase().includes(query) ||
        event.eventName.toLowerCase().includes(query),
    );
  },
);

/**
 * Derived store: selected events as array
 */
export const selectedEvents = derived(
  [extractionResult, selectedEventIds],
  ([$extractionResult, $selectedEventIds]) => {
    if (!$extractionResult) return [];

    return $extractionResult.events.filter((_, index) => $selectedEventIds.has(index));
  },
);

/**
 * Reset all stores to initial state
 */
export const resetStores = (): void => {
  appState.set('upload');
  uploadedPdf.set(null);
  swimmerName.set('');
  extractionResult.set(null);
  selectedEventIds.set(new Set());
  searchQuery.set('');
  selectedProfile.set(null);
  localExtractionResult.set(null);
};

/**
 * Reset stores for a new search, preserving swimmer name.
 * Used when clicking "Start New Search" on result page.
 */
export const resetForNewSearch = (): void => {
  appState.set('upload');
  uploadedPdf.set(null);
  // swimmerName is preserved
  extractionResult.set(null);
  selectedEventIds.set(new Set());
  searchQuery.set('');
  selectedProfile.set(null);
  localExtractionResult.set(null);
};

/**
 * Toggle event selection
 */
export const toggleEventSelection = (eventIndex: number): void => {
  selectedEventIds.update((ids) => {
    const newIds = new Set(ids);
    if (newIds.has(eventIndex)) {
      newIds.delete(eventIndex);
    } else {
      newIds.add(eventIndex);
    }
    return newIds;
  });
};

/**
 * Select all events matching current search
 */
export const selectAllFiltered = (eventIndices: number[]): void => {
  selectedEventIds.update((ids) => {
    const newIds = new Set(ids);
    eventIndices.forEach((i) => newIds.add(i));
    return newIds;
  });
};

/**
 * Clear all selections
 */
export const clearSelections = (): void => {
  selectedEventIds.set(new Set());
};

/**
 * Select all events (used for initial auto-selection)
 */
export const selectAllEvents = (count: number): void => {
  const indices = Array.from({ length: count }, (_, i) => i);
  selectedEventIds.set(new Set(indices));
};
