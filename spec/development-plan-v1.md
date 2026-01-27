# HeatSync Development Plan v1

## Progress Tracking

| Phase | Task | Status | Completed |
|-------|------|--------|-----------|
| 1. Supabase Setup | 1.1 Add Supabase client | Pending | - |
| 1. Supabase Setup | 1.2 Create database tables | Pending | - |
| 2. PDF Caching | 2.1 Add MD5 checksum utility | Pending | - |
| 2. PDF Caching | 2.2 Create cache service | Pending | - |
| 2. PDF Caching | 2.3 Integrate caching into extraction flow | Pending | - |
| 3. Result Links | 3.1 Create result link service | Pending | - |
| 3. Result Links | 3.2 Add result API endpoint | Pending | - |
| 3. Result Links | 3.3 Modify extract routes to return result URL | Pending | - |
| 3. Result Links | 3.4 Create result viewer page | Pending | - |
| 3. Result Links | 3.5 Update frontend navigation flow | Pending | - |
| 4. Accuracy | 4.1 Add text extraction to PDF service | Pending | - |
| 4. Accuracy | 4.2 Add swimmer occurrence counter | Pending | - |
| 4. Accuracy | 4.3 Enhance extraction prompt | Pending | - |
| 4. Accuracy | 4.4 Integrate pre-processing | Pending | - |

---

## Overview

This plan implements three features to optimize performance and improve extraction accuracy:

1. **PDF File ID Caching** - Avoid re-uploading the same PDF to OpenAI
2. **Extraction Result Caching & Sharing** - Cache results and enable result URLs
3. **Pre-processing for Accuracy** - Count swimmer occurrences to guide AI extraction

## Prerequisites

- Create a Supabase project (free tier)
- Add Supabase credentials to environment variables

---

## Database Schema (Supabase)

### Table 1: `pdf_files`
```sql
CREATE TABLE pdf_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checksum VARCHAR(32) NOT NULL UNIQUE,      -- MD5 of PDF content
  source_url TEXT,                            -- URL if downloaded
  filename VARCHAR(255),                      -- Original filename
  file_size_bytes INTEGER NOT NULL,
  openai_file_id VARCHAR(255),               -- Cached OpenAI file ID
  openai_file_expires_at TIMESTAMPTZ,        -- Files expire ~30 days
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pdf_files_checksum ON pdf_files(checksum);
```

### Table 2: `extraction_results`
```sql
CREATE TABLE extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_id UUID NOT NULL REFERENCES pdf_files(id) ON DELETE CASCADE,
  swimmer_name_normalized VARCHAR(255) NOT NULL,  -- lowercase for matching
  swimmer_name_display VARCHAR(255) NOT NULL,     -- original case
  meet_name VARCHAR(500) NOT NULL,
  session_date DATE NOT NULL,
  meet_date_start DATE,
  meet_date_end DATE,
  venue VARCHAR(500),
  events JSONB NOT NULL DEFAULT '[]',
  warnings JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pdf_id, swimmer_name_normalized)
);

CREATE INDEX idx_extraction_pdf_swimmer ON extraction_results(pdf_id, swimmer_name_normalized);
```

### Table 3: `result_links`
```sql
CREATE TABLE result_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(12) NOT NULL UNIQUE,
  extraction_id UUID NOT NULL REFERENCES extraction_results(id) ON DELETE CASCADE,
  view_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_result_links_code ON result_links(short_code);
```

---

## Phase 1: Supabase Setup

### Task 1.1: Add Supabase client

**Goal:** Set up Supabase client for database access

- Install `@supabase/supabase-js` package
- Create `/packages/backend/src/services/supabase.ts`
- Add environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- Create Supabase client singleton

**Files to modify:**
- `packages/backend/package.json` - add supabase dependency
- `packages/backend/src/services/supabase.ts` - new file
- `.env.example` - document new env vars

---

### Task 1.2: Create database tables

**Goal:** Set up database schema in Supabase

- Run SQL migrations in Supabase dashboard
- Generate TypeScript types for tables

---

## Phase 2: PDF File ID Caching

### Task 2.1: Add MD5 checksum utility

**Goal:** Calculate checksums to identify duplicate PDFs

- Create `/packages/backend/src/utils/hash.ts`
- Implement `calculateMD5(buffer: ArrayBuffer): string`
- Use Bun's native crypto (or Web Crypto API)

**Files to create:**
- `packages/backend/src/utils/hash.ts`

---

### Task 2.2: Create cache service

**Goal:** Service layer for database caching operations

