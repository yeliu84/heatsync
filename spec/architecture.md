# HeatSync Technical Architecture

## Overview

HeatSync is a web application that converts swim meet heat sheets (PDFs) into calendar events. Users upload a PDF, the app extracts event data using AI, users search for their swimmer, and export selected events to their calendar.

## Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework (Frontend) | SvelteKit | 2.x |
| Framework (Backend) | Hono | 4.x |
| Runtime | Bun | 1.x |
| Language | TypeScript | 5.x |
| Styling | TailwindCSS | 4.x |
| PDF Processing | mupdf | 1.x |
| Calendar | ics | Latest |
| AI Integration | OpenAI SDK | 4.x |
| Database | Supabase (PostgreSQL) | - |
| ORM | Drizzle ORM | Latest |
| Dev Environment | Nix + Flakes | - |

## Development Environment

This project uses **Nix Flakes** for reproducible development environments. This ensures all developers have the same tooling regardless of their host OS.

### Quick Start

```bash
# If you have direnv installed (recommended)
direnv allow

# Or manually enter the dev shell
nix develop
```

The flake provides:
- **Bun** - JavaScript runtime and package manager

## System Architecture

### Production (Single-Server Deployment)

```
┌─────────────────────────────────────────────────────────────┐
│                    Hono Backend Server                       │
│  Serves both API and static webapp from single process      │
├─────────────────────────────────────────────────────────────┤
│  Static Files (./public)                                     │
│  - SvelteKit webapp (pre-built)                             │
│  - SPA fallback to index.html                               │
├─────────────────────────────────────────────────────────────┤
│  API Routes (/api/*)                                         │
│  POST /api/extract - Upload PDF + swimmer, extract with AI  │
│  POST /api/extractUrl - PDF URL + swimmer, extract with AI  │
│  GET /api/health - Health check endpoint                    │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│     mupdf Library        │     │   OpenAI-Compatible API      │
│  PDF → PNG conversion    │     │   Vision + Chat completions  │
│  Server-side rendering   │     │   Structured extraction      │
└─────────────────────────┘     └─────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Supabase PostgreSQL                          │
│  - pdf_files: Cache OpenAI file IDs by PDF checksum         │
│  - extraction_results: Cache AI results by PDF + swimmer    │
│  - result_links: Shareable short codes for results          │
└─────────────────────────────────────────────────────────────┘
```

### Development (Dual-Server with Proxy)

```
┌──────────────────────────┐        ┌──────────────────────────┐
│   Vite Dev Server        │        │   Hono Backend Server     │
│   http://localhost:5173  │───────▶│   http://localhost:3001   │
│                          │ proxy  │                          │
│   SvelteKit webapp       │ /api/* │   API routes only        │
│   Hot module reload      │        │   No static serving      │
└──────────────────────────┘        └──────────────────────────┘
```

## Directory Structure

This project uses a monorepo structure with shared types between frontend and backend.

