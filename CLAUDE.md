# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read-only Electron desktop browser for local Claude Code session transcripts.

Windows is the default OS, but we must support also **macOS**. When adding a macOS specific fix, add comment // @macOS 

## How to install and update the app (on macOS only)

**macOS:** double-click `start.command` (auto-updates to `origin/main` and starts the app).

## Commands

- `npm run dev` — Vite dev server + Electron.
- `npm run build` / `npm start` — build / preview.
- `npm test` — run Vitest suite (`vitest run`); single file: `npx vitest run test/pricing.test.js`. Tests live in `test/` at the repo root.
- `npm run setup-hook` — install/repair the capture-context hook **and** the `bin/statusline.mjs` status line in `<CLAUDE_DIR>/settings.json` (see Hooks below). Idempotent.
- `node bin/usage.mjs [daily|weekly|monthly] [--since …] [--until …] [--timezone …]` — print per-period token usage/cost from local transcripts as a terminal table (granularity defaults to `monthly`). Used to verify our cost math against `npx ccusage` (run both with `--timezone UTC`); the `ccusage-diff.test.js` suite asserts they match.
- No lint or typecheck configured.

## Architecture
- Two processes. All disk I/O lives in `src/main/` and `src/preload/`; the renderer (`src/renderer/`) reaches it only through `window.api` exposed via `contextBridge`.
- Data source: `<CLAUDE_DIR>/projects/**/*.jsonl` (sessions). `CLAUDE_DIR` is resolved in `src/main/paths.js` — user override in `~/.claude-discover.json` (`claudeDir`, plus a `recents` list for the source-switcher) wins over `$CLAUDE_CONFIG_DIR`, which wins over the `~/.claude` default. Use `getConfig()` / `setConfig()` from `paths.js` to read or persist these settings; don't write the file directly.
- Date-scoped: the frontend picks a single date and the backend returns sessions only for that date. Neither side needs to handle multi-day ranges.
- Main-process backend uses classes: `src/main/windows/` (`MainWindow` owns the `BrowserWindow`; `FindBar` is the find overlay), `src/main/services/` (`SessionsService`, `WorkHours`, `AgentRunner`, `Pricing`) and `src/main/sessions/` (`SessionsScanner` watches the projects dir via chokidar and, after one full walk with the watcher live, serves scans from `StatCache` — a watcher-fed stat cache — instead of re-walking the disk; `SessionFile` / `SessionParser` parse individual `.jsonl` files; `MetaCache` caches whole-file session metas across period changes keyed by size+mtime). React renderer uses functional style.
- `SessionsService.scan(period, { watch })` is the single scan entry point: `watch:true` (UI) streams `update` events per dir batch and returns the cache immediately; `watch:false` (CLIs/tests like `bin/usage.mjs`) awaits the full scan and returns the deduped sessions with no emits. Period bounds come from the shared `periodBounds(date, granularity, tz)` in the same file.
- Long-lived backend services that push to the renderer (`SessionsService`) extend `EventEmitter` — wire listeners with `service.on(event, cb)` before calling `start()`.
- Agent feature: `AgentRunner` (main) calls `@anthropic-ai/claude-agent-sdk`'s `query()` in-process and forwards `text_delta` events to the renderer over `agent:output`. The renderer side is `src/renderer/agent/` (`Agent.js` hook + `AgentOutput.jsx`); the prompt template is `src/renderer/agent/ANALYZE_PROMPT.md`, imported via Vite's `?raw`.
- Pricing: `Pricing` service computes per-session USD cost. Seed rates in `cache/prices.json`; on startup it refreshes from LiteLLM into `cache/prices.current.json` (daily TTL), merging first-party `claude-*` over Bedrock `anthropic.claude-*` and stripping dated/versioned suffixes so variants collapse to one model id. `priceFor` matches by longest key prefix. "Fast" sessions (`usage.speed === "fast"`) bill at a per-model `fastModeMplr`; when the multiplier is unknown, `SessionParser` flags `fastPricingUnknown` and falls back to 1×.
- Instructions capture: `bin/capture-context.hook.mjs` runs on Claude Code's `InstructionsLoaded` + `SessionStart` + `SessionEnd` hooks (wired in `<CLAUDE_DIR>/settings.json`) and appends one record per loaded CLAUDE.md / memory file to `<session>.context.ndjson` next to the transcript (and deletes that sidecar on `SessionEnd` when no transcript was ever written). `SessionFile.readContext()` reads it; `readSession` merges the records into `items` by timestamp so the renderer sees one unified stream (no separate IPC channel). The sidecar uses `.ndjson` deliberately — `SessionsScanner` filters by `.jsonl` and would otherwise treat it as a transcript. See Hooks below for details.
- Find bar: native Chromium find (`webContents.findInPage`) rendered in a **separate `WebContentsView` overlay**, not in the app DOM. `src/main/windows/FindBar.js` creates the view, layers it over the main window (top-right, repositioned on resize), loads the standalone bar in `src/renderer/find/` (`find.html` + `find.js` + `find.css`, a tiny vanilla bar styled after Chrome's — its own renderer entry in `electron.vite.config.js`), and forwards the main content's `found-in-page` events to the view. The overlay loads its **own preload** (`src/preload/findPreload.js`, a second preload entry in the config) so the find IPC is exposed only to the find view, not the main window. The view must stay out of the searched page on purpose: `findInPage` matches `<input>` values, so an in-page box would count itself, and the box's focus is the search anchor, so focusing it would trap next/prev on the first match. `Edit > Find` (`CmdOrCtrl+F`) calls `FindBar.show()`; `Escape` is routed through `buildAppMenu`'s `onEscape` so it closes the bar when open (otherwise it deselects). Results use Chromium's monotonic `requestId` to drop stale events from superseded keystrokes. `find:query`/`find:stop`/`find:close` IPC are registered in `main.js` but delegate to `FindBar`'s `query()`/`stop()`/`hide()`, which act on the app content (`this.win.webContents`) — never on `e.sender` (the find view).
- Built with **electron-vite**

## IPC surface (`window.api`)
- `listSessions(date)` — returns session metadata array for a `yyyy-MM-dd` date string; also pushes live updates via `onSessionsUpdate`.
- `onScanProgress(cb)` — subscribes to scan progress (`sessions:scan-progress`); `cb` receives `{ done, total, scanning }` where `done`/`total` are project-dir counts (the cheap up-front denominator), used to drive the StatusBar loading bar. Rides its own event so the `sessions:update` snapshot path stays untouched; not emitted on the `watch:false` CLI/test path.
- `readSession(id, offset, date)` — streams conversation entries for a session (used by both `ConversationView` and `JsonlView`; backend filters lines to the active date).
- `getWorkHours()` / `setWorkHours(data)` — persist daily work-hour settings.
- `runAgentPrompt(text, systemTools)` / `onAgentOutput(cb)` — start the analysis agent and subscribe to its streamed output chunks.
- `findInPage(text, options)` / `stopFind()` / `findClose()` / `onFindResult(cb)` / `onFindOpen(cb)` — native Chromium find-in-page. These are exposed by the find overlay's own preload (`src/preload/findPreload.js`) on **its** `window.api`, not the main window's (see Find bar above).
- `openLink(href, baseFile)` — open a link from rendered markdown via the OS shell. The renderer has no navigation guard, so `ConversationView`'s ReactMarkdown `a` overrides (defined inline there) intercept the click and hand it to main, which routes it: http(s)/mailto → `shell.openExternal`; relative paths → resolved against `baseFile`'s dir and opened with `shell.openPath` (falling back to `shell.showItemInFolder` on error). Only `ConversationView` wires these up (text blocks via `linkComponents`; instruction/memory files via `buildLinkComponents(file_path)`) — other markdown surfaces (AgentView, AgentOutput, EditableMarkdown) keep plain ReactMarkdown. Local links only render clickable where a containing-file path is known; elsewhere they fall back to plain text.

## Frontend layout
- `src/renderer/timeline/` — period views (Daily/Weekly/Monthly, selected via the granularity tabs in `GanttChart`): `GanttChart` (swimlane, drives `sourceFilter`/`projectFilter`), `PeriodSummary` (aggregated stats), `WorkTimeOverlay`. Period range math is shared via `src/renderer/utils/period.js` (mirrored by `periodBounds` in `SessionsService.js`).
- `src/renderer/sessions/` — `SessionList` (picker, left pane), `Session` (detail container with Conversation/JSONL/Agent tabs) and `SessionSummary` (right-hand metadata column shown next to the Conversation tab).
- `src/renderer/sessions/view/` — the pieces composed by `Session`: `ConversationView`, `JsonlView`, `AgentView` (the three tabs) and `transcript.js` (pure transcript model — `flatten`/`groupTurns`/`tokenPoints`/`cycleDurations`/`toolSummary` — shared by `ConversationView` and `MarkdownSession`). Note: `view/AgentView.jsx` builds the markdown payload sent to the agent; the actual run/stream UI is `src/renderer/agent/AgentOutput.jsx`.
- `src/renderer/ui/` — generic primitives (`Toggle`, `EditableMarkdown`) plus `StatusBar` (footer showing the active Claude dir, log retention, and capture-hook / status-line install state, each with a tooltip).
- `src/renderer/sessions/MarkdownSession.js` — `markdownSession(meta, items, truncated)` renders a session (summary + transcript) to the markdown payload fed to the agent and shown in the Agent tab; `truncated` caps line/char counts. It reuses `flatten` from `transcript.js`.
- `src/renderer/utils/useLocalStorage.js` — `useLocalStorage(key, initial)` is a `useState` drop-in that persists to `localStorage` (supports lazy-init like React's). Use it for any user-facing UI preference that should survive reloads (filters, toggles, expanded panes). The same file exports `clearOutdatedLocalStorage()`, called from `main.jsx`, which wipes storage on major/minor app version bumps — so don't rely on values surviving across releases.
- `src/renderer/styles.css` + `src/renderer/markdown.css` — app-wide CSS, imported by `main.jsx`.

## Hooks (capture-context)
- The scripts in `bin/` are checked into git (only `*.ignore*` files are gitignored — e.g. `bin/fix-commit-dates.ignore.sh`).
- `bin/capture-context.hook.mjs` is the hook body itself. It reads the hook event JSON from stdin, writes one NDJSON record to `<transcript>.context.ndjson`, and **must stay silent** — any error is appended to `<CLAUDE_DIR>/.claude-discover.hook.error.log` instead of stderr, so Claude Code never surfaces hook failures to the user. Don't add `console.log`/`console.error` here.
- Three events are handled, dispatched by `event.hook_event_name`:
  - `InstructionsLoaded` — fires per file Claude Code loads; record carries `file_path`, `memory_type`, `load_reason`, plus the file contents.
  - `SessionStart` — Claude Code does **not** emit `InstructionsLoaded` for auto-memory, so this branch reads `<projectDir>/memory/MEMORY.md` itself. Skipped when `event.source === 'resume'` (already captured on the first start) and when the file doesn't exist. The timestamp is backdated 500ms so the record sorts above the first real transcript events.
  - `SessionEnd` — the transcript `.jsonl` is written lazily (only on first interaction), so the sidecar is always created before it. If the `.jsonl` still doesn't exist at session end, the user started but never interacted with the session, so this branch deletes the orphan `.context.ndjson` (regardless of age) **and** sweeps the project dir for older orphans — `*.context.ndjson` files whose `.jsonl` doesn't exist and whose mtime is older than `CLEAR_ORPHAN_LOGS_AFTER_MS` (1 day; set the constant to `0`/`false` to disable just the sweep — the just-ended session's own orphan is still dropped). The age guard spares sidecars of other sessions still between SessionStart and their first transcript line; the just-ended session's own sidecar is deleted before the loop, so it never needs an explicit skip. `SessionEnd` only fires on graceful exit, so force-closed/killed sessions don't hit it directly — their orphans are swept the next time a sibling session ends without a transcript.
- `bin/setup-hook.mjs` (run via `npm run setup-hook`) installs/repairs the hook. It uses `src/main/services/ClaudeSettings.js` — a thin wrapper around `<CLAUDE_DIR>/settings.json` with `hooks(event)` / `addHook(event, cmd)` / `statusLine` get/set / `save()`. `save()` refuses to write if the file was modified on disk since load (mtime guard). Match by **basename** of the hook file when checking "already installed" so the absolute path can be repaired in place.
- The same script also installs `bin/statusline.mjs` as Claude Code's `statusLine` command (same basename match → install / repair stale path / no-op). If a **different** status line is already configured it is left untouched and the script just warns (it never overwrites the user's own status line).
- `HOOK_PATH` and `STATUSLINE_PATH` (in `src/main/paths.js`) resolve the scripts relative to the source tree, so the installed commands are always absolute paths to this checkout.

## Cross-component sync
- `src/renderer/sessions/MarkdownSession.js` duplicates information from `ConversationView.jsx` and `SessionSummary.jsx` (rendered as markdown for AI consumption; `AgentView.jsx` just lays it out). When you add, remove, or change fields/blocks in either of those files, also update `MarkdownSession.js` to keep them in sync.

## Code Style
- **Backend (`src/main/`) is OOP** — every service/module is a class
- **Frontend (`src/renderer/`) is functional** — React components are function components, state is hooks, shared logic lives in custom hooks
- No semicolons in JS/JSX
- Single-argument arrow functions: omit parens (`x => ...`, not `(x) => ...`)
- Align consecutive React `use*` hook declarations: pad the destructured pair with spaces so the `=` (and the hook calls after it) line up in a column.
- IPC channel names use `namespace:kebab-case-action` (e.g. `sessions:read-log-file`, not `sessions:readLogFile`)
- Prefer clean single-line code comments, over multiline explanations

## UI testing / debugging
**Ask before running Playwright UI testing** — don't drive the app via Playwright MCP unless the user has confirmed.

Use the Playwright MCP server (configured in `.mcp.json`) to inspect the frontend. It connects to the Electron app over CDP at `http://localhost:9333` — use the `mcp__playwright__*` tools to navigate, snapshot, click, evaluate, etc.

Prefer the user's already-running app: try connecting first (e.g. `mcp__playwright__browser_navigate` to `http://localhost:9333`) and only start `npm run dev` yourself (in the background) if nothing is listening on that port.

The CDP port (`9333`) is configured in `src/main/debug.js`, which is loaded only in dev — `main.js` gates the import on `import.meta.env.DEV`, so the remote-debugging switch and the React DevTools install are tree-shaken from production builds.
