import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Singleton database connection
 */
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlClient: ReturnType<typeof postgres> | null = null;

/**
 * Check if database is configured
 */
export const isDatabaseConfigured = (): boolean => {
  return Boolean(Bun.env.SUPABASE_DATABASE_URL);
};

/**
 * Get the Drizzle database instance
 * Creates the connection on first call
 */
export const getDb = () => {
  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = Bun.env.SUPABASE_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('SUPABASE_DATABASE_URL environment variable is required');
  }

  // Create postgres.js client for Drizzle
  sqlClient = postgres(databaseUrl, {
    max: 10, // Connection pool size
    idle_timeout: 20,
    connect_timeout: 10,
  });

  dbInstance = drizzle(sqlClient, { schema });

  return dbInstance;
};

/**
 * Get the raw SQL client for migrations
 * Used by drizzle-kit and migration runner
 */
export const getSqlClient = () => {
  if (!sqlClient) {
    getDb(); // Initialize if needed
  }
  return sqlClient!;
};

/**
 * Close database connection
 * Call this on server shutdown
 */
export const closeDb = async () => {
  if (sqlClient) {
    await sqlClient.end();
    sqlClient = null;
    dbInstance = null;
  }
};

// Re-export schema for convenience
export { schema };
