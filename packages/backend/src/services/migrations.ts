import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * Check if database migrations are configured
 */
export const isMigrationConfigured = (): boolean => {
  return Boolean(Bun.env.SUPABASE_DATABASE_URL);
};

/**
 * Run database migrations on startup
 * Uses Drizzle ORM's migration runner to apply SQL migration files
 *
 * Migration files are stored in packages/backend/drizzle/
 * Generate new migrations with: bun drizzle-kit generate
 */
export const runMigrations = async (): Promise<void> => {
  if (!isMigrationConfigured()) {
    console.log('[Migrations] SUPABASE_DATABASE_URL not configured, skipping migrations');
    console.log('[Migrations] Caching features will be disabled');
    return;
  }

  console.log('[Migrations] Running database migrations...');

  // Create a dedicated connection for migrations
  const migrationClient = postgres(Bun.env.SUPABASE_DATABASE_URL!, {
    max: 1,
  });

  const db = drizzle(migrationClient);

  try {
    await migrate(db, {
      migrationsFolder: './drizzle',
    });
    console.log('[Migrations] All migrations completed successfully');
  } catch (error) {
    console.error('[Migrations] Migration failed:', error);
    throw error;
  } finally {
    await migrationClient.end();
  }
};
