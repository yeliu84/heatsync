import OpenAI from 'openai';
import type { ExtractionResult } from '@heatsync/shared';
import { renderPdfToImages, countSwimmerOccurrences } from '@heatsync/backend/services/pdf';
import { calculateMD5 } from '@heatsync/backend/utils/hash';
import { normalizeSwimmerName } from '@heatsync/backend/utils/name';
import {
  getPdfByChecksum,
  cachePdfFile,
  updatePdfOpenAIFileId,
  getExtractionResult,
  cacheExtractionResult,
  createResultLink,
  type CachePdfMetadata,
} from '@heatsync/backend/services/cache';

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
 * Options for building extraction prompt
 */
interface ExtractionPromptOptions {
  expectedEventCount?: number;  // From pre-processing swimmer occurrence count
}

/**
 * Build extraction prompt for finding a specific swimmer's events
 */
const buildExtractionPrompt = (swimmerName: string, options: ExtractionPromptOptions = {}): string => {
  const { firstLast, lastFirst } = normalizeSwimmerName(swimmerName);
  const { expectedEventCount } = options;

  // Build expected count instruction if available
  const countInstruction = expectedEventCount && expectedEventCount > 0
    ? `\n\n** EXPECTED EVENT COUNT: ${expectedEventCount} **
Based on text analysis, this swimmer appears ${expectedEventCount} time(s) in the heat sheet.
You MUST find at least ${expectedEventCount} event(s) for this swimmer.
If you find fewer events, re-scan the entire document more carefully - you may have missed some occurrences.
`
    : '';

  return `IMPORTANT: You MUST scan EVERY page of this heat sheet completely. Do NOT stop after finding some events - swimmers often appear in multiple events across different pages.

Find ALL events for swimmer "${firstLast}" in this heat sheet. Return ONLY this JSON (no explanation):
{"meetName":"string","sessionDate":"YYYY-MM-DD","meetDateRange":{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"},"venue":"string|null","events":[{"eventNumber":1,"eventName":"string","heatNumber":1,"lane":1,"swimmerName":"First Last","age":11,"team":"ABC","seedTime":"1:23.45","heatStartTime":"HH:MM"}],"warnings":[]}${countInstruction}

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
  const baseURL = Bun.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
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
  const sessionDate = sessionDateStr ? new Date(sessionDateStr) : new Date();

  // Parse optional meetDateRange
  const meetDateRange = parsed.meetDateRange
    ? {
        start: new Date(parsed.meetDateRange.start),
        end: new Date(parsed.meetDateRange.end),
      }
    : undefined;

  return {
    meetName: parsed.meetName || 'Unknown Meet',
    sessionDate,
    meetDateRange,
    venue: parsed.venue || undefined,
    events: (parsed.events || []).map((event: Record<string, unknown>) => ({
      eventNumber: Number(event.eventNumber) || 0,
      eventName: String(event.eventName || 'Unknown Event'),
      heatNumber: Number(event.heatNumber) || 0,
      lane: Number(event.lane) || 0,
      swimmerName: String(event.swimmerName || 'Unknown'),
      age: event.age ? Number(event.age) : undefined,
      team: event.team ? String(event.team) : undefined,
      seedTime: event.seedTime ? String(event.seedTime) : undefined,
      heatStartTime: event.heatStartTime ? String(event.heatStartTime) : undefined,
      sessionDate, // Attach the session date to each event for self-contained display
    })),
    warnings: parsed.warnings || undefined,
  };
};

/**
 * Check if model supports direct PDF file upload (GPT models)
 */
const isGptModel = (model: string): boolean => {
  return model.startsWith('gpt-');
};

type MessageContent = OpenAI.Chat.Completions.ChatCompletionContentPart[];

/**
 * Upload PDF to OpenAI and return the file ID
 */
const uploadPdfToOpenAI = async (openai: OpenAI, buffer: ArrayBuffer): Promise<string> => {
  console.log('Uploading PDF to OpenAI...');

  const file = await openai.files.create({
    file: new File([buffer], 'heatsheet.pdf', { type: 'application/pdf' }),
    purpose: 'user_data',
  });

  console.log(`Uploaded PDF as file_id: ${file.id}`);
  return file.id;
};

/**
 * Build message content for GPT models (direct PDF file reference)
 */
const buildGptContent = (
  fileId: string,
  swimmerName: string,
  promptOptions?: ExtractionPromptOptions,
): MessageContent => {
  return [
    { type: 'file', file: { file_id: fileId } },
    { type: 'text', text: buildExtractionPrompt(swimmerName, promptOptions) },
  ];
};

/**
 * Build message content for non-GPT models (image rendering)
 */
const buildImageContent = (
  buffer: ArrayBuffer,
  swimmerName: string,
  promptOptions?: ExtractionPromptOptions,
): MessageContent => {
  console.log('Using PDF-to-image rendering...');

  const images = renderPdfToImages(buffer);
  console.log(`Rendered ${images.length} pages`);

  return [
    ...images.map(
      (url): OpenAI.Chat.Completions.ChatCompletionContentPartImage => ({
        type: 'image_url',
        image_url: { url, detail: 'high' },
      }),
    ),
    { type: 'text', text: buildExtractionPrompt(swimmerName, promptOptions) },
  ];
};

/**
 * Options for PDF extraction
 */
export interface ExtractOptions {
  sourceUrl?: string;
  filename?: string;
}

/**
 * Result from extraction including caching metadata
 */
export interface ExtractResult {
  result: ExtractionResult;
  resultCode: string | null;  // Short code for result link
  cached: boolean;            // Whether result came from cache
}

/**
 * Extract swim meet data for a specific swimmer from a PDF
 *
 * Uses caching to avoid re-processing the same PDF and swimmer combination.
 * Uses direct PDF upload for GPT models, image rendering for others.
 *
 * @param buffer - PDF file content as ArrayBuffer
 * @param swimmerName - Name of the swimmer to search for
 * @param options - Additional options (URL, filename for caching)
 * @returns Extraction result with caching metadata
 */
export const extractFromPdf = async (
  buffer: ArrayBuffer,
  swimmerName: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> => {
  const model = Bun.env.OPENAI_MODEL || 'gpt-4o';
  const useGpt = isGptModel(model);

  console.log(`Processing PDF (${buffer.byteLength} bytes) with model: ${model}`);
  console.log(`Searching for swimmer: ${swimmerName}`);

  // Step 1: Calculate MD5 checksum for cache lookup
  const checksum = calculateMD5(buffer);
  console.log(`PDF checksum: ${checksum}`);

  // Step 2: Check if we have this PDF cached
  let pdfCache = await getPdfByChecksum(checksum);
  let pdfId = pdfCache?.id;

  // Step 3: If PDF is cached, check for cached extraction result
  if (pdfId) {
    const cachedResult = await getExtractionResult(pdfId, swimmerName);
    if (cachedResult) {
      console.log('[Cache] Using cached extraction result');
      // Get or create result link
      const resultCode = await createResultLink(cachedResult.id);
      return {
        result: cachedResult.result,
        resultCode,
        cached: true,
      };
    }
  }

  // Step 4: Not cached - need to run extraction
  const openai = createOpenAIClient();
  let openaiFileId = pdfCache?.openaiFileId;

  // Step 5: Get or create OpenAI file ID (for GPT models)
  if (useGpt) {
    if (!openaiFileId) {
      // Need to upload PDF to OpenAI
      openaiFileId = await uploadPdfToOpenAI(openai, buffer);

      // Cache the PDF file info
      if (pdfId) {
        // PDF entry exists but OpenAI file expired, update it
        await updatePdfOpenAIFileId(pdfId, openaiFileId);
      } else {
        // New PDF, create cache entry
        const metadata: CachePdfMetadata = {
          sourceUrl: options.sourceUrl,
          filename: options.filename,
          fileSizeBytes: buffer.byteLength,
        };
        const cached = await cachePdfFile(checksum, metadata, openaiFileId);
        pdfId = cached?.id;
      }
    } else {
      console.log(`[Cache] Using cached OpenAI file ID: ${openaiFileId}`);
    }
  } else if (!pdfId) {
    // For non-GPT models, we still want to cache the PDF metadata (without OpenAI file ID)
    const metadata: CachePdfMetadata = {
      sourceUrl: options.sourceUrl,
      filename: options.filename,
      fileSizeBytes: buffer.byteLength,
    };
    const cached = await cachePdfFile(checksum, metadata, 'non-gpt-model');
    pdfId = cached?.id;
  }

  // Step 6: Pre-process PDF to count swimmer occurrences (for accuracy)
  let expectedEventCount: number | undefined;
  try {
    const occurrences = countSwimmerOccurrences(buffer, swimmerName);
    if (occurrences.count > 0) {
      expectedEventCount = occurrences.count;
      console.log(
        `[Pre-process] Swimmer "${swimmerName}" found ${occurrences.count} time(s) on pages: ${occurrences.pages.map((p) => p + 1).join(', ')}`,
      );
    } else {
      console.log(`[Pre-process] Swimmer "${swimmerName}" not found in PDF text (may be a scanned PDF)`);
    }
  } catch (error) {
    // Pre-processing failed (e.g., scanned PDF) - continue without expected count
    console.log('[Pre-process] Text extraction failed, continuing without expected count');
  }

  // Step 7: Build content based on model type
  const promptOptions: ExtractionPromptOptions = { expectedEventCount };
  const content = useGpt
    ? buildGptContent(openaiFileId!, swimmerName, promptOptions)
    : buildImageContent(buffer, swimmerName, promptOptions);

  // Step 8: Call OpenAI for extraction
  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_object' },
    temperature: 0,
    ...(useGpt ? { max_completion_tokens: 16000 } : { max_tokens: 16000 }),
  });

  const responseText = response.choices[0]?.message?.content;

  if (!responseText) {
    console.error(
      'Response structure:',
      JSON.stringify({
        finish_reason: response.choices[0]?.finish_reason,
        refusal: response.choices[0]?.message?.refusal,
      }),
    );
    throw new Error(
      `Empty response from AI model (finish_reason: ${response.choices[0]?.finish_reason})`,
    );
  }

  const result = parseExtractionResponse(responseText);
  console.log(`Found ${result.events.length} events for ${swimmerName}`);

  // Post-filter: Remove events where the returned name doesn't match the requested name
  // This catches cases where the AI incorrectly matched phonetically similar names
  const matchedEvents = result.events.filter((e) => namesMatch(swimmerName, e.swimmerName));
  const filteredCount = result.events.length - matchedEvents.length;

  if (filteredCount > 0) {
    const filteredNames = [
      ...new Set(
        result.events
          .filter((e) => !namesMatch(swimmerName, e.swimmerName))
          .map((e) => e.swimmerName),
      ),
    ];
    const warning = `Filtered ${filteredCount} event(s) for different swimmer(s): ${filteredNames.join(', ')}`;
    console.log(warning);
    result.warnings = [...(result.warnings || []), warning];
  }

  result.events = matchedEvents;
  console.log(`Returning ${result.events.length} events after filtering`);

  // Step 9: Cache the extraction result
  let resultCode: string | null = null;
  if (pdfId) {
    const cached = await cacheExtractionResult(pdfId, swimmerName, result);
    if (cached) {
      resultCode = await createResultLink(cached.id);
    }
  }

  return {
    result,
    resultCode,
    cached: false,
  };
};
