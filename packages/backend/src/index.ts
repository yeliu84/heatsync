import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { healthRoutes } from '@heatsync/backend/routes/health';
import { extractRoutes } from '@heatsync/backend/routes/extract';
import { extractUrlRoutes } from '@heatsync/backend/routes/extractUrl';
import { resultRoutes } from '@heatsync/backend/routes/result';
import { runMigrations } from '@heatsync/backend/services/migrations';

// Run database migrations on startup
await runMigrations();

const app = new Hono();

// Rate limiting store (in-memory, resets on restart)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT = 10; // requests
const RATE_WINDOW = 60 * 1000; // 1 minute in ms

const rateLimiter = async (
  c: Parameters<Parameters<typeof app.use>[1]>[0],
  next: () => Promise<void>,
) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || 'unknown';

  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    // First request or window expired
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
  } else if (record.count >= RATE_LIMIT) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    c.header('Retry-After', String(retryAfter));
    c.header('X-RateLimit-Limit', String(RATE_LIMIT));
    c.header('X-RateLimit-Remaining', '0');
    c.header('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));
    return c.json(
      {
        success: false,
        error: 'Too many requests',
        details: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
      },
      429,
    );
  } else {
    // Increment counter
    record.count++;
  }

  // Set rate limit headers
  const current = rateLimitStore.get(ip)!;
  c.header('X-RateLimit-Limit', String(RATE_LIMIT));
  c.header('X-RateLimit-Remaining', String(RATE_LIMIT - current.count));
  c.header('X-RateLimit-Reset', String(Math.ceil(current.resetTime / 1000)));

  await next();
};

// Middleware
app.use('/*', cors());
app.use('/*', logger());

// API Routes - grouped under /api prefix
const api = new Hono();
api.route('/health', healthRoutes);

// Apply rate limiting to extraction endpoints
api.use('/extract/*', rateLimiter);
api.use('/extractUrl/*', rateLimiter);

api.route('/extract', extractRoutes);
api.route('/extractUrl', extractUrlRoutes);
api.route('/result', resultRoutes);

// API error handling
api.onError((err, c) => {
  console.error('API error:', err);
  return c.json(
    {
      success: false,
      error: 'Internal server error',
      details: Bun.env.NODE_ENV === 'development' ? err.message : undefined,
    },
    500,
  );
});

// API 404 handler
api.notFound((c) => {
  return c.json(
    {
      success: false,
      error: 'Not found',
    },
    404,
  );
});

app.route('/api', api);

// Static file serving (production)
app.use('/*', serveStatic({ root: './public' }));

// SPA fallback - serve index.html for client-side routing
app.use('/*', serveStatic({ root: './public', path: 'index.html' }));

const port = parseInt(Bun.env.PORT || '8000', 10);

console.log(`Starting HeatSync backend on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
