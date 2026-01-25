import OpenAI from "openai";
import type { ExtractionResult, SwimEvent } from "@heatsync/shared";
import type { ExtractionOptions } from "@heatsync/backend/types";

/**
 * Extraction prompt for the AI model
 * Designed to extract swim meet data from heat sheet images
 */
const EXTRACTION_PROMPT = `You are extracting swim meet data from heat sheet images. Extract ALL swimmers and events visible.

Return a JSON object with this exact structure:
{
  "meetName": "string",
  "meetDate": "YYYY-MM-DD",
  "venue": "string or null",
  "events": [
    {
      "eventNumber": number,
      "eventName": "full event name",
      "heatNumber": number,
      "lane": number,
      "swimmerName": "First Last",
      "team": "team code or null",
      "seedTime": "MM:SS.ss or NT",
      "estimatedStartTime": "HH:MM or null"
    }
  ],
  "warnings": ["any issues encountered during extraction"]
}

Important:
- Extract EVERY swimmer from EVERY heat shown
- Normalize swimmer names to "First Last" format (capitalize properly)
- If seed time shows "NT", "NS", or is blank, use "NT"
- Event numbers are usually in the left margin or header
- Heat numbers appear above each heat block (e.g., "Heat 1 of 3")
- Lanes are typically numbered 1-8 or 1-10
- Estimated start times may appear at the top of each event
- If you cannot determine the meet date, use today's date
- Add any issues or uncertainties to the warnings array

Return ONLY valid JSON, no markdown formatting or explanation.`;

/**
 * Create OpenAI client from environment variables
 */
const createOpenAIClient = (): OpenAI => {
	const apiKey = process.env.OPENAI_API_KEY;
	const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

	if (!apiKey) {
		throw new Error("OPENAI_API_KEY environment variable is required");
	}

	return new OpenAI({
		apiKey,
		baseURL,
	});
};

/** Default batch size for parallel API calls */
const DEFAULT_BATCH_SIZE = 5;

/** Default detail level for images */
const DEFAULT_DETAIL: "low" | "high" = "low";

/** Maximum retry attempts for failed batches */
const MAX_RETRIES = 3;

/** Base delay between retries (ms) - exponential backoff will multiply this */
const RETRY_BASE_DELAY = 2000;

/**
 * Sleep for a given number of milliseconds
 */
const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extract data from a single batch of images with retry logic
 */
const extractBatch = async (
	openai: OpenAI,
	model: string,
	images: string[],
	batchIndex: number,
	detail: "low" | "high"
): Promise<ExtractionResult> => {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			if (attempt > 0) {
				const delay = RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
				console.log(
					`  Batch ${batchIndex + 1}: Retry ${attempt}/${MAX_RETRIES - 1} after ${delay}ms...`
				);
				await sleep(delay);
			}

			console.log(
				`  Batch ${batchIndex + 1}: Processing ${images.length} pages with detail="${detail}"...`
			);

			const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
				{ type: "text", text: EXTRACTION_PROMPT },
				...images.map(
					(img): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
						type: "image_url",
						image_url: { url: img, detail },
					})
				),
			];

			const response = await openai.chat.completions.create({
				model,
				messages: [{ role: "user", content }],
				response_format: { type: "json_object" },
				max_completion_tokens: 16000,
			});

			const responseText = response.choices[0]?.message?.content;

			if (!responseText) {
				throw new Error(`Empty response from AI model`);
			}

			const parsed = JSON.parse(responseText);

			console.log(
				`  Batch ${batchIndex + 1}: Extracted ${parsed.events?.length || 0} events`
			);

			return {
				meetName: parsed.meetName || "Unknown Meet",
				meetDate: new Date(parsed.meetDate || new Date().toISOString()),
				venue: parsed.venue || undefined,
				events: (parsed.events || []).map((event: Record<string, unknown>) => ({
					eventNumber: Number(event.eventNumber) || 0,
					eventName: String(event.eventName || "Unknown Event"),
					heatNumber: Number(event.heatNumber) || 0,
					lane: Number(event.lane) || 0,
					swimmerName: String(event.swimmerName || "Unknown"),
					team: event.team ? String(event.team) : undefined,
					seedTime: event.seedTime ? String(event.seedTime) : undefined,
					estimatedStartTime: event.estimatedStartTime
						? new Date(`1970-01-01T${event.estimatedStartTime}:00`)
						: undefined,
				})),
				warnings: parsed.warnings || undefined,
			};
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.error(
				`  Batch ${batchIndex + 1}: Attempt ${attempt + 1} failed: ${lastError.message}`
			);
		}
	}

	throw new Error(
		`Batch ${batchIndex + 1} failed after ${MAX_RETRIES} attempts: ${lastError?.message}`
	);
};

