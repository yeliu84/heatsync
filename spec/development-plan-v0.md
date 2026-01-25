# HeatSync Development Plan

## Progress Tracking

| Milestone | Status | Completed |
|-----------|--------|-----------|
| 1. Project Setup & Core UI | Complete | 2026-01-24 |
| 2. PDF Processing + AI Extraction (Backend) | Complete | 2026-01-24 |
| 3. Search & Display | Not Started | - |
| 4. Calendar Export | Not Started | - |
| 5. Polish & Launch | Not Started | - |

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

### Architecture Change

Moved from client-side pdf.js processing to server-side mupdf processing. This improves performance on low-end mobile devices (target users: swim parents on phones at the pool).

**Before:**
```
Browser → pdf.js → images → AI API
```

**After:**
```
Browser → upload PDF → Backend (mupdf) → images → OpenAI API → results
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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/extract` | POST | Upload PDF file, returns extracted events |
| `/extractUrl` | POST | Provide PDF URL, returns extracted events |

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

# Test PDF extraction
curl -X POST http://localhost:3001/extract \
  -F "pdf=@test-heatsheet.pdf"
```

### Deliverable

Upload PDF → backend processes → AI extracts events → webapp displays results

---

## Milestone 3: Search & Display

**Goal:** User can find their swimmer's events

**Status:** Not Started

### Tasks

- [ ] Implement swimmer name search input
- [ ] Add fuzzy matching for name search (handle typos, partial names)
- [ ] Display filtered events in EventCard components
- [ ] Show event details: number, name, heat, lane, seed time
- [ ] Sort events by event number or estimated time
- [ ] Add "no results found" state with suggestions
- [ ] Add "searching..." loading state
- [ ] Highlight search matches in results

### Deliverable

Full flow from upload → search → see events

---

## Milestone 4: Calendar Export

**Goal:** Generate downloadable .ics files

**Status:** Not Started

### Tasks

- [ ] Build event selection UI (checkboxes per event)
- [ ] Add "Select All" / "Deselect All" buttons
- [ ] Implement reminder time selector (5/10/15 min radio buttons)
- [ ] Create `/api/calendar/+server.ts` route
- [ ] Generate valid iCalendar (.ics) format
- [ ] Handle timezone correctly (prompt user or detect from meet location)
- [ ] Trigger .ics file download
- [ ] Add "Add to Google Calendar" URL link
- [ ] Test import in Apple Calendar, Google Calendar, Outlook

### Deliverable

Complete MVP - upload → search → export to calendar

---

## Milestone 5: Polish & Launch

**Goal:** Production-ready MVP

**Status:** Not Started

### Tasks

- [ ] Comprehensive error handling and user feedback
- [ ] Loading skeletons and smooth animations
- [ ] Mobile responsiveness testing (iOS Safari, Android Chrome)
- [ ] Rate limiting on backend API (protect shared token)
- [ ] Add basic analytics (optional, privacy-respecting)
- [ ] Write user-facing help/FAQ section
- [ ] Create sample heat sheet for testing/demo
- [ ] Final deployment to AI Builder Space
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
```

## Environment Variables

### Backend (`packages/backend/.env`)
```bash
PORT=3001
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

### Webapp (`packages/webapp/.env`)
```bash
PUBLIC_API_URL=http://localhost:3001
```

---

## Changelog

| Date | Milestone | Notes |
|------|-----------|-------|
| 2026-01-24 | 1 | Milestone 1 complete - monorepo structure, SvelteKit + TailwindCSS v4 + Svelte 5, all core UI components |
| 2026-01-24 | 2 | Milestone 2 complete - Backend with Hono + mupdf + OpenAI SDK, shared types package, webapp integration |
| 2026-01-24 | - | Development plan created |
