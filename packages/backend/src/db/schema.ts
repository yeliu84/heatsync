import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, unique, index } from 'drizzle-orm/pg-core';

/**
 * Table: pdf_files
 * Caches uploaded PDFs and their OpenAI file IDs to avoid re-uploading
 */
export const pdfFiles = pgTable('pdf_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  checksum: varchar('checksum', { length: 32 }).notNull().unique(),
  sourceUrl: text('source_url'),
  filename: varchar('filename', { length: 255 }),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  openaiFileId: varchar('openai_file_id', { length: 255 }),
  openaiFileExpiresAt: timestamp('openai_file_expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_pdf_files_checksum').on(table.checksum),
]);

/**
 * Table: extraction_results
 * Caches extraction results per PDF + swimmer combination
 */
export const extractionResults = pgTable('extraction_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  pdfId: uuid('pdf_id').notNull().references(() => pdfFiles.id, { onDelete: 'cascade' }),
  swimmerNameNormalized: varchar('swimmer_name_normalized', { length: 255 }).notNull(),
  swimmerNameDisplay: varchar('swimmer_name_display', { length: 255 }).notNull(),
  meetName: varchar('meet_name', { length: 500 }).notNull(),
  sessionDate: timestamp('session_date', { mode: 'date' }).notNull(),
  meetDateStart: timestamp('meet_date_start', { mode: 'date' }),
  meetDateEnd: timestamp('meet_date_end', { mode: 'date' }),
  venue: varchar('venue', { length: 500 }),
  events: jsonb('events').notNull().default([]),
  warnings: jsonb('warnings').default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('extraction_pdf_swimmer_unique').on(table.pdfId, table.swimmerNameNormalized),
  index('idx_extraction_pdf_swimmer').on(table.pdfId, table.swimmerNameNormalized),
]);

/**
 * Table: result_links
 * Short codes for sharing extraction results
 */
export const resultLinks = pgTable('result_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  shortCode: varchar('short_code', { length: 12 }).notNull().unique(),
  extractionId: uuid('extraction_id').notNull().references(() => extractionResults.id, { onDelete: 'cascade' }),
  viewCount: integer('view_count').default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_result_links_code').on(table.shortCode),
]);