```
heatsync/
├── packages/
│   ├── webapp/                    # SvelteKit frontend
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── +page.svelte   # Main app (upload form)
│   │   │   │   ├── +layout.svelte # App shell, global styles
│   │   │   │   └── result/
│   │   │   │       └── [code]/
│   │   │   │           └── +page.svelte  # Shareable results page
│   │   │   ├── lib/
│   │   │   │   ├── components/
│   │   │   │   │   ├── HeatSheetForm.svelte
│   │   │   │   │   ├── SwimmerSearch.svelte
│   │   │   │   │   ├── EventList.svelte
│   │   │   │   │   ├── EventCard.svelte
│   │   │   │   │   └── CalendarExport.svelte
│   │   │   │   ├── types/
│   │   │   │   │   └── index.ts   # Re-exports from @heatsync/shared
│   │   │   │   ├── stores/
│   │   │   │   │   └── extraction.ts
│   │   │   │   └── utils/
│   │   │   │       └── calendar.ts    # ICS generation utilities
│   │   │   ├── app.css
│   │   │   └── app.html
│   │   ├── static/
│   │   ├── .env.example
│   │   ├── svelte.config.js
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   ├── backend/                   # Bun API server
│   │   ├── src/
│   │   │   ├── index.ts           # Entry point, Hono app, static serving
│   │   │   ├── db/
│   │   │   │   ├── schema.ts      # Drizzle ORM table definitions
│   │   │   │   └── index.ts       # Database connection singleton
│   │   │   ├── routes/
│   │   │   │   ├── extract.ts     # POST /api/extract - PDF upload + AI
│   │   │   │   ├── extractUrl.ts  # POST /api/extractUrl - URL + AI
│   │   │   │   ├── result.ts      # GET /api/result/:code - Cached results
│   │   │   │   └── health.ts      # GET /api/health
│   │   │   ├── services/
│   │   │   │   ├── pdf.ts         # mupdf PDF→image, text extraction
│   │   │   │   ├── openai.ts      # OpenAI API client + caching
│   │   │   │   ├── cache.ts       # PDF & extraction result caching
│   │   │   │   └── migrations.ts  # Auto-run Drizzle migrations
│   │   │   ├── utils/
│   │   │   │   ├── hash.ts        # MD5 checksum for PDF deduplication
│   │   │   │   └── name.ts        # Swimmer name normalization
│   │   │   └── types/
│   │   │       └── index.ts       # Backend-specific types
│   │   ├── drizzle/               # SQL migrations
│   │   │   └── 0000_initial_schema.sql
│   │   ├── drizzle.config.ts      # Drizzle Kit configuration
│   │   ├── public/                # Static webapp (production build)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── .env.example
│   └── shared/                    # Shared types package
│       ├── src/
│       │   └── types.ts           # SwimEvent, ExtractionResult, etc.
│       ├── package.json
│       └── tsconfig.json
├── spec/                          # Project documentation
│   ├── architecture.md
│   ├── features.md
│   └── development-plan-v0.md
├── package.json                   # Root workspace config
├── Dockerfile                     # Multi-stage Docker build
├── .dockerignore                  # Docker build exclusions
└── .gitignore
```

## Database Schema

HeatSync uses Supabase PostgreSQL with Drizzle ORM for type-safe database access.

### Tables

**pdf_files** - Cache OpenAI file IDs by PDF checksum
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
```

**extraction_results** - Cache AI extraction results
```sql
CREATE TABLE extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_id UUID NOT NULL REFERENCES pdf_files(id) ON DELETE CASCADE,
  swimmer_name_normalized VARCHAR(255) NOT NULL,  -- lowercase for matching
  swimmer_name_display VARCHAR(255) NOT NULL,     -- "First Last" format
  meet_name VARCHAR(500) NOT NULL,
  session_date TIMESTAMP NOT NULL,
  meet_date_start TIMESTAMP,
  meet_date_end TIMESTAMP,
  venue VARCHAR(500),
  events JSONB NOT NULL DEFAULT '[]',
  warnings JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pdf_id, swimmer_name_normalized)
);
```

**result_links** - Shareable short codes for results
```sql
CREATE TABLE result_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(12) NOT NULL UNIQUE,    -- Base62 code like "abc123xy"
  extraction_id UUID NOT NULL REFERENCES extraction_results(id) ON DELETE CASCADE,
  view_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Caching Flow

1. **PDF Upload**: Calculate MD5 checksum → check `pdf_files` for existing OpenAI file ID
2. **Extraction**: Check `extraction_results` for cached result by PDF ID + swimmer name
3. **Result Link**: Auto-generate 8-character base62 code, store in `result_links`

## Core Data Types

```typescript
interface SwimEvent {
  eventNumber: number;
  eventName: string;          // e.g., "Girls 11-12 100 Freestyle"
  heatNumber: number;
  lane: number;
  swimmerName: string;
  age?: number;               // Swimmer's age (e.g., 11)
  team?: string;
  seedTime?: string;          // e.g., "1:05.32" or "NT"
  heatStartTime?: string;     // "HH:MM" 24-hour format
  sessionDate?: Date;         // The date of the session this event occurs in
}

// Unique swimmer profile for disambiguation
interface SwimmerProfile {
  swimmerName: string;
  team?: string;
  age?: number;
  key: string;                // Unique identifier: "name|team|age"
}

interface ExtractionResult {
  meetName: string;
  sessionDate: Date;          // Calculated from meet start date + session weekday
  meetDateRange?: {           // Optional full meet date range
    start: Date;
    end: Date;
  };
  venue?: string;
  swimmerName?: string;       // Included when loaded from cache/result link
  events: SwimEvent[];
  warnings?: string[];        // e.g., "Could not parse times for Event 5"
}

interface CalendarEvent {
  title: string;              // e.g., "Event 12: 100 Free - Heat 3, Lane 4"
  startTime: Date;
  reminderMinutes: 5 | 10 | 15;
  description: string;        // Full details
  location?: string;
}
```

## Backend API

All API routes are prefixed with `/api` in production.

