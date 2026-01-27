import { eq, and } from 'drizzle-orm';
import { getDb, isDatabaseConfigured, schema } from '@heatsync/backend/db';
import type { ExtractionResult, SwimEvent } from '@heatsync/shared';
import { normalizeSwimmerName } from '@heatsync/backend/utils/name';

// Base62 characters for short code generation
const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a random short code for result links
 * @param length - Length of the code (default: 8)
 * @returns Random base62 string
 */
const generateShortCode = (length = 8): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => BASE62_CHARS[b % BASE62_CHARS.length])
    .join('');
};

/**
 * Normalize swimmer name to lowercase for consistent cache lookups
 */
const normalizeNameForLookup = (name: string): string => {
  return name.trim().toLowerCase();
};

// ============================================================================
// PDF File Cache
// ============================================================================

export interface PdfCacheEntry {
  id: string;
  checksum: string;
  openaiFileId: string | null;
  openaiFileExpiresAt: Date | null;
  fileSizeBytes: number;
}

/**
 * Check if an OpenAI file ID is still valid (not expired)
 * OpenAI files typically expire after ~30 days
 */
const isOpenAIFileValid = (expiresAt: Date | null): boolean => {
  if (!expiresAt) return false;
  // Add 1 hour buffer before expiration
  return expiresAt.getTime() > Date.now() + 60 * 60 * 1000;
};

/**
 * Get cached PDF file by its MD5 checksum
 * @returns PDF cache entry if found and OpenAI file is still valid, null otherwise
 */
export const getPdfByChecksum = async (checksum: string): Promise<PdfCacheEntry | null> => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const db = getDb();

    const result = await db
      .select({
        id: schema.pdfFiles.id,
        checksum: schema.pdfFiles.checksum,
        openaiFileId: schema.pdfFiles.openaiFileId,
        openaiFileExpiresAt: schema.pdfFiles.openaiFileExpiresAt,
        fileSizeBytes: schema.pdfFiles.fileSizeBytes,
      })
      .from(schema.pdfFiles)
      .where(eq(schema.pdfFiles.checksum, checksum))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const data = result[0];

    // Update last_accessed_at timestamp
    await db
      .update(schema.pdfFiles)
      .set({ lastAccessedAt: new Date() })
      .where(eq(schema.pdfFiles.id, data.id));

    // Only return if OpenAI file is still valid
    if (!isOpenAIFileValid(data.openaiFileExpiresAt)) {
      console.log(`[Cache] PDF found but OpenAI file expired: ${checksum.substring(0, 8)}...`);
      return {
        id: data.id,
        checksum: data.checksum,
        openaiFileId: null, // File expired, needs re-upload
        openaiFileExpiresAt: null,
        fileSizeBytes: data.fileSizeBytes,
      };
    }

    console.log(`[Cache] PDF cache hit: ${checksum.substring(0, 8)}... (file_id: ${data.openaiFileId})`);

    return {
      id: data.id,
      checksum: data.checksum,
      openaiFileId: data.openaiFileId,
      openaiFileExpiresAt: data.openaiFileExpiresAt,
      fileSizeBytes: data.fileSizeBytes,
    };
  } catch (error) {
    console.error('[Cache] Error getting PDF by checksum:', error);
    return null;
  }
};

export interface CachePdfMetadata {
  sourceUrl?: string;
  filename?: string;
  fileSizeBytes: number;
}

/**
 * Cache a PDF file with its OpenAI file ID
 * @param checksum - MD5 checksum of the PDF
 * @param metadata - File metadata (URL, filename, size)
 * @param openaiFileId - OpenAI file ID from upload
 * @returns Cached PDF entry
 */
export const cachePdfFile = async (
  checksum: string,
  metadata: CachePdfMetadata,
  openaiFileId: string,
): Promise<PdfCacheEntry | null> => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const db = getDb();

    // OpenAI files expire in ~30 days, set expiration to 29 days from now
    const expiresAt = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const result = await db
      .insert(schema.pdfFiles)
      .values({
        checksum,
        sourceUrl: metadata.sourceUrl || null,
        filename: metadata.filename || null,
        fileSizeBytes: metadata.fileSizeBytes,
        openaiFileId,
        openaiFileExpiresAt: expiresAt,
      })
      .onConflictDoUpdate({
        target: schema.pdfFiles.checksum,
        set: {
          openaiFileId,
          openaiFileExpiresAt: expiresAt,
          lastAccessedAt: new Date(),
        },
      })
      .returning({
        id: schema.pdfFiles.id,
        checksum: schema.pdfFiles.checksum,
        openaiFileId: schema.pdfFiles.openaiFileId,
        openaiFileExpiresAt: schema.pdfFiles.openaiFileExpiresAt,
        fileSizeBytes: schema.pdfFiles.fileSizeBytes,
      });

    if (result.length === 0) {
      console.error('[Cache] Error caching PDF file: no result returned');
      return null;
    }

    const data = result[0];

    console.log(`[Cache] PDF cached: ${checksum.substring(0, 8)}... (file_id: ${openaiFileId})`);

    return {
      id: data.id,
      checksum: data.checksum,
      openaiFileId: data.openaiFileId,
      openaiFileExpiresAt: data.openaiFileExpiresAt,
      fileSizeBytes: data.fileSizeBytes,
    };
  } catch (error) {
    console.error('[Cache] Error caching PDF file:', error);
    return null;
  }
};

