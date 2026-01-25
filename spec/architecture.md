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

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  SvelteKit + TypeScript + TailwindCSS                       │
│  - PDF upload interface + swimmer name input                │
│  - Event display & selection                                │
│  - Calendar event builder                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                        PDF + Swimmer name
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Hono Backend Server                       │
│  POST /extract - Upload PDF + swimmer, extract with AI      │
│  POST /extractUrl - PDF URL + swimmer, extract with AI      │
│  GET /health - Health check endpoint                        │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────┐
│     mupdf Library        │     │   OpenAI-Compatible API      │
│  PDF → PNG conversion    │     │   Vision + Chat completions  │
│  Server-side rendering   │     │   Structured extraction      │
└─────────────────────────┘     └─────────────────────────────┘
```

## Directory Structure

This project uses a monorepo structure with shared types between frontend and backend.

```
heatsync/
├── packages/
│   ├── webapp/                    # SvelteKit frontend
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── +page.svelte   # Main app (upload → search → export)
│   │   │   │   └── +layout.svelte # App shell, global styles
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
│   │   │   ├── index.ts           # Entry point, Hono app
│   │   │   ├── routes/
│   │   │   │   ├── extract.ts     # POST /extract - PDF upload + AI
│   │   │   │   ├── extractUrl.ts  # POST /extractUrl - URL + AI
│   │   │   │   └── health.ts      # GET /health
│   │   │   ├── services/
│   │   │   │   ├── pdf.ts         # mupdf PDF→image conversion
│   │   │   │   └── openai.ts      # OpenAI API client
│   │   │   └── types/
│   │   │       └── index.ts       # Backend-specific types
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
└── .gitignore
```

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

### POST /extract

Upload a PDF file for swimmer-specific extraction.

**Request:** `multipart/form-data` with:
- `pdf`: PDF file
- `swimmer`: Name of swimmer to search for

**Response:**
```json
{
  "success": true,
  "data": { /* ExtractionResult */ }
}
```

### POST /extractUrl

Extract from a PDF URL for a specific swimmer.

**Request:**
```json
{
  "url": "https://example.com/heatsheet.pdf",
  "swimmer": "John Smith"
}
```

**Response:** Same as `/extract`

### GET /health

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
| `search` | Extraction complete | Form disabled, button shows "Found X events!", results visible |
| `export` | Events selected for export | Same as search, export section active |

### Form State Behavior

- **During extraction (`extracting`):** All form fields disabled, button shows real-time status with spinner ("Fetching PDF from URL...", "Processing PDF...")
- **After extraction (`search`):** Form remains disabled to prevent accidental re-submission, button displays result count
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

**Selection Behavior:**
- All events are auto-selected when extraction completes (`selectAllEvents`)
- Header shows event count and selected count: "3 events found (3 selected)"
- "Select All / Select None" toggle button in the event list header
- Individual event cards have checkbox toggles

## AI API Integration

### Configuration

The backend connects to any OpenAI-compatible chat completions endpoint via environment variables:

```bash
# Required (in packages/backend/.env)
OPENAI_API_KEY=your_api_key_here

# Optional (defaults to OpenAI)
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

### Example Configurations

**OpenAI:**
```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

**AI Builder Space:**
```bash
OPENAI_API_KEY=your_token
OPENAI_BASE_URL=https://space.ai-builders.com/backend/v1
OPENAI_MODEL=gemini-2.5-pro
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
```

### Model Requirements

The configured model must support:
- Multimodal input (images via `image_url` content type)
- Structured JSON output

Recommended models:
- `gpt-4o` (OpenAI)
- `gemini-2.5-pro` (via AI Builder Space or Google)
- `claude-sonnet-4-20250514` (via Anthropic-compatible proxy)
- `llava` (Ollama, for local development)

## Security Considerations

- API key stored as `OPENAI_API_KEY` environment variable in backend only
- Key never exposed to client (all AI calls go through backend)
- No user data persistence (stateless design)
- PDF processing happens server-side (backend handles all sensitive operations)

## Rate Limiting

If using a shared API key in production:
- Implement request rate limiting on `/extract` endpoint
- Consider per-session limits (e.g., 10 extractions per hour)
- Cache extraction results by PDF hash to reduce duplicate requests
