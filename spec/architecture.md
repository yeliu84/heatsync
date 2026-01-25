# HeatSync Technical Architecture

## Overview

HeatSync is a web application that converts swim meet heat sheets (PDFs) into calendar events. Users upload a PDF, the app extracts event data using AI, users search for their swimmer, and export selected events to their calendar.

## Stack

| Layer | Technology | Version |
|-------|------------|---------|
| Framework | SvelteKit | 2.x |
| Runtime | Bun | 1.x |
| Language | TypeScript | 5.x |
| Styling | TailwindCSS | 4.x |
| PDF Processing | pdf.js | Latest |
| Calendar | ics | Latest |
| AI Integration | Any OpenAI-compatible API | - |
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
│  - PDF upload & preview                                      │
│  - Swimmer search & event display                           │
│  - Calendar event builder                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SvelteKit API Routes                      │
│  /api/extract - Proxy to AI backend (hides token)           │
│  /api/calendar - Generate .ics files                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│            OpenAI-Compatible API (Configurable)              │
│  POST {OPENAI_BASE_URL}/chat/completions                    │
│  - Multimodal input (PDF pages as images)                   │
│  - Structured extraction via prompt engineering             │
│                                                             │
│  Supported providers:                                       │
│  - OpenAI (api.openai.com)                                  │
│  - AI Builder Space (space.ai-builders.com/backend)         │
│  - Ollama (localhost:11434)                                 │
│  - Any OpenAI-compatible endpoint                           │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

This project uses a monorepo structure to allow for future expansion (e.g., `packages/backend` or `packages/api`).

```
heatsync/
├── packages/
│   └── webapp/                        # SvelteKit frontend
│       ├── src/
│       │   ├── routes/
│       │   │   ├── +page.svelte       # Main app (upload → search → export)
│       │   │   ├── +layout.svelte     # App shell, global styles
│       │   │   └── api/
│       │   │       ├── extract/+server.ts    # PDF extraction proxy
│       │   │       └── calendar/+server.ts   # .ics generation
│       │   ├── lib/
│       │   │   ├── components/
│       │   │   │   ├── PdfUploader.svelte
│       │   │   │   ├── SwimmerSearch.svelte
│       │   │   │   ├── EventList.svelte
│       │   │   │   ├── EventCard.svelte
│       │   │   │   └── CalendarExport.svelte
│       │   │   ├── services/
│       │   │   │   ├── pdf.ts         # PDF to images conversion
│       │   │   │   ├── extraction.ts  # AI API integration
│       │   │   │   └── calendar.ts    # iCal generation
│       │   │   ├── types/
│       │   │   │   └── index.ts       # SwimEvent, Swimmer, etc.
│       │   │   └── stores/
│       │   │       └── extraction.ts  # Svelte stores for app state
│       │   ├── app.css
│       │   └── app.html
│       ├── static/
│       ├── .env.example
│       ├── svelte.config.js
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
├── spec/                              # Project documentation
│   ├── architecture.md
│   ├── features.md
│   └── development-plan-v0.md
├── package.json                       # Root workspace config
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
  title: string;              // e.g., "🏊 Event 12: 100 Free - Heat 3, Lane 4"
  startTime: Date;
  reminderMinutes: 5 | 10 | 15;
  description: string;        // Full details
  location?: string;
}
```

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Faster than Node.js, native TypeScript support, built-in bundler |
| PDF Processing | pdf.js + canvas | Client-side conversion to images, no server storage needed |
| AI Backend | Configurable OpenAI-compatible | Flexibility to use any provider (OpenAI, local Ollama, etc.) |
| Calendar Format | .ics primary | Universal compatibility; Google Calendar link as convenience |
| State Management | Svelte stores | Simple, built-in, sufficient for stateless app |
| Styling | TailwindCSS v4 | Rapid prototyping, responsive design, CSS-first config |

## AI API Integration

### Configuration

The app connects to any OpenAI-compatible chat completions endpoint via environment variables:

```bash
# Required
OPENAI_API_KEY=your_api_key_here

# Optional (defaults to OpenAI)
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5
```

### Example Configurations

**OpenAI:**
```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5
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

1. Client converts PDF to images using pdf.js
2. Client sends base64 images to `/api/extract` server route
3. Server proxies to configured AI endpoint with token
4. AI extracts structured data from heat sheet images
5. Server returns parsed `ExtractionResult` to client

### Model Requirements

The configured model must support:
- Multimodal input (images via `image_url` content type)
- Structured JSON output

Recommended models:
- `gpt-5` (OpenAI)
- `gemini-2.5-pro` (via AI Builder Space or Google)
- `claude-sonnet-4-20250514` (via Anthropic-compatible proxy)
- `llava` (Ollama, for local development)

## Security Considerations

- API key stored as `OPENAI_API_KEY` environment variable
- Key never exposed to client
- No user data persistence (stateless design)
- PDF processing happens client-side (no server storage of uploaded files)

## Rate Limiting

If using a shared API key in production:
- Implement request rate limiting on `/api/extract`
- Consider per-session limits (e.g., 10 extractions per hour)
- Cache extraction results by PDF hash to reduce duplicate requests