/**
 * Create a unique key for deduplication
 */
const eventKey = (event: SwimEvent): string =>
	`${event.eventNumber}-${event.heatNumber}-${event.lane}-${event.swimmerName}`;

/**
 * Aggregate results from multiple batches
 * - Takes meet info from the first batch (most likely to have title page info)
 * - Merges and deduplicates events by composite key
 * - Combines all warnings
 */
const aggregateBatchResults = (
	batchResults: ExtractionResult[]
): ExtractionResult => {
	if (batchResults.length === 0) {
		throw new Error("No batch results to aggregate");
	}

	// Use meet info from first batch (most likely to have complete info)
	const firstResult = batchResults[0];

	// Deduplicate events by composite key
	const eventMap = new Map<string, SwimEvent>();
	for (const result of batchResults) {
		for (const event of result.events) {
			const key = eventKey(event);
			if (!eventMap.has(key)) {
				eventMap.set(key, event);
			}
		}
	}

	// Sort events by eventNumber, then heatNumber, then lane
	const events = Array.from(eventMap.values()).sort((a, b) => {
		if (a.eventNumber !== b.eventNumber) return a.eventNumber - b.eventNumber;
		if (a.heatNumber !== b.heatNumber) return a.heatNumber - b.heatNumber;
		return a.lane - b.lane;
	});

	// Combine all warnings
	const allWarnings = batchResults
		.flatMap((r) => r.warnings || [])
		.filter((w, i, arr) => arr.indexOf(w) === i); // Dedupe

	return {
		meetName: firstResult.meetName,
		meetDate: firstResult.meetDate,
		venue: firstResult.venue,
		events,
		warnings: allWarnings.length > 0 ? allWarnings : undefined,
	};
};

/**
 * Extract swim meet data from heat sheet images using AI
 *
 * @param images - Array of base64 PNG data URLs
 * @param options - Extraction options (detail level, batch size)
 * @returns Parsed extraction result
 */
export const extractFromImages = async (
	images: string[],
	options: ExtractionOptions = {}
): Promise<ExtractionResult> => {
	const { detail = DEFAULT_DETAIL, batchSize = DEFAULT_BATCH_SIZE } = options;
	const openai = createOpenAIClient();
	const model = process.env.OPENAI_MODEL || "gpt-4o";

	// Split images into batches
	const batches: string[][] = [];
	for (let i = 0; i < images.length; i += batchSize) {
		batches.push(images.slice(i, i + batchSize));
	}

	console.log(
		`Processing ${images.length} pages in ${batches.length} batch(es) (batchSize=${batchSize}, detail=${detail})`
	);

	// Process all batches in parallel with small stagger to avoid rate limits
	const STAGGER_DELAY = 500; // ms between batch starts
	const batchResults = await Promise.all(
		batches.map(async (batch, index) => {
			// Stagger batch starts to reduce rate limit pressure
			if (index > 0) {
				await sleep(index * STAGGER_DELAY);
			}
			return extractBatch(openai, model, batch, index, detail);
		})
	);

	// Aggregate results from all batches
	return aggregateBatchResults(batchResults);
};
