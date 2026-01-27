import { Hono } from 'hono';
import { getResultByCode } from '@heatsync/backend/services/cache';
import type { ExtractResponse, ExtractErrorResponse } from '@heatsync/shared';

export const resultRoutes = new Hono();

/**
 * Get cached extraction result by short code
 * GET /result/:code
 *
 * Response: ExtractionResult JSON
 */
resultRoutes.get('/:code', async (c) => {
  try {
    const code = c.req.param('code');

    if (!code || code.length < 4 || code.length > 12) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: 'Invalid result code',
        details: 'Result code must be between 4 and 12 characters',
      };
      return c.json(errorResponse, 400);
    }

    console.log(`Looking up result: ${code}`);

    const result = await getResultByCode(code);

    if (!result) {
      const errorResponse: ExtractErrorResponse = {
        success: false,
        error: 'Result not found',
        details: 'The result may have expired or the code is invalid',
      };
      return c.json(errorResponse, 404);
    }

    console.log(`Found result: ${result.events.length} events for meet "${result.meetName}"`);

    const response: ExtractResponse = {
      success: true,
      data: result,
    };

    return c.json(response);
  } catch (error) {
    console.error('Result lookup error:', error);

    const errorResponse: ExtractErrorResponse = {
      success: false,
      error: 'Failed to retrieve result',
      details: error instanceof Error ? error.message : 'Unknown error',
    };

    return c.json(errorResponse, 500);
  }
});
