# HeatSync Development Plan

## Progress Tracking

| Milestone | Status | Completed |
|-----------|--------|-----------|
| 1. Project Setup & Core UI | Complete | 2026-01-24 |
| 2. PDF Processing | Not Started | - |
| 3. AI Extraction Integration | Not Started | - |
| 4. Search & Display | Not Started | - |
| 5. Calendar Export | Not Started | - |
| 6. Polish & Launch | Not Started | - |

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

## Milestone 2: PDF Processing

**Goal:** Convert uploaded PDFs to images client-side

**Status:** Not Started

### Tasks

- [ ] Integrate pdf.js library
- [ ] Configure pdf.js worker for Vite/SvelteKit
- [ ] Render PDF pages to canvas elements
- [ ] Convert canvas to base64 PNG images
- [ ] Show page thumbnails/preview grid
- [ ] Handle multi-page PDFs (typical heat sheets are 10-50 pages)
- [ ] Add progress indicator for large PDFs
- [ ] Implement page range selection (optional optimization)

### Deliverable

Upload PDF → see all pages as image previews

---

## Milestone 3: AI Extraction Integration

**Goal:** Send images to AI API and parse structured response

**Status:** Not Started

### Tasks

- [ ] Create `/api/extract/+server.ts` route
- [ ] Implement AI Builder API client
- [ ] Design and test extraction prompt
- [ ] Handle multimodal request with multiple images
- [ ] Implement retry logic with exponential backoff
- [ ] Parse AI response into `ExtractionResult` type
- [ ] Handle partial extraction (some pages fail)
- [ ] Add request rate limiting
- [ ] Store extraction result in Svelte store

### Extraction Prompt

```
You are extracting swim meet data from heat sheet images. Extract ALL swimmers and events visible.

Return a JSON object with this exact structure:
{
  "meetName": "string",
  "meetDate": "YYYY-MM-DD",
  "venue": "string or null",
  "events": [
    {
      "eventNumber": number,
      "eventName": "full event name",
      "heatNumber": number,
      "lane": number,
      "swimmerName": "First Last",
      "team": "team code or null",
      "seedTime": "MM:SS.ss or NT",
      "estimatedStartTime": "HH:MM or null"
    }
  ]
}

Important:
- Extract EVERY swimmer from EVERY heat shown
- Normalize swimmer names to "First Last" format (capitalize properly)
- If seed time shows "NT", "NS", or is blank, use "NT"
- Event numbers are usually in the left margin or header
- Heat numbers appear above each heat block (e.g., "Heat 1 of 3")
- Lanes are typically numbered 1-8 or 1-10
- Estimated start times may appear at the top of each event

Return ONLY valid JSON, no markdown formatting or explanation.
```

### Deliverable

Upload PDF → extraction runs → raw JSON displayed

---

## Milestone 4: Search & Display

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

## Milestone 5: Calendar Export

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

## Milestone 6: Polish & Launch

**Goal:** Production-ready MVP

**Status:** Not Started

### Tasks

- [ ] Comprehensive error handling and user feedback
- [ ] Loading skeletons and smooth animations
- [ ] Mobile responsiveness testing (iOS Safari, Android Chrome)
- [ ] Rate limiting on API proxy (protect shared token)
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
# Start development server
bun run dev

# Build for production
bun run build

# Preview production build
bun run preview

# Type checking
bun run check
```

## Environment Variables

```bash
# .env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5
```

---

## Changelog

| Date | Milestone | Notes |
|------|-----------|-------|
| 2026-01-24 | 1 | Milestone 1 complete - monorepo structure, SvelteKit + TailwindCSS v4 + Svelte 5, all core UI components |
| 2026-01-24 | - | Development plan created |