### POST /api/extract

Upload a PDF file for swimmer-specific extraction.

**Request:** `multipart/form-data` with:
- `pdf`: PDF file
- `swimmer`: Name of swimmer to search for

**Response:**
```json
{
  "success": true,
  "data": { /* ExtractionResult */ },
  "resultUrl": "/result/abc123xy",
  "cached": false
}
```

### POST /api/extractUrl

Extract from a PDF URL for a specific swimmer.

**Request:**
```json
{
  "url": "https://example.com/heatsheet.pdf",
  "swimmer": "John Smith"
}
```

**Response:** Same as `/api/extract`

### GET /api/result/:code

Retrieve cached extraction result by short code.

**Response:**
```json
{
  "success": true,
  "data": {
    "meetName": "Winter Championships 2026",
    "sessionDate": "2026-01-18T00:00:00.000Z",
    "venue": "Aquatic Center",
    "swimmerName": "Jana Samiei",
    "events": [ /* SwimEvent[] */ ]
  }
}
```

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-24T12:00:00.000Z",
  "service": "heatsync-backend"
}
```

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Faster than Node.js, native TypeScript support, built-in bundler |
| PDF Processing | mupdf (server-side) | High-quality rendering, offloads work from mobile browsers |
| API Framework | Hono | Lightweight (~14KB), Web APIs, works great with Bun |
| AI Backend | OpenAI SDK | Works with any OpenAI-compatible endpoint |
| Calendar Format | .ics primary | Universal compatibility; Google Calendar link as convenience |
| State Management | Svelte stores | Simple, built-in, sufficient for stateless app |
| Styling | TailwindCSS v4 | Rapid prototyping, responsive design, CSS-first config |

## UI State Management

### App States

The application uses a simple state machine stored in `appState`:

| State | Description | UI Behavior |
|-------|-------------|-------------|
| `upload` | Initial state, waiting for input | Form enabled, button shows "Find My Events" |
| `extracting` | Processing PDF with AI | Form disabled, button shows spinner + status text |
| `search` | Extraction complete with events | Form disabled, button shows "Found X events!", results visible |
| `export` | Events selected for export | Same as search, export section active |

**Note:** When extraction completes with 0 events, the app stays in `upload` state (not `search`) to keep the form editable, showing a toast notification instead of locking the form.

### Form State Behavior

- **During extraction (`extracting`):** All form fields disabled, button shows real-time status with spinner ("Fetching PDF from URL...", "Processing PDF...")
- **After successful extraction (`search`):** Form remains disabled to prevent accidental re-submission, button displays result count
- **No events found:** Form returns to `upload` state (remains editable), toast notification shows "No events found for [name]", allowing users to modify input and retry
- **Result sections:** Only appear when `extractionResult` contains events (not just when state changes)
- **Start Over:** Resets all stores to initial state via `resetStores()`, returns to `upload` state

### Swimmer Disambiguation

When the AI extraction returns events for multiple swimmers with the same name but different team and/or age combinations, the app shows a disambiguation combobox.

**Flow:**
1. User searches for "John Smith"
2. AI returns events for multiple "John Smith" swimmers (e.g., from different teams or ages)
3. App detects multiple unique `(name, team, age)` profiles in `swimmerProfiles` store
4. `needsDisambiguation` becomes true → disambiguation combobox appears
5. User selects their swimmer → `selectedProfile` updates → `filteredEvents` filters to that profile
6. If only one unique profile exists → no combobox shown, events displayed directly

**Stores:**
- `swimmerProfiles`: Derived store of unique `SwimmerProfile` objects from extraction result
- `needsDisambiguation`: Derived boolean (true if multiple profiles)
- `selectedProfile`: Writable store for the user's selection
- `profileFilteredEvents`: Events filtered by selected profile
- `filteredEvents`: Events filtered by profile + search query

### Event Display & Selection

**Event Card Layout:**
Each event card displays swimmer info in the format: `Name (Team, Age)`
- Name in medium weight
- Team and age in smaller, lighter text inside parentheses
- Comma separator only when both team and age are present
- Session date displayed inline (e.g., "• Saturday, Jan 17") when available
- Date uses UTC timezone for display to avoid timezone-related off-by-one errors

**Selection Behavior:**
- All events are auto-selected when extraction completes (`selectAllEvents`)
- Header shows event count and selected count: "3 events found (3 selected)"
- "Select All / Select None" toggle button in the event list header
- Individual event cards have checkbox toggles

### iOS Safari Clipboard Handling

The URL paste button uses a fallback strategy for iOS Safari compatibility:

1. **Try modern clipboard API first:** `navigator.clipboard.readText()` works on desktop browsers
2. **On failure (iOS Safari):** Focus the URL input field and show a toast guiding the user to tap-and-hold and select "Paste" from the native context menu
3. **Toast notifications:** Used instead of inline error messages for better mobile visibility

## Environment Variables

### File Structure

```
heatsync/
├── .envrc                      # Tracked - direnv config, loads .env
├── .env                        # Gitignored - shared secrets
└── packages/
    └── backend/
        └── .env                # Gitignored - backend-specific overrides
