import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRoutes } from "@heatsync/backend/routes/health";
import { extractRoutes } from "@heatsync/backend/routes/extract";
import { extractUrlRoutes } from "@heatsync/backend/routes/extractUrl";

const app = new Hono();

// Middleware
app.use("/*", cors());
app.use("/*", logger());

// Routes
app.route("/health", healthRoutes);
app.route("/extract", extractRoutes);
app.route("/extractUrl", extractUrlRoutes);

// Error handling
app.onError((err, c) => {
	console.error("Server error:", err);
	return c.json(
		{
			success: false,
			error: "Internal server error",
			details: process.env.NODE_ENV === "development" ? err.message : undefined,
		},
		500
	);
});

// 404 handler
app.notFound((c) => {
	return c.json(
		{
			success: false,
			error: "Not found",
		},
		404
	);
});

const port = parseInt(process.env.PORT || "3001", 10);

console.log(`Starting HeatSync backend on port ${port}...`);

export default {
	port,
	fetch: app.fetch,
};
