import * as mupdf from "mupdf";
import type { PdfRenderOptions, PdfRenderResult } from "@heatsync/backend/types";

/**
 * Default scale factor for rendering (2.0 = 144 DPI, good balance of quality/size)
 */
const DEFAULT_SCALE = 2.0;

/**
 * Render a PDF document to PNG images
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @param options - Rendering options
 * @returns Array of base64 PNG data URLs
 */
export const renderPdfToImages = async (
	buffer: ArrayBuffer,
	options: PdfRenderOptions = {}
): Promise<PdfRenderResult> => {
	const { scale = DEFAULT_SCALE, maxPages } = options;

	// Open the PDF document
	const doc = mupdf.Document.openDocument(buffer, "application/pdf");
	const pageCount = doc.countPages();
	const pagesToRender = maxPages ? Math.min(pageCount, maxPages) : pageCount;

	// Create array of page indices for parallel processing
	const pageIndices = Array.from({ length: pagesToRender }, (_, i) => i);

	// Render all pages in parallel
	const images = await Promise.all(
		pageIndices.map(async (i) => {
			const page = doc.loadPage(i);

			// Create transformation matrix with scale
			const matrix = mupdf.Matrix.scale(scale, scale);

			// Render page to pixmap (RGB)
			const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB);

			// Convert to PNG buffer
			const pngBuffer = pixmap.asPNG();

			// Convert to base64 data URL
			const base64 = Buffer.from(pngBuffer).toString("base64");
			return `data:image/png;base64,${base64}`;
		})
	);

	return {
		images,
		pageCount,
	};
};

/**
 * Get page count from a PDF without rendering
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @returns Number of pages in the PDF
 */
export const getPdfPageCount = (buffer: ArrayBuffer): number => {
	const doc = mupdf.Document.openDocument(buffer, "application/pdf");
	return doc.countPages();
};
