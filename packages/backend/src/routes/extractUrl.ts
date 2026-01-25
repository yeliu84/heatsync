import { Hono } from "hono";
import { extractFromPdf } from "@heatsync/backend/services/openai";
import type {
  ExtractResponse,
  ExtractErrorResponse,
} from "@heatsync/shared";

export const extractUrlRoutes = new Hono();

interface ExtractUrlRequestBody {
  url: string;
  swimmer: string;
}

/**
 * Extract swim meet data for a specific swimmer from a PDF URL
 * POST /extractUrl
 *
 * Request: JSON { url: string, swimmer: string }
 * Response: ExtractionResult JSON
 */
extractUrlRoutes.post("/", async (c) => {
  try {
    // Parse request body
    const body = await c.req.json<ExtractUrlRequestBody>();

    if (!body.url) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "No URL provided",
        details: 'Expected JSON body with "url" field',
      };
      return c.json(errorResponse, 400);
    }

    if (!body.swimmer) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "No swimmer name provided",
        details: 'Expected JSON body with "swimmer" field',
      };
      return c.json(errorResponse, 400);
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(body.url);
    } catch {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "Invalid URL format",
        details: "Please provide a valid URL",
      };
      return c.json(errorResponse, 400);
    }

    // Only allow http/https protocols
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "Invalid URL protocol",
        details: "Only HTTP and HTTPS URLs are supported",
      };
      return c.json(errorResponse, 400);
    }

    console.log(`Downloading PDF from: ${body.url}`);
    console.log(`Looking for swimmer: ${body.swimmer}`);

    // Download the PDF
    const response = await fetch(body.url, {
      headers: {
        "User-Agent": "HeatSync/1.0",
      },
    });

    if (!response.ok) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "Failed to download PDF",
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
      return c.json(errorResponse, 400);
    }

    // Validate content type
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/pdf")) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: "URL does not point to a PDF",
        details: `Expected application/pdf, got ${contentType}`,
      };
      return c.json(errorResponse, 400);
    }

    // Get PDF content
    const buffer = await response.arrayBuffer();
    console.log(`Downloaded ${buffer.byteLength} bytes`);

    // Upload PDF directly to OpenAI for extraction
    console.log("Uploading PDF to OpenAI...");
    const extractionResult = await extractFromPdf(buffer, body.swimmer);
    console.log(
      `Found ${extractionResult.events.length} events for ${body.swimmer}`,
    );

    const apiResponse: ExtractResponse = {
      success: true,
      data: extractionResult,
    };

    return c.json(apiResponse);
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
