import { createEvents, type EventAttributes, type DateArray } from 'ics';
import type { SwimEvent, ExtractionResult } from '$lib/types';

export interface CalendarExportOptions {
  events: SwimEvent[];
  extractionResult: ExtractionResult;
  reminderMinutes: 5 | 10 | 15;
}

export interface CalendarGenerationResult {
  success: boolean;
  icsContent?: string;
  filename?: string;
  skippedCount: number;
  error?: string;
}

/**
 * Convert a Date to ics DateArray format [year, month, day, hour, minute]
 * Note: ics library uses 1-indexed months (1=Jan), matching Date's getMonth() + 1
 */
const dateToArray = (date: Date): DateArray => [
  date.getFullYear(),
  date.getMonth() + 1, // Convert 0-indexed to 1-indexed
  date.getDate(),
  date.getHours(),
  date.getMinutes(),
];

/**
 * Combine a session date with a "HH:MM" time string to create a full Date
 * Returns null if the time string is invalid
 *
 * Note: sessionDate is typically a UTC timestamp (e.g., "2026-01-18T00:00:00Z").
 * We extract the date components using UTC methods to preserve the intended date,
 * then combine with the local time. This prevents timezone shifts where
 * "Jan 18 midnight UTC" becomes "Jan 17 4pm Pacific".
 */
const combineDateTime = (sessionDate: Date, heatStartTime: string): Date | null => {
  const match = heatStartTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  // Parse sessionDate - handle both Date objects and ISO strings
  const dateObj = new Date(sessionDate);

  // Extract date components in UTC to avoid timezone shift
  const year = dateObj.getUTCFullYear();
  const month = dateObj.getUTCMonth();
  const day = dateObj.getUTCDate();

  // Create a new Date with UTC date components + local time
  // This ensures "Jan 18" stays "Jan 18" regardless of local timezone
  return new Date(year, month, day, hours, minutes, 0, 0);
};

/**
 * Generate a URL-safe filename slug from text
 */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);

/**
 * Format event title: "Elsa Liu - E12 H3 L4 - 100 Free"
 */
const formatEventTitle = (event: SwimEvent): string => {
  // Extract short event name (e.g., "100 Free" from "Girls 11-12 100 Freestyle")
  const shortName = event.eventName
    .replace(/^(Girls|Boys|Mixed)\s+\d+-\d+\s+/i, '')
    .replace(/^(Girls|Boys|Mixed)\s+/i, '')
    .replace(/style$/i, '');

  return `${event.swimmerName} - E${event.eventNumber} H${event.heatNumber} L${event.lane} - ${shortName.trim()}`;
};

/**
 * Format event description with swimmer details, meet info
 */
const formatEventDescription = (event: SwimEvent, meetName: string, venue?: string): string => {
  const lines: string[] = [];

  // Swimmer info
  const swimmerParts = [event.swimmerName];
  if (event.team) swimmerParts.push(event.team);
  if (event.age) swimmerParts.push(`Age ${event.age}`);
  lines.push(`Swimmer: ${swimmerParts.join(', ')}`);

  // Seed time
  if (event.seedTime) {
    lines.push(`Seed Time: ${event.seedTime}`);
  }

  // Event details
  lines.push(`Event: ${event.eventName}`);
  lines.push(`Heat ${event.heatNumber}, Lane ${event.lane}`);

  // Meet info
  lines.push('');
  lines.push(`Meet: ${meetName}`);
  if (venue) {
    lines.push(`Venue: ${venue}`);
  }

  return lines.join('\n');
};

/**
 * Convert a SwimEvent to an ics EventAttributes object
 * Returns null if the event lacks a valid heatStartTime
 */
const swimEventToCalendarEvent = (
  event: SwimEvent,
  extractionResult: ExtractionResult,
  reminderMinutes: number,
): EventAttributes | null => {
  if (!event.heatStartTime) return null;

  const startDate = combineDateTime(extractionResult.sessionDate, event.heatStartTime);
  if (!startDate) return null;

  return {
    title: formatEventTitle(event),
    description: formatEventDescription(event, extractionResult.meetName, extractionResult.venue),
    location: extractionResult.venue,
    start: dateToArray(startDate),
    duration: { minutes: 10 },
    alarms: [
      {
        action: 'display',
        description: 'Event reminder',
        trigger: { before: true, minutes: reminderMinutes },
      },
    ],
  };
};

/**
 * Generate an ICS file from selected swim events
 */
export const generateCalendarEvents = (
  options: CalendarExportOptions,
): CalendarGenerationResult => {
  const { events, extractionResult, reminderMinutes } = options;

  if (events.length === 0) {
    return {
      success: false,
      skippedCount: 0,
      error: 'No events selected for export',
    };
  }

  // Convert events, tracking skipped ones
  const calendarEvents: EventAttributes[] = [];
  let skippedCount = 0;

  for (const event of events) {
    const calEvent = swimEventToCalendarEvent(event, extractionResult, reminderMinutes);
    if (calEvent) {
      calendarEvents.push(calEvent);
    } else {
      skippedCount++;
    }
  }

  if (calendarEvents.length === 0) {
    return {
      success: false,
      skippedCount,
      error: 'No events have valid start times',
    };
  }

  // Generate ICS content
  const { error, value } = createEvents(calendarEvents);

  if (error || !value) {
    return {
      success: false,
      skippedCount,
      error: error?.message || 'Failed to generate calendar file',
    };
  }

  // Generate filename: heatsync-{meet-name}-{swimmer-name}.ics
  const swimmerName = events[0]?.swimmerName || 'events';
  const filename = `heatsync-${slugify(extractionResult.meetName)}-${slugify(swimmerName)}.ics`;

  return {
    success: true,
    icsContent: value,
    filename,
    skippedCount,
  };
};

/**
 * Trigger a browser download of the ICS file
 */
export const downloadIcsFile = (content: string, filename: string): void => {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};
