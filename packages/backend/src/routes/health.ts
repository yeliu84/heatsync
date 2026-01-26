import { Hono } from 'hono';

export const healthRoutes = new Hono();

/**
 * Health check endpoint
 * GET /health
 */
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'heatsync-backend',
  });
});
