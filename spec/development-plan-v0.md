# HeatSync Development Plan

## Progress Tracking

| Milestone                                   | Status      | Completed  |
| ------------------------------------------- | ----------- | ---------- |
| 1. Project Setup & Core UI                  | Complete    | 2026-01-24 |
| 2. PDF Processing + AI Extraction (Backend) | Complete    | 2026-01-24 |
| 2.5 Upload Form Fix                         | Complete    | 2026-01-25 |
| 3. Swimmer Disambiguation                   | Complete    | 2026-01-25 |
| 3.5 UI Polish: Event Display & Selection    | Complete    | 2026-01-25 |
| 4. Calendar Export                          | Complete    | 2026-01-25 |
| 5. Polish & Launch                          | In Progress | -          |

---

## Milestone 1: Project Setup & Core UI

**Goal:** SvelteKit project with routing, styling, and component shells

**Status:** Complete

### Tasks

- [x] Initialize SvelteKit project with TypeScript using `bun create svelte`
- [x] Configure TailwindCSS v4
- [x] Create app layout and routing structure
- [x] Build PdfUploader component (drag-drop, file picker)
- [x] Build placeholder components (SwimmerSearch, EventList, CalendarExport)
- [x] Set up environment variables for AI Builder token
- [ ] Deploy initial version to AI Builder Space (deferred)

### Commands

```bash
# Initialize project
bun create svelte@latest heatsync
cd heatsync
bun install

# Add dependencies
bun add -d tailwindcss @tailwindcss/vite
bun add pdfjs-dist ics

# Development
bun run dev

# Build
bun run build
```

### Deliverable

Uploadable PDF that shows "extraction coming soon" placeholder

---

## Milestone 2: PDF Processing + AI Extraction (Backend)

**Goal:** Server-side PDF processing and AI extraction via Bun + Hono backend

**Status:** Complete

### Architecture Changes

#### 1. Server-Side PDF Processing

Moved from client-side pdf.js processing to server-side processing. This improves performance on low-end mobile devices (target users: swim parents on phones at the pool).

#### 2. Swimmer-First Extraction

Requires swimmer name at extraction time for targeted extraction. Instead of extracting all events and filtering client-side, the AI extracts only the specified swimmer's events.

#### 3. Model-Aware PDF Handling

- **GPT models:** Upload PDF directly to OpenAI Files API (native PDF support)
- **Non-GPT models:** Render PDF pages to images using mupdf

**Architecture:**

```
Browser → upload PDF + swimmer name → Backend → AI → swimmer's events only
```

### Tasks

- [x] Create `packages/shared` package with shared types
- [x] Create `packages/backend` package structure
- [x] Implement mupdf PDF→image service
- [x] Implement OpenAI extraction service with vision
- [x] Create `/health` endpoint
- [x] Create `/extract` endpoint (multipart PDF upload)
- [x] Create `/extractUrl` endpoint (PDF from URL)
- [x] Update webapp to call backend API
- [x] Add workspace scripts to root package.json
- [x] Update documentation

### Backend Endpoints

| Endpoint      | Method | Description                               |
| ------------- | ------ | ----------------------------------------- |
| `/health`     | GET    | Health check                              |
| `/extract`    | POST   | Upload PDF file, returns extracted events |
| `/extractUrl` | POST   | Provide PDF URL, returns extracted events |

### Commands

```bash
# Install dependencies (from root)
bun install

# Start backend server
bun run backend:dev

# Start webapp
bun run webapp:dev

# Start both concurrently
bun run dev

# Test health endpoint
curl http://localhost:3001/health

# Test PDF extraction (requires swimmer name)
curl -X POST http://localhost:3001/extract \
  -F "pdf=@test-heatsheet.pdf" \
  -F "swimmer=John Smith"
```

### Deliverable

Upload PDF → backend processes → AI extracts events → webapp displays results

---

## Milestone 2.5: Upload Form Fix

**Goal:** Fix broken upload flow - add required swimmer name input and URL option

**Status:** Complete

### Tasks

- [x] Add `swimmerName` store to extraction.ts
- [x] Create `HeatSheetForm.svelte` with:
  - Swimmer name input (required)
  - URL input with clipboard paste button
  - File upload drop zone
  - Form validation (name + URL or file required)
- [x] Integrate both `/extract` and `/extractUrl` API calls
- [x] Update +page.svelte to use new component
- [x] Remove old PdfUploader.svelte

### Deliverable

Complete upload form with swimmer name, URL paste, and file upload options

---

## Milestone 3: Swimmer Disambiguation

**Goal:** Handle cases where extraction returns events for multiple swimmers with same name but different team/age

**Status:** Complete

### Tasks

- [x] Add `age` field to `SwimEvent` type
- [x] Update AI extraction prompt to extract swimmer age
- [x] Add `SwimmerProfile` interface for disambiguation
- [x] Create `swimmerProfiles` derived store (unique name+team+age combinations)
- [x] Create `needsDisambiguation` derived store
- [x] Create `selectedProfile` writable store
- [x] Update `filteredEvents` to respect selected profile
- [x] Replace SwimmerSearch text input with disambiguation combobox
- [x] Auto-select first profile when disambiguation needed
- [x] Update spec documentation

### Deliverable

When same name appears with different team/age → combobox to select correct swimmer

---

## Milestone 3.5: UI Polish - Event Display & Selection

**Goal:** Improve event card layout and add selection controls

**Status:** Complete

### Tasks

- [x] Update EventCard layout to show "Name (Team, Age)" format
- [x] Add `selectAllEvents` function to extraction store
- [x] Auto-select all events after extraction completes
- [x] Add "Select All / Select None" toggle button to EventList header
- [x] Show selected count in header: "3 events found (3 selected)"