/**
 * Update an existing PDF cache entry with a new OpenAI file ID
 * Used when the previous file expired and we need to re-upload
 */
export const updatePdfOpenAIFileId = async (pdfId: string, openaiFileId: string): Promise<void> => {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    const db = getDb();

    const expiresAt = new Date(Date.now() + 29 * 24 * 60 * 60 * 1000);

    await db
      .update(schema.pdfFiles)
      .set({
        openaiFileId,
        openaiFileExpiresAt: expiresAt,
        lastAccessedAt: new Date(),
      })
      .where(eq(schema.pdfFiles.id, pdfId));

    console.log(`[Cache] Updated OpenAI file ID for PDF ${pdfId}: ${openaiFileId}`);
  } catch (error) {
    console.error('[Cache] Error updating PDF OpenAI file ID:', error);
  }
};

// ============================================================================
// Extraction Result Cache
// ============================================================================

export interface CachedExtractionResult {
  id: string;
  pdfId: string;
  swimmerName: string;
  result: ExtractionResult;
}

/**
 * Get cached extraction result by PDF ID and swimmer name
 */
export const getExtractionResult = async (
  pdfId: string,
  swimmerName: string,
): Promise<CachedExtractionResult | null> => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const db = getDb();
    const normalizedName = normalizeNameForLookup(swimmerName);

    const result = await db
      .select({
        id: schema.extractionResults.id,
        pdfId: schema.extractionResults.pdfId,
        swimmerNameDisplay: schema.extractionResults.swimmerNameDisplay,
        meetName: schema.extractionResults.meetName,
        sessionDate: schema.extractionResults.sessionDate,
        meetDateStart: schema.extractionResults.meetDateStart,
        meetDateEnd: schema.extractionResults.meetDateEnd,
        venue: schema.extractionResults.venue,
        events: schema.extractionResults.events,
        warnings: schema.extractionResults.warnings,
      })
      .from(schema.extractionResults)
      .where(
        and(
          eq(schema.extractionResults.pdfId, pdfId),
          eq(schema.extractionResults.swimmerNameNormalized, normalizedName),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const data = result[0];

    console.log(
      `[Cache] Extraction cache hit: swimmer="${swimmerName}" pdf=${pdfId.substring(0, 8)}...`,
    );

    // Reconstruct ExtractionResult from database fields
    const extractionResult: ExtractionResult = {
      meetName: data.meetName,
      sessionDate: data.sessionDate,
      meetDateRange:
        data.meetDateStart && data.meetDateEnd
          ? {
              start: data.meetDateStart,
              end: data.meetDateEnd,
            }
          : undefined,
      venue: data.venue || undefined,
      events: (data.events as SwimEvent[]) || [],
      warnings: (data.warnings as string[]) || undefined,
    };

    return {
      id: data.id,
      pdfId: data.pdfId,
      swimmerName: data.swimmerNameDisplay,
      result: extractionResult,
    };
  } catch (error) {
    console.error('[Cache] Error getting extraction result:', error);
    return null;
  }
};

/**
 * Cache an extraction result
 */
export const cacheExtractionResult = async (
  pdfId: string,
  swimmerName: string,
  result: ExtractionResult,
): Promise<CachedExtractionResult | null> => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const db = getDb();
    const normalizedName = normalizeNameForLookup(swimmerName);

    const insertResult = await db
      .insert(schema.extractionResults)
      .values({
        pdfId,
        swimmerNameNormalized: normalizedName,
        swimmerNameDisplay: normalizeSwimmerName(swimmerName).firstLast,
        meetName: result.meetName,
        sessionDate: result.sessionDate,
        meetDateStart: result.meetDateRange?.start || null,
        meetDateEnd: result.meetDateRange?.end || null,
        venue: result.venue || null,
        events: result.events,
        warnings: result.warnings || [],
      })
      .onConflictDoUpdate({
        target: [schema.extractionResults.pdfId, schema.extractionResults.swimmerNameNormalized],
        set: {
          meetName: result.meetName,
          sessionDate: result.sessionDate,
          meetDateStart: result.meetDateRange?.start || null,
          meetDateEnd: result.meetDateRange?.end || null,
          venue: result.venue || null,
          events: result.events,
          warnings: result.warnings || [],
        },
      })
      .returning({
        id: schema.extractionResults.id,
        pdfId: schema.extractionResults.pdfId,
        swimmerNameDisplay: schema.extractionResults.swimmerNameDisplay,
      });

    if (insertResult.length === 0) {
      console.error('[Cache] Error caching extraction result: no result returned');
      return null;
    }

    const data = insertResult[0];

    console.log(
      `[Cache] Extraction cached: swimmer="${swimmerName}" events=${result.events.length}`,
    );

    return {
      id: data.id,
      pdfId: data.pdfId,
      swimmerName: data.swimmerNameDisplay,
      result,
    };
  } catch (error) {
    console.error('[Cache] Error caching extraction result:', error);
    return null;
  }
};

