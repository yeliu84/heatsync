import OpenAI from "openai";
import type { ExtractionResult } from "@heatsync/shared";
import { renderPdfToImages } from "./pdf";

/**
 * Normalize swimmer name to consistent "First Last" format
 * Handles input in either "First Last" or "Last, First" format
 */
const normalizeSwimmerName = (
  name: string
): { firstLast: string; lastFirst: string } => {
  const trimmed = name.trim();

  if (trimmed.includes(",")) {
    // Input is "Last, First" format - split and swap
    const [last, first] = trimmed.split(",").map((s) => s.trim());
    return {
      firstLast: `${first} ${last}`,
      lastFirst: `${last}, ${first}`,
    };
  }

  // Input is "First Last" format - split and create both
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts.slice(0, -1).join(" ");
    const last = parts[parts.length - 1];
    return {
      firstLast: trimmed,
      lastFirst: `${last}, ${first}`,
    };
  }

  // Single name - use as-is for both
  return { firstLast: trimmed, lastFirst: trimmed };
};

/**
 * Check if two swimmer names match (case-insensitive, format-agnostic)
 * Uses normalizeSwimmerName to handle "First Last" vs "Last, First" formats
 */
const namesMatch = (requestedName: string, returnedName: string): boolean => {
  const requested = normalizeSwimmerName(requestedName).firstLast.toLowerCase();
  const returned = normalizeSwimmerName(returnedName).firstLast.toLowerCase();
  return requested === returned;
};

/**
 * Build extraction prompt for finding a specific swimmer's events
 */
const buildExtractionPrompt = (swimmerName: string): string => {
  const { firstLast, lastFirst } = normalizeSwimmerName(swimmerName);

  return `IMPORTANT: You MUST scan EVERY page of this heat sheet completely. Do NOT stop after finding some events - swimmers often appear in multiple events across different pages.

Find ALL events for swimmer "${firstLast}" in this heat sheet. Return ONLY this JSON (no explanation):
{"meetName":"string","sessionDate":"YYYY-MM-DD","meetDateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"venue":"string|null","events":[{"eventNumber":1,"eventName":"string","heatNumber":1,"lane":1,"swimmerName":"First Last","age":11,"team":"ABC","seedTime":"1:23.45","heatStartTime":"HH:MM"}],"warnings":[]}

NAME MATCHING (CRITICAL):
- The swimmer's name is: "${firstLast}" (also written as "${lastFirst}")
- Heat sheets list names in "Last, First" format, so search for EXACTLY: "${lastFirst}"
- IMPORTANT: Return swimmerName with the EXACT name as it appears in the heat sheet, converted to "First Last" format
- For example: if the PDF shows "Liu, Elly" you must return "Elly Liu" - do NOT substitute the searched name
- IMPORTANT: There may be MULTIPLE swimmers with the same LAST NAME (e.g., multiple "Liu" swimmers)
- You MUST match BOTH the first name AND last name EXACTLY - "${lastFirst}" only, not similar names
- Do NOT include events for swimmers with similar names (e.g., "Liu, Elsa" is NOT "Liu, Elly" - different first names)
- Do NOT match phonetically similar names (e.g., "Li, Elsie" is NOT "Liu, Elly")

AGE EXTRACTION:
- Extract the swimmer's age from the age column (the number next to the swimmer name, e.g., 8, 10, 11)
- Return age as a number (not string)
- Heat sheets typically show age in a column near the swimmer's name and team
- If age cannot be determined, omit the age field

CRITICAL RULES:
- Scan ALL pages from start to finish before returning results
- Include EVERY event where this swimmer appears
- No swimmer found = empty events array + warning
- seedTime: use "NT" if blank/NT/NS
- Omit null fields

SESSION DATE CALCULATION:
1. The meet date range normally follows the meet name in format "<start date> to <end date>" (e.g., "1/16/2026 to 1/18/2026" or "2026-01-24 to 2026-01-25")
2. Extract meetDateRange.start and meetDateRange.end from this range
3. Determine which weekday the start date falls on (e.g., if 1/16/2026 then Friday)
4. Heat sheets indicate which weekday the session is, found after "Meet Program" or near the meet name (e.g., "Saturday" or "Sat")
5. Calculate sessionDate: start date + (session weekday - start weekday)
   Example: start=Friday 1/16/2026, session=Saturday -> sessionDate = 1/17/2026
6. If session weekday is not found, use the meet start date as sessionDate and add a warning

HEAT START TIME:
1. Extract heat start time from the PDF - it is normally displayed with the heat number (e.g., "Heat 3 - 10:45 AM")
2. Return heatStartTime in 24-hour format "HH:MM" (e.g., "10:45" for 10:45 AM, "14:30" for 2:30 PM)
3. If heat start time is not explicitly shown, estimate using: Heat Estimated Start Time = Previous Heat Start Time + Fastest Seed Time in Previous Heat
4. If previous heat also has no start time, recursively apply the same formula above

FINAL VERIFICATION:
Before returning your response, re-scan the ENTIRE document one more time to confirm you haven't missed any events for "${firstLast}". Count the total events found and verify each one.`;
};

/**
 * Create OpenAI client from environment variables
 */
const createOpenAIClient = (): OpenAI => {
  const apiKey = Bun.env.OPENAI_API_KEY;
  const baseURL = Bun.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  return new OpenAI({
    apiKey,
    baseURL,
  });
};