- Create `/packages/backend/src/services/cache.ts`
- Implement `getPdfByChecksum(checksum): Promise<DbPdfFile | null>`
- Implement `cachePdfFile(checksum, metadata, fileId): Promise<DbPdfFile>`
- Implement `getExtractionResult(pdfId, swimmerName): Promise<DbExtractionResult | null>`
- Implement `cacheExtractionResult(pdfId, swimmerName, result): Promise<DbExtractionResult>`

**Files to create:**
- `packages/backend/src/services/cache.ts`

---

### Task 2.3: Integrate caching into extraction flow

**Goal:** Modify extraction to use cache before calling OpenAI

- Modify `extractFromPdf()` in `openai.ts`:
  1. Calculate MD5 checksum of buffer
  2. Check cache for existing OpenAI file ID
  3. If found and not expired → use cached file ID
  4. If not found → upload to OpenAI, cache result
  5. Check cache for existing extraction result
  6. If found → return cached result
  7. If not found → run extraction, cache result

**Files to modify:**
- `packages/backend/src/services/openai.ts` - integrate caching
- `packages/backend/src/routes/extract.ts` - pass URL/filename to cache
- `packages/backend/src/routes/extractUrl.ts` - pass URL to cache

---

## Phase 3: Result Links (Auto-Generated)

**New Flow:** Extract API automatically creates result link and returns result URL. Frontend navigates to result URL to display results.

```
Extract API Response (new):
{
  "success": true,
  "resultUrl": "/result/abc123xy",   // NEW - auto-generated
  "data": { ... }                     // Still include for backwards compat
}
        ↓
Frontend receives response
        ↓
Navigate to: /result/abc123xy
        ↓
Result page loads results from GET /api/result/abc123xy
```

---

### Task 3.1: Create result link service

**Goal:** Generate and retrieve result links

- Add to `/packages/backend/src/services/cache.ts`:
- Implement `createResultLink(extractionId): Promise<string>` (returns short code)
- Implement `getResultByCode(shortCode): Promise<ExtractionResult | null>`
- Generate 8-character base62 short codes

---

### Task 3.2: Add result API endpoint

**Goal:** Endpoint to retrieve cached results by short code

- Create `/packages/backend/src/routes/result.ts`:
- `GET /api/result/:code` - Retrieve cached extraction result
- Returns full `ExtractionResult` with meet info and events

**Files to create:**
- `packages/backend/src/routes/result.ts`

---

### Task 3.3: Modify extract routes to return result URL

**Goal:** Auto-create result link on successful extraction

- Modify `/packages/backend/src/routes/extract.ts`:
  - After successful extraction with events, create result link
  - Add `resultUrl` field to response: `{ success: true, resultUrl: "/result/{code}", data: {...} }`
- Modify `/packages/backend/src/routes/extractUrl.ts`:
  - Same changes as extract.ts

**Files to modify:**
- `packages/backend/src/routes/extract.ts`
- `packages/backend/src/routes/extractUrl.ts`
- `packages/backend/src/index.ts` - register result routes

---

### Task 3.4: Create result viewer page (main results view)

**Goal:** Frontend page to display cached results

- Create `/packages/webapp/src/routes/result/[code]/+page.svelte`
- Load results via `GET /api/result/:code`
- Reuse existing `EventList`, `EventCard`, `CalendarExport` components
- Show swimmer disambiguation if multiple profiles
- Allow calendar export from this page
- Display "Copy Link" button for easy sharing

**Files to create:**
- `packages/webapp/src/routes/result/[code]/+page.svelte`

---

### Task 3.5: Update frontend navigation flow

**Goal:** Navigate to result page after extraction

- Modify `+page.svelte` (main page):
  - On successful extraction response, read `resultUrl`
  - Navigate to `/result/{code}` using `goto(resultUrl)`
  - Show loading state during navigation
- The main page becomes purely the upload form
- Results are always displayed on the result page

**Files to modify:**
- `packages/webapp/src/routes/+page.svelte`
- `packages/shared/src/types.ts` - update ExtractResponse type

---

## Phase 4: Pre-processing for Accuracy

### Task 4.1: Add text extraction to PDF service

**Goal:** Extract text content from PDF pages

- Modify `/packages/backend/src/services/pdf.ts`:
- Implement `extractTextFromPdf(buffer): string`
- Use mupdf's `page.toStructuredText().asText()` API

**Files to modify:**
- `packages/backend/src/services/pdf.ts`

---

### Task 4.2: Add swimmer occurrence counter

**Goal:** Count how many times swimmer appears in PDF

