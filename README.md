# MapLogger – Builder

A lightweight, fully client‑side tool that instruments your existing map‑based web pages for usability experiments. The builder wraps your pages in a Host shell with a fixed task toolbar and logging, while your uploaded pages are injected as Child pages that forward interaction events. The result is a ZIP you can run or host straight away.

## What’s in this folder

- `index.html` – the builder UI (upload files, enter tasks, options)
- `app.js` – builder logic (reading files, injecting code, creating the ZIP)
- `style.css` – builder styling
- `client/`
  - `maplogger-client.js` – the MapLogger client used by both Host and Child pages
  - `maplogger.css` – styles for the MapLogger client

## How it works (at a glance)

1) Open `builder/index.html` in your browser.
2) Drag & drop a ZIP archive of your project (include `.html` plus any `.js`, `.css`, images, fonts, and data files referenced by relative paths). The builder unpacks the archive in the browser, instruments the HTML files, and keeps the directory structure intact. The generated host entry page (`index.html` or `ml-host.html`) is saved alongside your original `index.html`, so you can quickly find the instrumented version in the matching directory.
3) In “Define tasks”, add one task per bubble (use “+ Add task” to create more; each task has its own input, remove button, and you can drag to reorder). The builder starts with one editable “exploratory” task by default which you can change or remove.
4) Optionally add a Welcome message (shown once on the Host entry screen). The internal `sessionKey` is derived automatically from the Output name.
5) Click “Build”. A ZIP named `<outputName>.zip` will be downloaded.
6) Unzip and open the Host entry page to run the study:
   - If you uploaded an `index.html`, the Host is named `ml-host.html` (your original `index.html` remains unchanged as a Child page).
   - If you didn’t upload `index.html`, the Host is named `index.html`.

> Everything runs locally in the browser using JSZip and FileSaver. No server is required to build, but some browsers may block `fetch()` from `file://`. See “Troubleshooting”.

## What gets generated and injected

The builder uses a Host/Child architecture:

- Host shell (single HTML file):
  - Contains the fixed task toolbar (Next →, END) and an iframe below it.
  - Loads MapLogger with `role: "host"`, `deferStart: true`, and the task list. It shows your optional Welcome message and a Start button; after Start, the first selected page is loaded into the iframe and Task 1 begins.
  - Receives interaction events from Child pages via `postMessage` and writes the CSV.

- Child pages (your uploaded HTML files):
  - Each uploaded HTML page is modified by injecting the client bundle before `</head>` with `role: "child"`. Child pages do not render a toolbar and do not change your page layout; they only forward events to the Host.

Child injection (conceptual):

```html
<!-- before </head> -->
<link rel="stylesheet" href="client/maplogger.css">
<script>
  window.MAPLOGGER_TASKS = [];
  window.MAPLOGGER_CONFIG = {
    role: "child",
    csvFilename: "<outputName>.csv",
    sessionKey: "<derived-from-output-name>",
    requireIndexStart: false
  };
</script>
<script defer src="client/maplogger-client.js"></script>
```

Host shell includes the same client bundle but is initialised with `role: "host"`, the full task list, `deferStart: true`, and the list of available pages to load in the iframe.

The builder UI shows a mini preview of the first task label and a workflow strip (Welcome → Task 1 → Task 2 …) for clarity.

### Defaults and configuration notes

- `csvFilename` defaults to `<outputName>.csv` (set by the builder).
- `sessionKey` is derived from the Output name (lowercased) and is not editable in the UI.
- Layout: The toolbar lives in the Host and is fixed at the very top; the Host automatically offsets the iframe below the toolbar height. Child pages keep their own layout intact.
- Some internal defaults remain available in the client (e.g., `toolbarMode: "inline"`, placement strategy), but the Host layout now governs the visible toolbar.

### Naming and files

The Output name you enter is used for:
1. ZIP filename: `<outputName>.zip`
2. CSV filename: `<outputName>.csv`
3. Session grouping via `sessionKey` (derived from the Output name)

### CSV log format

Each interaction and task event appends a row with the columns:

