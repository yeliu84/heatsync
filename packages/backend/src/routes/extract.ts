import { Hono } from "hono";
import { renderPdfToImages } from "@heatsync/backend/services/pdf";
import { extractFromImages } from "@heatsync/backend/services/openai";
import type { ExtractResponse, ExtractErrorResponse } from "@heatsync/shared";

export const extractRoutes = new Hono();

/**
 * Extract swim meet data from an uploaded PDF
 * POST /extract
 *
 * Request: multipart/form-data with "pdf" file field
 * Response: ExtractionResult JSON
 */
extractRoutes.post("/", async (c) => {
  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get("pdf");

    if (!file || !(file instanceof File)) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "No PDF file provided",
        details: 'Expected multipart/form-data with a "pdf" file field',
      };
      return c.json(errorResponse, 400);
    }

    // Validate file type
    if (file.type !== "application/pdf") {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "Invalid file type",
        details: `Expected application/pdf, got ${file.type}`,
      };
      return c.json(errorResponse, 400);
    }

    console.log(`Processing PDF: ${file.name} (${file.size} bytes)`);

    // Convert PDF to ArrayBuffer
    const buffer = await file.arrayBuffer();

    // Render PDF pages to images
    console.log("Rendering PDF to images...");
    const { images, pageCount } = await renderPdfToImages(buffer);
    console.log(`Rendered ${images.length} pages`);

    // Extract data using AI with optimized settings
    console.log("Extracting data with AI...");
    const extractionResult = await extractFromImages(images, {
      detail: "low",
      batchSize: 5,
    });
    console.log(
      `Extracted ${extractionResult.events.length} events from ${extractionResult.meetName}`,
    );

    const response: ExtractResponse = {
      success: true,
      data: extractionResult,
      pageCount,
    };

    return c.json(response);
  } catch (error) {
    console.error("Extraction error:", error);

    const errorResponse: ExtractErrorResponse = {
      success: false,
      error: "Extraction failed",
      details: error instanceof Error ? error.message : "Unknown error",
    };

    return c.json(errorResponse, 500);
  }
});
