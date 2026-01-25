/**
 * Individual swimmer entry in a heat sheet
 */
export interface SwimEvent {
	eventNumber: number;
	eventName: string; // e.g., "Girls 11-12 100 Freestyle"
	heatNumber: number;
	lane: number;
	swimmerName: string;
	team?: string;
	seedTime?: string; // e.g., "1:05.32" or "NT"
	heatStartTime?: string; // "HH:MM" 24-hour format
}

/**
 * Full extraction response from AI processing
 */
export interface ExtractionResult {
	meetName: string;
	sessionDate: Date; // Calculated from meet start date + session weekday
	meetDateRange?: {
		// Optional full meet date range
		start: Date;
		end: Date;
	};
	venue?: string;
	events: SwimEvent[];
	warnings?: string[]; // e.g., "Could not parse times for Event 5"
}

/**
 * Calendar event format for export
 */
export interface CalendarEvent {
	title: string; // e.g., "Event 12: 100 Free - Heat 3, Lane 4"
	startTime: Date;
	reminderMinutes: 5 | 10 | 15;
	description: string; // Full details
	location?: string;
}

/**
 * Application workflow states
 */
export type AppState = 'upload' | 'extracting' | 'search' | 'export';

/**
 * Uploaded PDF file with metadata
 */
export interface UploadedPdf {
	file: File;
	name: string;
	size: number;
	uploadedAt: Date;
}

/**
 * API request/response types for backend communication
 */
export interface ExtractRequest {
	/** PDF file as multipart/form-data */
}

export interface ExtractUrlRequest {
	url: string;
}

export interface ExtractResponse {
	success: true;
	data: ExtractionResult;
	pageCount?: number;
}

export interface ExtractErrorResponse {
	success: false;
	error: string;
	details?: string;
}

export type ApiResponse<T> = { success: true; data: T } | ExtractErrorResponse;
