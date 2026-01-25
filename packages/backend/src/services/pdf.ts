import * as mupdf from "mupdf";

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
export const renderPdfToImages = (
  buffer: ArrayBuffer,
  scale: number = DEFAULT_SCALE
): string[] => {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();

  const images: string[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const matrix = mupdf.Matrix.scale(scale, scale);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB);
    const pngBuffer = pixmap.asPNG();
    const base64 = Buffer.from(pngBuffer).toString("base64");
    images.push(`data:image/png;base64,${base64}`);
  }

  return images;
};