```

### How It Works

| File | Tracked | Purpose |
|------|---------|---------|
| `.envrc` | Yes | Direnv config - calls `dotenv` to load root `.env` into shell |
| `.env` (root) | No | Shared secrets (`OPENAI_API_KEY`, `OPENAI_MODEL`) |
| `packages/backend/.env` | No | Backend-specific config (`PORT=3001` for dev) |

**Loading order:**
1. `direnv` reads `.envrc` and executes `dotenv`
2. `dotenv` loads root `.env` into the shell environment
3. When backend runs, Bun also loads `packages/backend/.env`
4. More specific values override shared ones

**Development:** Both `.env` files are loaded via direnv + Bun
**Docker:** Only root `.env` is passed via `--env-file .env`
**Production:** Platform injects environment variables directly

### Required Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | API key for OpenAI-compatible endpoint |
| `OPENAI_MODEL` | No | `gpt-5.2` | Model to use for extraction |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | API endpoint |
| `PORT` | No | `8000` (prod) / `3001` (dev) | Server port |
| `SUPABASE_DATABASE_URL` | No | - | PostgreSQL connection string for caching (if not set, caching disabled) |

## AI API Integration

### Configuration

The backend connects to any OpenAI-compatible chat completions endpoint. Environment variables are loaded from the root `.env` file (see Environment Variables section above).

### Example Configurations

**OpenAI (default):**
```bash
# .env (root)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2
```

**AI Builder Space:**
```bash
# .env (root) or packages/backend/.env
OPENAI_API_KEY=your_token
OPENAI_BASE_URL=https://space.ai-builders.com/backend/v1
OPENAI_MODEL=gpt-5
```

**Ollama (local):**
```bash
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=llava
```

### Extraction Strategy (Swimmer-First)

1. Client uploads PDF + swimmer name to backend `/extract` endpoint
2. Backend normalizes swimmer name (handles both "First Last" and "Last, First" input formats)
3. For GPT models: Backend uploads PDF directly to OpenAI Files API
   For other models: Backend renders PDF pages to images using mupdf
4. AI extracts events for the specified swimmer only using enhanced prompt
5. Backend returns targeted `ExtractionResult` to client

> **Why swimmer-first?** Extracting only the requested swimmer's events reduces AI token usage by ~90%, improves response latency, and generates smaller payloads. The previous "extract all, filter later" approach was wasteful for typical single-swimmer use cases.

### AI Prompt Engineering

The extraction prompt has been optimized for accuracy with faster models (e.g., GPT-4o-mini, GPT-5.2):

| Enhancement | Purpose |
|-------------|---------|
| **Name Normalization** | Converts input to both "First Last" and "Last, First" formats for reliable matching |
| **Exact Name Return** | Prompt instructs AI to return the exact name from the PDF, not the searched name |
| **Post-Processing Validation** | Backend filters out events where returned `swimmerName` doesn't match the requested name |
| **Disambiguation** | Explicit warning that multiple swimmers may share last names (e.g., "Liu, Elsa" vs "Liu, Elly") |
| **Age Extraction** | Extracts swimmer age from heat sheet for disambiguation when multiple swimmers share the same name |
| **Thoroughness** | Instructions to scan ALL pages before returning, prevents early termination |
| **Session Date Calculation** | Derives session date from meet date range + weekday indicator |
| **Heat Start Time** | Extracts explicit times or estimates from previous heat times |
| **Final Verification** | Re-scan instruction before returning results |
| **temperature: 0** | Deterministic output for consistent extraction |

Example disambiguation instruction in prompt:
```
- IMPORTANT: There may be MULTIPLE swimmers with the same LAST NAME
- Do NOT include events for swimmers with similar names (e.g., "Liu, Elsa" is NOT "Liu, Elly")
- Do NOT match phonetically similar names (e.g., "Li, Elsie" is NOT "Liu, Elly")
```

**Defense in Depth:** The extraction uses a two-layer validation approach:
1. **Prompt engineering** - Instructs AI to return exact names and reject phonetic matches
2. **Post-processing filter** - `namesMatch()` function validates that returned `swimmerName` matches the requested name (case-insensitive, format-agnostic via `normalizeSwimmerName`)

If the AI incorrectly matches a phonetically similar name (e.g., "Elsie Li" for "Elly Liu"), the post-filter removes these events and adds a warning to the response.

### Model Requirements

The configured model must support:
- Multimodal input (images via `image_url` content type)
- Structured JSON output

Recommended models:
- `gpt-5.2` (OpenAI)
- `gpt-4o` (OpenAI)
- `gemini-2.5-pro` (via AI Builder Space or Google)
- `claude-sonnet-4-20250514` (via Anthropic-compatible proxy)
- `llava` (Ollama, for local development)

## Deployment

### Single-Server Architecture

HeatSync uses a single-server deployment model where the Hono backend serves both the API and the static webapp:

| Path | Handler |
|------|---------|
| `/api/*` | API routes (extract, extractUrl, health) |
| `/*` | Static files from `./public` (SvelteKit build) |
| `/*` (fallback) | `index.html` for SPA client-side routing |

### Build Process

```bash
bun run build           # Build webapp + copy to backend/public
bun run start           # Start production server on port 8000
```

The build process:
1. Builds SvelteKit webapp with `adapter-static` → `packages/webapp/build/`
2. Copies build output to `packages/backend/public/`

### Docker Deployment

```bash
bun run docker:build    # Build multi-stage Docker image
bun run docker:run      # Run container (requires OPENAI_API_KEY env var)
```

The Dockerfile uses a multi-stage build:
- **Stage 1 (builder)**: Installs all dependencies, builds webapp
- **Stage 2 (production)**: Slim image with only production dependencies

### Environment Variables (Production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 8000 | Server port |
| `OPENAI_API_KEY` | Yes | - | OpenAI API key |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | API endpoint |
| `OPENAI_MODEL` | No | `gpt-5.2` | Model to use |

### AI Builder Space Deployment

HeatSync is designed for deployment to AI Builder Space:
- Single container deployment
- PORT injected by platform
- Static assets served alongside API

## Security Considerations

- API key stored as `OPENAI_API_KEY` environment variable in backend only
- Key never exposed to client (all AI calls go through backend)
- No user data persistence (stateless design)
- PDF processing happens server-side (backend handles all sensitive operations)

## Rate Limiting & Caching

**Caching (implemented):**
- PDF files cached by MD5 checksum → avoids re-uploading to OpenAI
- Extraction results cached by (PDF ID + swimmer name) → instant results for repeat queries
- OpenAI file IDs expire after ~30 days, auto-refreshed on next request

**Rate limiting (recommended for production):**
- Implement request rate limiting on `/extract` endpoint
- Consider per-session limits (e.g., 10 extractions per hour)

## Analytics

HeatSync uses **Umami Cloud** for privacy-respecting analytics.

### Why Umami?

| Consideration | Decision |
|---------------|----------|
| Privacy | No cookies, no personal data collection, GDPR compliant by default |
| Performance | ~2KB script, loads asynchronously, no impact on page performance |
| Cost | Free tier (10K events/month) sufficient for MVP |
| Simplicity | Frontend-only integration, no backend changes needed |

### What's Tracked

**Automatic (via Umami script):**
- Page views (landing page, help page)
- Referrers, countries, devices, browsers

**Custom Events (via `analytics.ts`):**

| Event | Trigger | Data |
|-------|---------|------|
| `extraction_started` | Form submitted | `method: 'pdf' \| 'url'` |
| `extraction_success` | Events extracted | `eventCount: number` |
| `extraction_failed` | Error occurred | `error: string` (truncated to 50 chars) |
| `export_clicked` | ICS downloaded | `eventCount: number` |

### Implementation

The analytics module (`src/lib/utils/analytics.ts`) provides type-safe event helpers:

```typescript
import { trackExtractionStarted, trackExtractionSuccess } from '$lib/utils/analytics';

// Track when user submits form
trackExtractionStarted('pdf');

// Track successful extraction
trackExtractionSuccess(5);
```

**Graceful Degradation:** If Umami is blocked by ad blockers, tracking calls fail silently without affecting app functionality.

### Dashboard

Analytics data is available at [Umami Cloud](https://cloud.umami.is) (requires login).