### Deliverable

Cleaner event card layout with convenient selection controls

---

## Milestone 4: Calendar Export

**Goal:** Generate downloadable .ics files

**Status:** Complete

### Tasks

- [x] Build event selection UI (checkboxes per event)
- [x] Add "Select All" / "Deselect All" buttons
- [x] Implement reminder time selector (5/10/15 min radio buttons)
- [x] Create calendar utility module (client-side)
- [x] Generate valid iCalendar (.ics) format
- [x] Handle timezone (floating local time - no TZ conversion)
- [x] Trigger .ics file download

### Deliverable

Complete MVP - upload → search → export to calendar

---

## Milestone 5: Polish & Launch

**Goal:** Production-ready MVP

**Status:** In Progress

### Deployment Infrastructure (Complete)

- [x] Move backend routes to `/api` prefix
- [x] Add static file serving to backend (serves webapp from `./public`)
- [x] Add SPA fallback for client-side routing
- [x] Switch webapp to `adapter-static` with `fallback: index.html`
- [x] Configure Vite proxy for development (`/api` → backend)
- [x] Update HeatSheetForm to use `/api` prefix
- [x] Add production build scripts (`build`, `build:copy-static`, `start`, `clean`)
- [x] Add Docker scripts (`docker:build`, `docker:run`)
- [x] Create multi-stage Dockerfile
- [x] Create .dockerignore

### Remaining Tasks

- [x] Comprehensive error handling and user feedback (toast notifications, form recovery on empty results)
- [x] Loading skeletons and smooth animations
- [x] Mobile responsiveness (Tailwind responsive breakpoints throughout)
- [x] Rate limiting on backend API (10 req/min per IP)
- [ ] Add basic analytics (optional, privacy-respecting)
- [x] Write user-facing help/FAQ section
- [x] Create sample heat sheet for testing/demo
- [x] Deploy to AI Builder Space (https://heatsync.ai-builders.space/)
- [ ] Test with 5+ real heat sheets from different software
- [ ] Performance optimization (lazy loading, image compression)

### Deliverable

Launch-ready HeatSync v1.0

---

## Development Commands Reference

```bash
# Start development (both backend and webapp)
bun run dev

# Start backend only
bun run backend:dev

# Start webapp only
bun run webapp:dev

# Build webapp for production
bun run webapp:build

# Preview production build
bun run webapp:preview

# Type checking
bun run webapp:check

# Production build (webapp + copy to backend/public)
bun run build

# Start production server
bun run start

# Clean build artifacts
bun run clean

# Docker commands
bun run docker:build    # Build Docker image
bun run docker:run      # Run container (requires OPENAI_API_KEY env var)
```

## Environment Variables

### Backend (`packages/backend/.env`)

```bash
PORT=3001                              # Development port (production default: 8000)
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.2
```

### Webapp

No environment variables required. The webapp uses relative `/api` paths which are:
- Proxied to backend during development (via Vite proxy)
- Served directly in production (single-server deployment)

---

## Changelog

| Date       | Milestone | Notes                                                                                                                                                                                                                                                                      |
| ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-01-24 | 1         | Milestone 1 complete - monorepo structure, SvelteKit + TailwindCSS v4 + Svelte 5, all core UI components                                                                                                                                                                   |
| 2026-01-24 | 2         | Milestone 2 complete - Backend with Hono + mupdf + OpenAI SDK, shared types package, webapp integration                                                                                                                                                                    |
| 2026-01-24 | -         | Development plan created                                                                                                                                                                                                                                                   |
| 2026-01-25 | 2         | Architecture update: Swimmer-first extraction - API now requires swimmer name, GPT models use direct PDF upload via Files API, non-GPT models use PDF→image rendering                                                                                                      |
| 2026-01-25 | 2         | Prompt accuracy improvements: Name normalization (handles "First Last" and "Last, First" input), disambiguation for swimmers with same last name, thoroughness instructions, session date calculation, heat start time extraction, temperature=0 for deterministic results |
| 2026-01-25 | 2.5       | Upload form fix - Added swimmer name input (required), URL paste option, renamed PdfUploader to HeatSheetForm |
| 2026-01-25 | 3         | Swimmer disambiguation - Added age extraction, SwimmerProfile stores, disambiguation combobox when multiple swimmers with same name |
| 2026-01-25 | 3.5       | UI Polish - Event card shows "Name (Team, Age)" format, auto-select all on extraction, Select All/None toggle button |
| 2026-01-25 | 4         | Calendar Export - Client-side ICS generation, event title format "Name - E# H# L# - Event Name", floating local time (no TZ conversion), events without start times skipped with warning |
| 2026-01-25 | 5         | Deployment infrastructure - Single-server architecture, routes moved to /api prefix, static file serving, SPA fallback, Vite proxy, multi-stage Dockerfile, docker scripts |
| 2026-01-26 | 5         | UX fix - Form stays editable when no events found (stays in `upload` state instead of `search`), shows toast notification instead of locking form |
| 2026-01-26 | 5         | UI simplification - Removed progress bar/stepper component (had sync issues with appState), status is shown in button only |
| 2026-01-26 | 5         | Verified completion: Loading skeletons (EventCardSkeleton with pulse animation), mobile responsiveness (sm: breakpoints), rate limiting (10 req/min per IP), help/FAQ page (8 FAQs + quick start guide), sample heat sheets (2 PDFs) |
| 2026-01-26 | 5         | Deployed to AI Builder Space: https://heatsync.ai-builders.space/ |