| Column | Meaning |
|--------|---------|
| `session_id` | Unique per participant session. Overridden to the participant ID at END (all existing rows are rewritten). |
| `timestamp_ms_since_start` | Milliseconds since session start. |
| `local_time` | Local time with timezone offset (e.g. 2025-11-07T09:41:12.123+01:00). |
| `iso_time` | UTC time (ISO 8601). |
| `task_index` | 1-based task order (Task 1 = 1). |
| `task_label` | Exact task string. |
| `event_type` | Type of event (`session_start`, `session_page`, `click`, `dblclick`, `contextmenu`, `wheel`, `keydown`, `resize`, `visibility`, `focus`, `blur`, `task_start`, `task_end`, `task_next`, `end_clicked`, `session_end`). |
| `element_tag` | Tag name of target element (for pointer/key events). |
| `element_id` | Element id (if any). |
| `element_classes` | Up to first five class names concatenated by `.`. |
| `element_text` | Truncated (≤80 chars) cleaned text content. |
| `css_path` | Structural CSS nth-of-type path. |
| `x`,`y` | Pointer coordinates (for pointer‑related events). |
| `viewport_w`,`viewport_h` | Viewport size for the event. |
| `button`,`button_label` | Mouse button index & label (`left`/`middle`/`right`) for clicks. |
| `deltaY`,`deltaMode` | Raw wheel delta and mode. |
| `wheel_direction`,`zoom_hint` | Derived wheel direction (`up`/`down`/`none`) and interpreted zoom intent hint (`zoom_in`/`zoom_out`). |
| `key`,`code`,`ctrl`,`alt`,`shift` | Key info (only for `keydown`). |
| `extra_json` | Additional structured payload (e.g. `{duration_ms:...}` on `task_end`, `{participant_id:...}` on end events). |

Rows without certain fields leave them blank (e.g. `wheel_direction` for a `click`).

#### Interpreting element fields

Instead of parsing `css_path` directly you can often rely on `element_tag`, `element_id`, `element_classes`, and `element_text` to understand what was interacted with. `css_path` remains for disambiguation or automated replay.

#### Time handling

`local_time` uses the user’s actual timezone offset; `iso_time` is UTC (can appear shifted vs local). Prefer `local_time` for chronological analysis relative to participant locale.

### Participant END flow and CSV naming

Pressing the toolbar **END** button (on the Host) opens a modal requesting a participant ID (e.g. `P042`). After confirmation:

1. All previously recorded rows have their `session_id` rewritten to the participant ID.
2. Two final events are appended: `end_clicked` and `session_end` (both include `participant_id` in `extra_json`).
3. Logging is disabled (no further interactions are recorded if the page remains open).
4. The CSV is exported automatically and named `<participantID>.csv` (the ID is required by validation). 
5. A “Thank you” modal appears.

This ensures the dataset is keyed by the participant rather than a random session token and cleanly terminates logging.

## Output (ZIP contents)

The ZIP contains:

- all uploaded files (text and binary),
- modified HTML with Child injection,
- the Host shell file (`ml-host.html` if you uploaded an `index.html`, otherwise `index.html`),
- the `client/` folder with the client and styles,
- `LICENSE` (MIT) and a short `README.md` inside the ZIP.

The original folder hierarchy is kept intact inside the ZIP so that relative references (scripts, styles, data, images) continue to work.

## How to run the builder

- Easiest: open `builder/index.html` directly in your browser.
- If your browser blocks `fetch()` from `file://` (see “Troubleshooting”), run the builder via a simple static server (for example the VS Code “Live Server” extension).

## Troubleshooting

- “Error loading client bundle…” when opening `builder/index.html` directly from the file system:
  - Some browsers block `fetch('client/...')` on `file://` URLs.
  - Solution: run the builder via a local server (e.g. VS Code “Live Server”) and open `http://localhost:.../builder/index.html`.
- “Unsupported file type” when uploading:
  - The builder now expects a single `.zip` archive. Ensure you compressed your project folder before uploading.
- The toolbar is not visible after unzipping:
  - Make sure you opened the Host entry file (`ml-host.html` or `index.html`), not a Child page directly.
  - If you see only your page content without the fixed toolbar, you likely opened a Child HTML file.
- CSV is not downloaded/created:
  - Behaviour is handled by `maplogger-client.js`. Ensure the script was injected successfully and check the browser console for errors.

## What the builder deliberately does not do

- Does not modify links inside your HTML; it only injects scripts/configuration.
- Does not reorganise or rename files (except adding a Host when needed). Your original file names remain.
- Does not minify or bundle your project.

## Limits and notes

- Files are tracked by their relative path; adding the same path again replaces the previous copy (useful if you re-upload updated assets).
- Input must be provided as a single ZIP archive. Prepare the archive locally (keeping your folder hierarchy) before uploading it to the builder.
- Very large files can increase memory usage during ZIP creation (everything runs in the browser).
- Injection only happens for files detected as HTML (`.html`, `.htm`, `.xhtml`).

## Licence

This builder and the resulting ZIP include a `LICENSE` file with the MIT licence for MapLogger.

---

If you’d like, we can add a short guide with best practices for writing tasks, or extend the configuration (for example, anonymisation options or periodic auto‑flush for extremely long sessions).