/**
 * Parse API response into ExtractionResult
 */
const parseExtractionResponse = (responseText: string): ExtractionResult => {
  const parsed = JSON.parse(responseText);

  // Parse sessionDate with fallback to meetDate for backward compatibility
  const sessionDateStr = parsed.sessionDate || parsed.meetDate;
  const sessionDate = sessionDateStr
    ? new Date(sessionDateStr)
    : new Date();

  // Parse optional meetDateRange
  const meetDateRange = parsed.meetDateRange
    ? {
        start: new Date(parsed.meetDateRange.start),
        end: new Date(parsed.meetDateRange.end),
      }
    : undefined;

  return {
    meetName: parsed.meetName || "Unknown Meet",
    sessionDate,
    meetDateRange,
    venue: parsed.venue || undefined,
    events: (parsed.events || []).map((event: Record<string, unknown>) => ({
      eventNumber: Number(event.eventNumber) || 0,
      eventName: String(event.eventName || "Unknown Event"),
      heatNumber: Number(event.heatNumber) || 0,
      lane: Number(event.lane) || 0,
      swimmerName: String(event.swimmerName || "Unknown"),
      age: event.age ? Number(event.age) : undefined,
      team: event.team ? String(event.team) : undefined,
      seedTime: event.seedTime ? String(event.seedTime) : undefined,
      heatStartTime: event.heatStartTime ? String(event.heatStartTime) : undefined,
    })),
    warnings: parsed.warnings || undefined,
  };
};

/**
 * Check if model supports direct PDF file upload (GPT models)
 */
const isGptModel = (model: string): boolean => {
  return model.startsWith("gpt-");
};

type MessageContent = OpenAI.Chat.Completions.ChatCompletionContentPart[];

/**
 * Build message content for GPT models (direct PDF file upload)
 */
const buildGptContent = async (
  openai: OpenAI,
  buffer: ArrayBuffer,
  swimmerName: string
): Promise<MessageContent> => {
  console.log("Using direct PDF file upload...");

  const file = await openai.files.create({
    file: new File([buffer], "heatsheet.pdf", { type: "application/pdf" }),
    purpose: "user_data",
  });

  console.log(`Uploaded PDF as file_id: ${file.id}`);

  return [
    { type: "file", file: { file_id: file.id } },
    { type: "text", text: buildExtractionPrompt(swimmerName) },
  ];
};

/**
 * Build message content for non-GPT models (image rendering)
 */
const buildImageContent = (
  buffer: ArrayBuffer,
  swimmerName: string
): MessageContent => {
  console.log("Using PDF-to-image rendering...");

  const images = renderPdfToImages(buffer);
  console.log(`Rendered ${images.length} pages`);

  return [
    ...images.map(
      (url): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
        type: "image_url",
        image_url: { url, detail: "high" },
      })
    ),
    { type: "text", text: buildExtractionPrompt(swimmerName) },
  ];
};

/**
 * Extract swim meet data for a specific swimmer from a PDF
 *
 * Uses direct PDF upload for GPT models, image rendering for others.
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @param swimmerName - Name of the swimmer to search for
 * @returns Parsed extraction result with only that swimmer's events
 */
export const extractFromPdf = async (
  buffer: ArrayBuffer,
  swimmerName: string
): Promise<ExtractionResult> => {
  const openai = createOpenAIClient();
  const model = Bun.env.OPENAI_MODEL || "gpt-4o";
  const useGpt = isGptModel(model);

  console.log(`Processing PDF (${buffer.byteLength} bytes) with model: ${model}`);
  console.log(`Searching for swimmer: ${swimmerName}`);

  // Build content based on model type
  const content = useGpt
    ? await buildGptContent(openai, buffer, swimmerName)
    : buildImageContent(buffer, swimmerName);

  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: "user", content }],
    response_format: { type: "json_object" },
    temperature: 0,
    ...(useGpt
      ? { max_completion_tokens: 16000 }
      : { max_tokens: 16000 }),
  });

  const responseText = response.choices[0]?.message?.content;

  if (!responseText) {
    console.error(
      "Response structure:",
      JSON.stringify({
        finish_reason: response.choices[0]?.finish_reason,
        refusal: response.choices[0]?.message?.refusal,
      })
    );
    throw new Error(
      `Empty response from AI model (finish_reason: ${response.choices[0]?.finish_reason})`
    );
  }

  const result = parseExtractionResponse(responseText);
  console.log(`Found ${result.events.length} events for ${swimmerName}`);

  // Post-filter: Remove events where the returned name doesn't match the requested name
  // This catches cases where the AI incorrectly matched phonetically similar names
  const matchedEvents = result.events.filter((e) =>
    namesMatch(swimmerName, e.swimmerName)
  );
  const filteredCount = result.events.length - matchedEvents.length;

  if (filteredCount > 0) {
    const filteredNames = [
      ...new Set(
        result.events
          .filter((e) => !namesMatch(swimmerName, e.swimmerName))
          .map((e) => e.swimmerName)
      ),
    ];
    const warning = `Filtered ${filteredCount} event(s) for different swimmer(s): ${filteredNames.join(", ")}`;
    console.log(warning);
    result.warnings = [...(result.warnings || []), warning];
  }

  result.events = matchedEvents;
  console.log(`Returning ${result.events.length} events after filtering`);

  return result;
};
