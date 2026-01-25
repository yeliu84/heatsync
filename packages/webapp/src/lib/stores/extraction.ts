import { writable, derived } from 'svelte/store';
import type { AppState, ExtractionResult, UploadedPdf } from '$lib/types';

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
 * Derived store: events filtered by search query
 */
export const filteredEvents = derived(
	[extractionResult, searchQuery],
	([$extractionResult, $searchQuery]) => {
		if (!$extractionResult) return [];

		const query = $searchQuery.toLowerCase().trim();
		if (!query) return $extractionResult.events;

		return $extractionResult.events.filter(
			(event) =>
				event.swimmerName.toLowerCase().includes(query) ||
				event.team?.toLowerCase().includes(query) ||
				event.eventName.toLowerCase().includes(query)
		);
	}
);

/**
 * Derived store: selected events as array
 */
export const selectedEvents = derived(
	[extractionResult, selectedEventIds],
	([$extractionResult, $selectedEventIds]) => {
		if (!$extractionResult) return [];

		return $extractionResult.events.filter((_, index) => $selectedEventIds.has(index));
	}
);

/**
 * Reset all stores to initial state
 */
export function resetStores(): void {
	appState.set('upload');
	uploadedPdf.set(null);
	swimmerName.set('');
	extractionResult.set(null);
	selectedEventIds.set(new Set());
	searchQuery.set('');
}

/**
 * Toggle event selection
 */
export function toggleEventSelection(eventIndex: number): void {
	selectedEventIds.update((ids) => {
		const newIds = new Set(ids);
		if (newIds.has(eventIndex)) {
			newIds.delete(eventIndex);
		} else {
			newIds.add(eventIndex);
		}
		return newIds;
	});
}

/**
 * Select all events matching current search
 */
export function selectAllFiltered(eventIndices: number[]): void {
	selectedEventIds.update((ids) => {
		const newIds = new Set(ids);
		eventIndices.forEach((i) => newIds.add(i));
		return newIds;
	});
}

/**
 * Clear all selections
 */
export function clearSelections(): void {
	selectedEventIds.set(new Set());
}
