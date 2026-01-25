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
│  - PDF upload interface                                      │
│  - Swimmer search & event display                           │
│  - Calendar event builder                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Hono Backend Server                       │
│  POST /extract - Upload PDF, process, extract with AI       │
│  POST /extractUrl - Download PDF from URL, process, extract │
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
│   │   │   │   │   ├── PdfUploader.svelte
│   │   │   │   │   ├── SwimmerSearch.svelte
│   │   │   │   │   ├── EventList.svelte
│   │   │   │   │   ├── EventCard.svelte
│   │   │   │   │   └── CalendarExport.svelte
│   │   │   │   ├── types/
│   │   │   │   │   └── index.ts   # Re-exports from @heatsync/shared
│   │   │   │   └── stores/
│   │   │   │       └── extraction.ts
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
  team?: string;
  seedTime?: string;          // e.g., "1:05.32" or "NT"
  estimatedStartTime?: Date;  // Parsed from heat sheet if available
}

interface ExtractionResult {
  meetName: string;
  meetDate: Date;
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

Upload a PDF file for extraction.

**Request:** `multipart/form-data` with `pdf` file field

**Response:**
```json
{
  "success": true,
  "data": { /* ExtractionResult */ },
  "pageCount": 12
}
```

### POST /extractUrl

Extract from a PDF URL.

**Request:**
```json
{
  "url": "https://example.com/heatsheet.pdf"
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

### Extraction Strategy

1. Client uploads PDF to backend `/extract` endpoint
2. Backend renders PDF pages to images using mupdf
3. Backend sends images to configured AI endpoint
4. AI extracts structured data from heat sheet images
5. Backend returns parsed `ExtractionResult` to client

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
