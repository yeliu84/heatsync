// Umami Analytics global type declaration
// https://umami.is/docs/tracker-functions

interface UmamiTracker {
  track: (eventName: string, eventData?: Record<string, string | number>) => void;
}

declare global {
  interface Window {
    umami?: UmamiTracker;
  }
}

export {};
