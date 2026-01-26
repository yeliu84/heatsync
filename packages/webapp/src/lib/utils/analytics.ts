// Type-safe Umami event tracking
// Umami is privacy-focused: no cookies, no personal data, GDPR compliant
// Type declaration: src/types/umami.d.ts

/**
 * Track a custom event with optional data.
 * Fails silently if Umami is blocked or not loaded.
 */
export const trackEvent = (name: string, data?: Record<string, string | number>): void => {
  if (typeof window !== 'undefined' && window.umami) {
    window.umami.track(name, data);
  }
};

// Specific event helpers for type safety and consistency

export const trackExtractionStarted = (method: 'pdf' | 'url'): void => {
  trackEvent('extraction_started', { method });
};

export const trackExtractionSuccess = (eventCount: number): void => {
  trackEvent('extraction_success', { eventCount });
};

export const trackExtractionFailed = (error: string): void => {
  // Truncate error to avoid sending sensitive/long error messages
  trackEvent('extraction_failed', { error: error.slice(0, 50) });
};

export const trackExportClicked = (eventCount: number): void => {
  trackEvent('export_clicked', { eventCount });
};
