import * as mupdf from 'mupdf';

/**
 * Default scale factor for rendering (2.0 = 144 DPI)
 */
const DEFAULT_SCALE = 2.0;

/**
 * Render a PDF document to PNG images
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @param scale - Scale factor for rendering (default: 2.0)
 * @returns Array of base64 PNG data URLs
 */
export const renderPdfToImages = (buffer: ArrayBuffer, scale: number = DEFAULT_SCALE): string[] => {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  const pageCount = doc.countPages();

  const images: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const matrix = mupdf.Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB);
    const pngBuffer = pixmap.asPNG();
    const base64 = Buffer.from(pngBuffer).toString('base64');
    images.push(`data:image/png;base64,${base64}`);
  }

  return images;
};

/**
 * Extract text from all pages of a PDF document
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @returns Concatenated text from all pages, or empty string if extraction fails
 */
export const extractTextFromPdf = (buffer: ArrayBuffer): string => {
  try {
    const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
    const pageCount = doc.countPages();
    const texts: string[] = [];

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      // Use toStructuredText().asText() for plain text extraction
      const text = page.toStructuredText('preserve-whitespace').asText();
      texts.push(text);
    }

    return texts.join('\n\n');
  } catch (error) {
    console.error('[PDF] Text extraction failed:', error);
    return '';
  }
};

/**
 * Result from counting swimmer occurrences
 */
export interface SwimmerOccurrenceResult {
  count: number;      // Total number of occurrences
  pages: number[];    // Page numbers (0-indexed) where swimmer was found
}

/**
 * Normalize swimmer name to "Last, First" format for heat sheet matching
 */
const normalizeToLastFirst = (name: string): string => {
  const trimmed = name.trim();

  if (trimmed.includes(',')) {
    // Already "Last, First" format
    return trimmed;
  }

  // "First Last" format - convert to "Last, First"
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts.slice(0, -1).join(' ');
    const last = parts[parts.length - 1];
    return `${last}, ${first}`;
  }

  return trimmed;
};

/**
 * Count how many times a swimmer appears in the PDF text
 *
 * Heat sheets typically use "Last, First" format. This function handles
 * both "First Last" and "Last, First" input formats by normalizing to
 * "Last, First" for matching.
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @param swimmerName - Swimmer name in either format
 * @returns Count of occurrences and page numbers where found
 */
export const countSwimmerOccurrences = (
  buffer: ArrayBuffer,
  swimmerName: string,
): SwimmerOccurrenceResult => {
  try {
    const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
    const pageCount = doc.countPages();

    // Normalize name to "Last, First" format (as used in heat sheets)
    const lastFirstName = normalizeToLastFirst(swimmerName);

    // Deduplicate search patterns (in case input was already "Last, First" format)
    const searchPatterns = [...new Set([
      lastFirstName.toLowerCase(),
      swimmerName.toLowerCase(),
    ])];

    let count = 0;
    const pages: number[] = [];

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      const text = page.toStructuredText('preserve-whitespace').asText().toLowerCase();

      let foundOnPage = false;
      for (const pattern of searchPatterns) {
        // Count occurrences of the pattern on this page
        let index = 0;
        while ((index = text.indexOf(pattern, index)) !== -1) {
          if (!foundOnPage) {
            foundOnPage = true;
            pages.push(i);
          }
          count++;
          index += pattern.length;
        }
      }
    }

    return { count, pages };
  } catch (error) {
    console.error('[PDF] Swimmer count failed:', error);
    return { count: 0, pages: [] };
  }
};
