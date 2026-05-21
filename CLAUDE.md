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
- `npm run setup-hook` — install/repair the capture-context hook in `<CLAUDE_DIR>/settings.json` (see Hooks below). Idempotent.
- No lint or typecheck configured.

## Architecture
- Two processes. All disk I/O lives in `src/main/` and `src/preload/`; the renderer (`src/renderer/`) reaches it only through `window.api` exposed via `contextBridge`.
- Data source: `<CLAUDE_DIR>/projects/**/*.jsonl` (sessions). `CLAUDE_DIR` is resolved in `src/main/paths.js` — user override in `~/.agentic-workflow.json` (`claudeDir`, plus a `recents` list for the source-switcher) wins over `$CLAUDE_CONFIG_DIR`, which wins over the `~/.claude` default. Use `getConfig()` / `setConfig()` from `paths.js` to read or persist these settings; don't write the file directly.
- Date-scoped: the frontend picks a single date and the backend returns sessions only for that date. Neither side needs to handle multi-day ranges.
- Main-process backend uses classes: `src/main/services/` (`SessionsService`, `WorkHours`, `AgentRunner`, `Pricing`) and `src/main/sessions/` (`SessionsScanner` watches the projects dir via chokidar; `SessionFile` / `SessionParser` parse individual `.jsonl` files). React renderer uses functional style.
- Long-lived backend services that push to the renderer (`SessionsService`, `AgentRunner`) extend `EventEmitter` — wire listeners with `service.on(event, cb)` before calling `start()` / `startUsagePolling()`.
- Agent feature: `AgentRunner` (main) calls `@anthropic-ai/claude-agent-sdk`'s `query()` in-process and forwards `text_delta` events to the renderer over `agent:output`. The renderer side is `src/renderer/agent/` (`Agent.js` hook + `AgentOutput.jsx`); the prompt template is `src/renderer/agent/ANALYZE_PROMPT.md`, imported via Vite's `?raw`.
- Instructions capture: `bin/capture-context.hook.mjs` runs on Claude Code's `InstructionsLoaded` + `SessionStart` hooks (wired in `<CLAUDE_DIR>/settings.json`) and appends one record per loaded CLAUDE.md / memory file to `<session>.context.ndjson` next to the transcript. `SessionFile.readContext()` reads it; `readSession` merges the records into `items` by timestamp so the renderer sees one unified stream (no separate IPC channel). The sidecar uses `.ndjson` deliberately — `SessionsScanner` filters by `.jsonl` and would otherwise treat it as a transcript. See Hooks below for details.
- Built with **electron-vite**

## IPC surface (`window.api`)
- `listSessions(date)` — returns session metadata array for a `yyyy-MM-dd` date string; also pushes live updates via `onSessionsUpdate`.
- `readSession(id, offset, date)` — streams conversation entries for a session (used by both `ConversationView` and `JsonlView`; backend filters lines to the active date).
- `getWorkHours()` / `setWorkHours(data)` — persist daily work-hour settings.
- `runAgentPrompt(text, systemTools)` / `onAgentOutput(cb)` — start the analysis agent and subscribe to its streamed output chunks.
- `getAgentUsage()` / `onAgentUsage(cb)` — read/subscribe to the Claude AI usage poll (`five_hour` / `seven_day` utilization).

