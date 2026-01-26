import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { healthRoutes } from "@heatsync/backend/routes/health";
import { extractRoutes } from "@heatsync/backend/routes/extract";
import { extractUrlRoutes } from "@heatsync/backend/routes/extractUrl";

const app = new Hono();

// Middleware
app.use("/*", cors());
app.use("/*", logger());

// API Routes - grouped under /api prefix
const api = new Hono();
api.route("/health", healthRoutes);
api.route("/extract", extractRoutes);
api.route("/extractUrl", extractUrlRoutes);

// API error handling
api.onError((err, c) => {
	console.error("API error:", err);
	return c.json(
		{
			success: false,
			error: "Internal server error",
			details: Bun.env.NODE_ENV === "development" ? err.message : undefined,
		},
		500
	);
});

// API 404 handler
api.notFound((c) => {
	return c.json(
		{
			success: false,
			error: "Not found",
		},
		404
	);
});

app.route("/api", api);

// Static file serving (production)
app.use("/*", serveStatic({ root: "./public" }));

// SPA fallback - serve index.html for client-side routing
app.use("/*", serveStatic({ root: "./public", path: "index.html" }));

const port = parseInt(Bun.env.PORT || "8000", 10);

console.log(`Starting HeatSync backend on port ${port}...`);

export default {
	port,
	fetch: app.fetch,
};
