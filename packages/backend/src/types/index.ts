/**
 * Backend-specific types
 */

/**
 * Configuration for the backend server
 */
export interface ServerConfig {
	port: number;
	openai: {
		apiKey: string;
		baseUrl: string;
		model: string;
	};
}

/**
 * PDF rendering options
 */
export interface PdfRenderOptions {
	/** Scale factor for rendering (default: 2.0 for good quality) */
	scale?: number;
	/** Maximum number of pages to render (default: no limit) */
	maxPages?: number;
}

/**
 * Result of PDF to image conversion
 */
export interface PdfRenderResult {
	images: string[]; // base64 data URLs
	pageCount: number;
}