// ============================================================================
// Result Links
// ============================================================================

/**
 * Create a shareable short link for an extraction result
 * @returns Short code (e.g., "abc123xy")
 */
export const createResultLink = async (extractionId: string): Promise<string | null> => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const db = getDb();

    // Check if a link already exists for this extraction
    const existing = await db
      .select({ shortCode: schema.resultLinks.shortCode })
      .from(schema.resultLinks)
      .where(eq(schema.resultLinks.extractionId, extractionId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Cache] Result link already exists: ${existing[0].shortCode}`);
      return existing[0].shortCode;
    }

    // Generate a unique short code (retry on collision)
    let shortCode: string;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      shortCode = generateShortCode(8);

      try {
        await db.insert(schema.resultLinks).values({
          shortCode,
          extractionId,
        });

        console.log(`[Cache] Result link created: ${shortCode}`);
        return shortCode;
      } catch (insertError: unknown) {
        // If duplicate key error, try again with a new code
        if (insertError && typeof insertError === 'object' && 'code' in insertError && insertError.code === '23505') {
          attempts++;
          continue;
        }
        throw insertError;
      }
    }

    console.error('[Cache] Failed to generate unique short code after max attempts');
    return null;
  } catch (error) {
    console.error('[Cache] Error creating result link:', error);
    return null;
  }
};

/**
 * Get extraction result by short code
 * Also increments view count
 */
export const getResultByCode = async (shortCode: string): Promise<ExtractionResult | null> => {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    const db = getDb();

    // Get the link
    const linkResult = await db
      .select({
        extractionId: schema.resultLinks.extractionId,
        viewCount: schema.resultLinks.viewCount,
      })
      .from(schema.resultLinks)
      .where(eq(schema.resultLinks.shortCode, shortCode))
      .limit(1);

    if (linkResult.length === 0) {
      console.log(`[Cache] Result link not found: ${shortCode}`);
      return null;
    }

    const link = linkResult[0];

    // Get the extraction result
    const extractionResult = await db
      .select({
        swimmerNameDisplay: schema.extractionResults.swimmerNameDisplay,
        meetName: schema.extractionResults.meetName,
        sessionDate: schema.extractionResults.sessionDate,
        meetDateStart: schema.extractionResults.meetDateStart,
        meetDateEnd: schema.extractionResults.meetDateEnd,
        venue: schema.extractionResults.venue,
        events: schema.extractionResults.events,
        warnings: schema.extractionResults.warnings,
      })
      .from(schema.extractionResults)
      .where(eq(schema.extractionResults.id, link.extractionId))
      .limit(1);

    if (extractionResult.length === 0) {
      console.error('[Cache] Extraction result not found for link:', shortCode);
      return null;
    }

    const extraction = extractionResult[0];

    // Increment view count (fire and forget)
    db.update(schema.resultLinks)
      .set({ viewCount: (link.viewCount || 0) + 1 })
      .where(eq(schema.resultLinks.shortCode, shortCode))
      .then(() => {});

    console.log(`[Cache] Result link accessed: ${shortCode} (views: ${(link.viewCount || 0) + 1})`);

    // Reconstruct ExtractionResult
    const result: ExtractionResult = {
      meetName: extraction.meetName,
      sessionDate: extraction.sessionDate,
      meetDateRange:
        extraction.meetDateStart && extraction.meetDateEnd
          ? {
              start: extraction.meetDateStart,
              end: extraction.meetDateEnd,
            }
          : undefined,
      venue: extraction.venue || undefined,
      swimmerName: extraction.swimmerNameDisplay,
      events: (extraction.events as SwimEvent[]) || [],
      warnings: (extraction.warnings as string[]) || undefined,
    };

    return result;
  } catch (error) {
    console.error('[Cache] Error getting result by code:', error);
    return null;
  }
};
