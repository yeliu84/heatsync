# HeatSync Feature Breakdown

## MVP (Version 1.0)

Core features required for initial launch.

| Feature | Description | Status |
|---------|-------------|--------|
| PDF Upload | Drag-drop or file picker, swimmer name input | Complete |
| AI Extraction | Upload PDF + swimmer name, AI extracts only that swimmer's events (swimmer-first) | Complete |
| Swimmer Search | Server-side at extraction time (not client-side post-extraction) | Complete |
| Event Display | Show event name, heat, lane, seed time; swimmer shown as "Name (Team, Age)" | Complete |
| Event Selection | Checkboxes with Select All/None toggle, auto-select on extraction | Complete |
| Reminder Choice | Radio buttons: 5, 10 (default), 15 min before | Complete |
| .ics Export | Download .ics file with selected events | Complete |
| Loading States | Status shown in submit button during extraction | Complete |
| Form State Management | Disable form after processing, "Start Over" to reset | Complete |
| Swimmer Disambiguation | Combobox to select swimmer when same name has different team/age | Complete |
| Error Handling | Clear messages for failed uploads/extraction, graceful "no events found" recovery | Complete |
| Mobile Responsive | Works on phones (parents at meets) | Complete |

## Version 1.1 (Polish)

Enhancements based on user feedback.

| Feature | Description | Status |
|---------|-------------|--------|
| URL paste input | Allow users to paste a URL to a heat sheet PDF instead of uploading | Complete |
| Multi-swimmer search | Search for multiple swimmers at once (siblings) | Planned |
| Google Calendar direct add | "Add to Google Calendar" button with pre-filled link | Planned |
| Event time estimation | If times missing, estimate based on event order + avg duration | Planned |
| Share extraction | Generate shareable link to extracted data (no PDF re-upload) | Planned |
| Print view | Clean printable list of swimmer's events | Planned |

## Version 2.0 (Future)

Major features for scale and engagement.

| Feature | Description | Status |
|---------|-------------|--------|
| User accounts | Save favorite swimmers, extraction history | Planned |
| Team mode | Coach uploads once, swimmers search by name | Planned |
| Push notifications | Web push reminders (PWA) | Planned |
| Meet schedule updates | Re-extract updated heat sheets, show changes | Planned |
| Apple Calendar integration | Direct CalDAV integration | Planned |
| SMS reminders | Twilio integration for text alerts | Planned |

## User Stories

### MVP User Stories

1. **As a swim parent**, I want to upload a heat sheet PDF so that I can find my child's events without manually searching through pages.

2. **As a swimmer**, I want to search for my name and see all my events in one place so I know my schedule for the meet.

3. **As a swim family**, I want to add events to my phone's calendar with reminders so I don't miss warm-up or event times.

4. **As a user on mobile**, I want to use the app at the pool on my phone so I can quickly check schedules during a meet.

### v1.1 User Stories

5. **As a parent of multiple swimmers**, I want to search for all my children at once so I can see overlapping events.

6. **As a coach**, I want to share extracted meet data with my team so they don't each have to upload the same PDF.

## AI Extraction Accuracy

The extraction system has been optimized to handle real-world heat sheets accurately:

| Challenge | Solution |
|-----------|----------|
| Multiple swimmers with same last name | Explicit disambiguation in prompt (e.g., "Liu, Elsa" ≠ "Liu, Elly") |
| Phonetically similar names | Post-processing validation filters out mismatched names (e.g., "Li, Elsie" ≠ "Liu, Elly") |
| Same name, different team/age | Disambiguation combobox lets user select their swimmer profile |
| Name format variations | Input normalization handles both "First Last" and "Last, First" |
| Incomplete scanning | Thoroughness instructions + final verification step |
| Model non-determinism | temperature=0 for consistent results |
| Session date ambiguity | Calculated from meet date range + weekday indicator |
| Missing heat times | Estimation from previous heat times + seed times |

## Heat Sheet Variations

The app must handle various heat sheet formats:

| Software | Characteristics |
|----------|-----------------|
| Hy-Tek Meet Manager | Most common, dense tabular layout, consistent formatting |
| SwimTopia | Web-based, cleaner layout, may include photos |
| Active.com | Variable formatting, often includes advertisements |
| TeamUnify | Similar to Hy-Tek, may have team branding |
| Custom/Manual | Unpredictable, may require fallback handling |

## Reminder Options

| Option | Use Case |
|--------|----------|
| 5 minutes | When already at the pool, just need a heads-up |
| 10 minutes (default) | Standard buffer for warm-up area and preparation |
| 15 minutes | For younger swimmers who need more prep time |
