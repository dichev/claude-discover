# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read-only Electron desktop browser for local Claude Code session transcripts.

## How to install and update the app

**macOS:** double-click `start.command` (auto-updates to `origin/main` and starts the app).

**Windows:**
```
git fetch
git reset --hard origin/main
npm install
npm run build
npm start
```

## Commands

- `npm run dev` — Vite dev server + Electron.
- `npm run build` / `npm start` — build / preview.
- `npm test` — run Vitest suite (`vitest run`); single file: `npx vitest run path/to/file.test.js`.
- No lint or typecheck configured.

## Architecture
- Two processes. All disk I/O lives in `src/main/` and `src/preload/`; the renderer (`src/renderer/`) reaches it only through `window.api` exposed via `contextBridge`.
- Data source: `~/.claude/projects/**/*.jsonl` (sessions).
- Date-scoped: the frontend picks a single date and the backend returns sessions only for that date. Neither side needs to handle multi-day ranges.
- Main-process backend uses classes (`src/main/services/`); React renderer uses functional style.
- Built with **electron-vite**

## IPC surface (`window.api`)
- `listSessions(date)` — returns session metadata array for a `yyyy-MM-dd` date string; also pushes live updates via `onSessionsUpdate`.
- `readSession(id, offset, date)` — streams conversation entries for a session.
- `getWorkHours()` / `setWorkHours(data)` — persist daily work-hour settings.
- `readLogFile(filePath)` — read a raw `.jsonl` file by absolute path (used by `JsonlView`).

## Frontend layout
- `src/renderer/timeline/` — day-level views: `GanttChart` (swimlane, drives `sourceFilter`/`cwdFilter`), `DailySummary` (aggregated stats), `WorkTimeOverlay`.
- `src/renderer/sessions/` — `SessionList` (picker, left pane) and `SessionView` (detail container with Conversation/JSONL/Agent tabs).
- `src/renderer/sessions/view/` — the pieces composed by `SessionView`: `ConversationView`, `JsonlView`, `AgentView` (the three tabs) and `SessionSummary` (right-hand metadata column shown next to the Conversation tab).
- `src/renderer/ui/` — generic primitives (`Toggle`, `EditableMarkdown`).
- `src/renderer/styles.css` + `src/renderer/markdown.css` — app-wide CSS, imported by `main.jsx`.

## Cross-component sync
- `src/renderer/sessions/view/AgentView.jsx` duplicates information from `ConversationView.jsx` and `SessionSummary.jsx` (rendered as markdown for AI consumption). When you add, remove, or change fields/blocks in either of those files, also update `AgentView.jsx` to keep them in sync.

## Style
- No semicolons in JS/JSX
- IPC channel names use `namespace:kebab-case-action` (e.g. `sessions:read-log-file`, not `sessions:readLogFile`)

## UI testing

With `npm run dev` running, use the Playwright MCP server (configured in `.mcp.json`) to inspect the frontend. It connects to the Electron app over CDP at `http://localhost:9333` — use the `mcp__playwright__*` tools to navigate, snapshot, click, evaluate, etc.

The CDP port (`9333`) is configured in `src/main/main.js` via `app.commandLine.appendSwitch('remote-debugging-port', '9333')` when not packaged.