- Add to `/packages/backend/src/services/pdf.ts`:
- Implement `countSwimmerOccurrences(buffer, swimmerName): { count: number, pages: number[] }`
- Handle both "First Last" and "Last, First" name formats
- Use regex for case-insensitive matching

---

### Task 4.3: Enhance extraction prompt

**Goal:** Include expected event count in AI prompt

- Modify `buildExtractionPrompt()` in `openai.ts`:
- Accept optional `expectedEventCount` parameter
- Add to prompt: "You MUST find at least {count} events for this swimmer"
- Instruct AI to re-scan if fewer events found

**Files to modify:**
- `packages/backend/src/services/openai.ts`

---

### Task 4.4: Integrate pre-processing

**Goal:** Run text extraction before AI extraction

- Modify `extractFromPdf()`:
  1. Before OpenAI call, run `countSwimmerOccurrences()`
  2. Log expected count for debugging
  3. Pass expected count to `buildExtractionPrompt()`
  4. If text extraction fails (scanned PDF), proceed without count

---

## Modified Extraction Flow

```
BACKEND FLOW:

1. Receive PDF (file upload or URL)
         ↓
2. Calculate MD5 checksum
         ↓
3. Check pdf_files cache by checksum
   ├─ FOUND with valid openai_file_id? → Use cached file ID
   └─ NOT FOUND or expired? → Continue to step 4
         ↓
4. Check extraction_results cache by (pdf_id + swimmer_name)
   ├─ FOUND? → Get existing extraction_id, skip to step 9
   └─ NOT FOUND? → Continue to step 5
         ↓
5. Pre-process: Count swimmer occurrences in PDF text
         ↓
6. Upload PDF to OpenAI (if not cached)
         ↓
7. Run AI extraction with enhanced prompt
         ↓
8. Cache extraction result → Get extraction_id
         ↓
9. Create/get result link for extraction_id
         ↓
10. Return { success: true, resultUrl: "/result/{code}", data: {...} }


FRONTEND FLOW:

1. User submits form (PDF + swimmer name)
         ↓
2. Call POST /api/extract or /api/extractUrl
         ↓
3. Receive response with resultUrl
         ↓
4. Navigate to /result/{code} (e.g., goto('/result/abc123xy'))
         ↓
5. Result page loads, calls GET /api/result/{code}
         ↓
6. Display results with EventList, CalendarExport
         ↓
7. User can copy URL to share with others
```

---

## API Endpoints

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/result/:code` | GET | Retrieve cached extraction result |

### Modified Endpoints

| Endpoint | Change |
|----------|--------|
| `/api/extract` | Response now includes `resultUrl` field |
| `/api/extractUrl` | Response now includes `resultUrl` field |

---

## Environment Variables (New)

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...  # Service role key (backend only)
```

---

## Critical Files Summary

| File | Changes |
|------|---------|
| `packages/backend/src/services/supabase.ts` | NEW - Supabase client |
| `packages/backend/src/services/cache.ts` | NEW - Caching logic + result link creation |
| `packages/backend/src/utils/hash.ts` | NEW - MD5 checksum |
| `packages/backend/src/routes/result.ts` | NEW - GET /api/result/:code endpoint |
| `packages/backend/src/routes/extract.ts` | MODIFY - Add resultUrl to response |
| `packages/backend/src/routes/extractUrl.ts` | MODIFY - Add resultUrl to response |
| `packages/backend/src/services/pdf.ts` | ADD - Text extraction, occurrence counting |
| `packages/backend/src/services/openai.ts` | MODIFY - Cache integration, prompt enhancement |
| `packages/backend/src/index.ts` | MODIFY - Register result routes |
| `packages/webapp/src/routes/+page.svelte` | MODIFY - Navigate to resultUrl on success |
| `packages/webapp/src/routes/result/[code]/+page.svelte` | NEW - Results view (reuses existing components) |
| `packages/shared/src/types.ts` | ADD - Update ExtractResponse with resultUrl |

---

## Verification Plan

1. **PDF Caching**: Upload same PDF twice, verify second extraction is faster (cache hit logged)
2. **Extraction Caching**: Search same swimmer twice, verify second is instant (no AI call)
3. **Auto-Result Flow**: Extract → verify redirect to `/result/{code}` → verify results display
4. **Result Link Works**: Copy result URL, open in incognito browser, verify results load
5. **Accuracy Improvement**: Test with heat sheets where events were previously missed, verify count in logs matches extracted events
6. **Edge Cases**: Test with scanned PDFs (no text), expired OpenAI files, invalid result codes

---

## Changelog

| Date | Phase | Notes |
|------|-------|-------|
| 2026-01-26 | - | Development plan v1 created |
