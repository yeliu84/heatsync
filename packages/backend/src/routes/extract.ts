import { Hono } from "hono";
import { extractFromPdf } from "@heatsync/backend/services/openai";
import type { ExtractResponse, ExtractErrorResponse } from "@heatsync/shared";

export const extractRoutes = new Hono();

/**
 * Extract swim meet data for a specific swimmer from an uploaded PDF
 * POST /extract
 *
 * Request: multipart/form-data with:
 *   - "pdf": PDF file
 *   - "swimmer": Swimmer name to search for
 * Response: ExtractionResult JSON
 */
extractRoutes.post("/", async (c) => {
  try {
    // Parse multipart form data
    const formData = await c.req.formData();
    const file = formData.get("pdf");
    const swimmerName = formData.get("swimmer");

    if (!file || !(file instanceof File)) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "No PDF file provided",
        details: 'Expected multipart/form-data with a "pdf" file field',
      };
      return c.json(errorResponse, 400);
    }

    if (!swimmerName || typeof swimmerName !== "string") {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "No swimmer name provided",
        details: 'Expected multipart/form-data with a "swimmer" field',
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
    console.log(`Looking for swimmer: ${swimmerName}`);

    // Convert to ArrayBuffer and upload directly to OpenAI
    const buffer = await file.arrayBuffer();

    console.log("Uploading PDF to OpenAI...");
    const extractionResult = await extractFromPdf(buffer, swimmerName);

    console.log(`Found ${extractionResult.events.length} events for ${swimmerName}`);

    const response: ExtractResponse = {
      success: true,
      data: extractionResult,
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