## Frontend layout
- `src/renderer/timeline/` — day-level views: `GanttChart` (swimlane, drives `sourceFilter`/`cwdFilter`), `DailySummary` (aggregated stats), `WorkTimeOverlay`.
- `src/renderer/sessions/` — `SessionList` (picker, left pane) and `SessionView` (detail container with Conversation/JSONL/Agent tabs).
- `src/renderer/sessions/view/` — the pieces composed by `SessionView`: `ConversationView`, `JsonlView`, `AgentView` (the three tabs) and `SessionSummary` (right-hand metadata column shown next to the Conversation tab). Note: `view/AgentView.jsx` builds the markdown payload sent to the agent; the actual run/stream UI is `src/renderer/agent/AgentOutput.jsx`.
- `src/renderer/ui/` — generic primitives (`Toggle`, `EditableMarkdown`).
- `src/renderer/utils/useLocalStorage.js` — `useLocalStorage(key, initial)` is a `useState` drop-in that persists to `localStorage` (supports lazy-init like React's). Use it for any user-facing UI preference that should survive reloads (filters, toggles, expanded panes). The same file exports `clearOutdatedLocalStorage()`, called from `main.jsx`, which wipes storage on major/minor app version bumps — so don't rely on values surviving across releases.
- `src/renderer/styles.css` + `src/renderer/markdown.css` — app-wide CSS, imported by `main.jsx`.

## Hooks (capture-context)
- The two scripts in `bin/` are both checked into git (only `*.ignore*` files are gitignored — e.g. `bin/fix-commit-dates.ignore.sh`).
- `bin/capture-context.hook.mjs` is the hook body itself. It reads the hook event JSON from stdin, writes one NDJSON record to `<transcript>.context.ndjson`, and **must stay silent** — any error is appended to `<CLAUDE_DIR>/.agentic-workflow.hook.error.log` instead of stderr, so Claude Code never surfaces hook failures to the user. Don't add `console.log`/`console.error` here.
- Two events are handled, dispatched by `event.hook_event_name`:
  - `InstructionsLoaded` — fires per file Claude Code loads; record carries `file_path`, `memory_type`, `load_reason`, plus the file contents.
  - `SessionStart` — Claude Code does **not** emit `InstructionsLoaded` for auto-memory, so this branch reads `<projectDir>/memory/MEMORY.md` itself. Skipped when `event.source === 'resume'` (already captured on the first start) and when the file doesn't exist. The timestamp is backdated 500ms so the record sorts above the first real transcript events.
- `bin/setup-hook.mjs` (run via `npm run setup-hook`) installs/repairs the hook. It uses `src/main/services/ClaudeSettings.js` — a thin wrapper around `<CLAUDE_DIR>/settings.json` with `hooks(event)` / `addHook(event, cmd)` / `save()`. `save()` refuses to write if the file was modified on disk since load (mtime guard). Match by **basename** of the hook file when checking "already installed" so the absolute path can be repaired in place.
- `HOOK_PATH` (in `src/main/paths.js`) resolves the hook script relative to the source tree, so the installed command is always an absolute path to this checkout.

## Cross-component sync
- `src/renderer/sessions/view/AgentView.jsx` duplicates information from `ConversationView.jsx` and `SessionSummary.jsx` (rendered as markdown for AI consumption). When you add, remove, or change fields/blocks in either of those files, also update `AgentView.jsx` to keep them in sync.

## Code Style
- **Backend (`src/main/`) is OOP** — every service/module is a class
- **Frontend (`src/renderer/`) is functional** — React components are function components, state is hooks, shared logic lives in custom hooks
- No semicolons in JS/JSX
- Single-argument arrow functions: omit parens (`x => ...`, not `(x) => ...`)
- Align consecutive React `use*` hook declarations: pad the destructured pair with spaces so the `=` (and the hook calls after it) line up in a column.
- IPC channel names use `namespace:kebab-case-action` (e.g. `sessions:read-log-file`, not `sessions:readLogFile`)

## UI testing / debugging

Use the Playwright MCP server (configured in `.mcp.json`) to inspect the frontend. It connects to the Electron app over CDP at `http://localhost:9333` — use the `mcp__playwright__*` tools to navigate, snapshot, click, evaluate, etc.

Prefer the user's already-running app: try connecting first (e.g. `mcp__playwright__browser_navigate` to `http://localhost:9333`) and only start `npm run dev` yourself (in the background) if nothing is listening on that port.

The CDP port (`9333`) is configured in `src/main/debug.js`, which is loaded only in dev — `main.js` gates the import on `import.meta.env.DEV`, so the remote-debugging switch and the React DevTools install are tree-shaken from production builds.
