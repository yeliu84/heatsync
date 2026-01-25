import OpenAI from "openai";
import type { ExtractionResult } from "@heatsync/shared";

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

/**
 * Extract swim meet data from heat sheet images using AI
 *
 * @param images - Array of base64 PNG data URLs
 * @returns Parsed extraction result
 */
export const extractFromImages = async (
	images: string[]
): Promise<ExtractionResult> => {
	const openai = createOpenAIClient();
	const model = process.env.OPENAI_MODEL || "gpt-4o";

	// Build the message content with text prompt and all images
	const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
		{ type: "text", text: EXTRACTION_PROMPT },
		...images.map(
			(img): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
				type: "image_url",
				image_url: { url: img, detail: "high" },
			})
		),
	];

	const response = await openai.chat.completions.create({
		model,
		messages: [
			{
				role: "user",
				content,
			},
		],
		response_format: { type: "json_object" },
		max_tokens: 16000,
	});

	const responseText = response.choices[0]?.message?.content;

	if (!responseText) {
		throw new Error("No response from AI model");
	}

	// Parse the JSON response
	const parsed = JSON.parse(responseText);

	// Convert date string to Date object
	const result: ExtractionResult = {
		meetName: parsed.meetName || "Unknown Meet",
		meetDate: new Date(parsed.meetDate || new Date().toISOString()),
		venue: parsed.venue || undefined,
		events: (parsed.events || []).map(
			(event: Record<string, unknown>) => ({
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
			})
		),
		warnings: parsed.warnings || undefined,
	};

	return result;
};
